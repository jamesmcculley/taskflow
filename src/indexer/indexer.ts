import { TFile } from 'obsidian';
import type { CachedMetadata, HeadingCache } from 'obsidian';
import type TaskFlowPlugin from '../main';
import { addCompletionStamp, splitLines } from '../mutations/lineEdits';
import { findUnloggedCompletions, reconcileLog } from '../store/logReconcile';
import type { ExternalCompletionCandidate } from '../store/logReconcile';
import { todayISO } from '../store/selectors';
import type { ProjectInfo, ProjectStatus, Task } from '../types';
import { own } from '../utils';
import { generateTaskId } from './ids';
import { appendBlockId, parseTaskLine } from './tokenizer';

const DEBOUNCE_MS = 250;

/** Tag that opts a single checkbox line out of task indexing entirely. */
export const NO_TASK_TAG = 'notask';

/** True when `path` is inside any of the configured excluded folders. */
export function isExcludedPath(path: string, folders: string[]): boolean {
	for (const raw of folders) {
		const folder = raw.trim().replace(/^\/+|\/+$/g, '');
		if (folder === '') continue;
		if (path === folder || path.startsWith(`${folder}/`)) return true;
	}
	return false;
}

/**
 * True when frontmatter opts the whole note out (`taskflow: false`). Accepts
 * the boolean and the string forms alike — Obsidian's property UI quotes
 * values typed into a "Text" field (`taskflow: "false"`), which YAML then
 * parses as a string, not the boolean.
 */
export function isTaskflowDisabled(frontmatter: Record<string, unknown> | undefined): boolean {
	const value = frontmatter?.taskflow;
	if (value === false) return true;
	if (typeof value === 'string') return ['false', 'ignore', 'off', 'no'].includes(value.toLowerCase());
	return false;
}

function normalizeProjectStatus(value: unknown): ProjectStatus {
	return value === 'someday' || value === 'done' ? value : 'active';
}

function findEnclosingHeading(headings: HeadingCache[], line: number): string | undefined {
	let current: string | undefined;
	for (const h of headings) {
		if (h.position.start.line > line) break;
		current = h.heading;
	}
	return current;
}

export class TaskIndexer {
	private debounceTimers = new Map<string, number>();
	private resolvedScanDone = false;

	constructor(private plugin: TaskFlowPlugin) {}

	start(): void {
		const { app } = this.plugin;
		this.plugin.registerEvent(
			app.metadataCache.on('changed', (file) => this.scheduleReindex(file)),
		);
		// The metadataCache resolves asynchronously after layout-ready; on a
		// cold start some files have no cache yet during the first scan. Rescan
		// once when the cache reports everything resolved.
		this.plugin.registerEvent(
			app.metadataCache.on('resolved', () => {
				if (this.resolvedScanDone) return;
				this.resolvedScanDone = true;
				void this.fullScan();
			}),
		);
		this.plugin.registerEvent(
			app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				this.plugin.store.getState().renameFile(oldPath, file.path);
				this.scheduleReindex(file);
			}),
		);
		this.plugin.registerEvent(
			app.vault.on('delete', (file) => {
				this.clearTimer(file.path);
				this.plugin.store.getState().removeFile(file.path);
			}),
		);
		app.workspace.onLayoutReady(() => void this.fullScan());
	}

	stop(): void {
		for (const timer of this.debounceTimers.values()) window.clearTimeout(timer);
		this.debounceTimers.clear();
	}

	async fullScan(): Promise<void> {
		const t0 = performance.now();
		const files = this.plugin.app.vault.getMarkdownFiles();
		let taskCount = 0;
		await Promise.all(
			files.map(async (file) => {
				const cache = this.plugin.app.metadataCache.getFileCache(file);
				if (!cache) return;
				if (this.isFileExcluded(file.path, cache)) {
					this.plugin.store.getState().removeFile(file.path);
					return;
				}
				const hasTasks = cache.listItems?.some((li) => li.task !== undefined) ?? false;
				const isProject = cache.frontmatter?.type === 'project';
				if (!hasTasks && !isProject) return;
				const content = hasTasks ? await this.plugin.app.vault.cachedRead(file) : '';
				taskCount += this.indexFile(file, content, cache);
			}),
		);
		this.log(
			`full scan: ${files.length} files, ${taskCount} tasks in ${(performance.now() - t0).toFixed(1)}ms`,
		);
	}

	private scheduleReindex(file: TFile): void {
		this.clearTimer(file.path);
		this.debounceTimers.set(
			file.path,
			window.setTimeout(() => {
				this.debounceTimers.delete(file.path);
				void this.reindexFile(file);
			}, DEBOUNCE_MS),
		);
	}

	private clearTimer(path: string): void {
		const timer = this.debounceTimers.get(path);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			this.debounceTimers.delete(path);
		}
	}

	private async reindexFile(file: TFile): Promise<void> {
		// Re-read cache and content after the debounce window; the payload from
		// the original 'changed' event may be stale by now.
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		if (!cache) return;
		const t0 = performance.now();
		const content = await this.plugin.app.vault.cachedRead(file);
		const count = this.indexFile(file, content, cache);
		this.log(`reindex ${file.path}: ${count} tasks in ${(performance.now() - t0).toFixed(1)}ms`);
	}

	private isFileExcluded(path: string, cache: CachedMetadata): boolean {
		return (
			isExcludedPath(path, this.plugin.persisted.settings.excludedFolders) ||
			isTaskflowDisabled(cache.frontmatter)
		);
	}

	/** Parses one file into tasks and pushes them into the store. Returns the task count. */
	private indexFile(file: TFile, content: string, cache: CachedMetadata): number {
		const store = this.plugin.store.getState();
		if (this.isFileExcluded(file.path, cache)) {
			store.removeFile(file.path);
			return 0;
		}
		const fm = cache.frontmatter;
		const isProject = fm?.type === 'project';
		const project: ProjectInfo | null = isProject
			? {
					path: file.path,
					name: file.basename,
					status: normalizeProjectStatus(fm?.status),
					area: typeof fm?.area === 'string' ? fm.area : undefined,
				}
			: null;

		const lines = content.split('\n');
		const headings = cache.headings ?? [];
		const allItems = cache.listItems ?? [];
		const liByLine = new Map(allItems.map((li) => [li.position.start.line, li]));
		const taskItems = allItems.filter((li) => li.task !== undefined);
		const taskLineSet = new Set(taskItems.map((li) => li.position.start.line));
		const existingIds = new Set(Object.keys(this.plugin.store.getState().tasks));
		const tasks: Task[] = [];
		const missingIds: { line: number; id: string; replaces?: string }[] = [];
		const completionCandidates: ExternalCompletionCandidate[] = [];

		// A checkbox nested under another checkbox (through any bullet levels)
		// is a checklist item of that root task, not an independent task.
		const parentTaskLine = (line: number): number | undefined => {
			let p = liByLine.get(line)?.parent ?? -1;
			while (p >= 0) {
				if (taskLineSet.has(p)) return p;
				p = liByLine.get(p)?.parent ?? -1;
			}
			return undefined;
		};
		const rootCache = new Map<number, number>();
		const rootTaskLine = (line: number): number => {
			const memo = rootCache.get(line);
			if (memo !== undefined) return memo;
			const parent = parentTaskLine(line);
			const root = parent === undefined ? line : rootTaskLine(parent);
			rootCache.set(line, root);
			return root;
		};

		const storeTasks = this.plugin.store.getState().tasks;
		const seenInFile = new Set<string>();
		const taskByLine = new Map<number, Task>();
		for (const li of taskItems) {
			const lineNo = li.position.start.line;
			const raw = lines[lineNo];
			if (raw === undefined) continue;
			const parsed = parseTaskLine(raw);
			if (!parsed) continue;
			// #notask opts this checkbox out entirely — no task, no ID assigned.
			if (parsed.tags.includes(NO_TASK_TAG)) continue;
			let id = parsed.blockId ?? li.id;
			if (id) {
				// Copy-pasted lines can carry duplicate IDs (within this file or
				// clashing with a task in another file) — reassign the duplicate.
				const existing = own(storeTasks, id);
				const clashesOtherFile = existing !== undefined && existing.file !== file.path;
				if (seenInFile.has(id) || clashesOtherFile) {
					const fresh = generateTaskId(existingIds);
					missingIds.push({ line: lineNo, id: fresh, replaces: id });
					id = fresh;
				}
			} else {
				id = generateTaskId(existingIds);
				missingIds.push({ line: lineNo, id });
			}
			existingIds.add(id);
			seenInFile.add(id);

			const root = rootTaskLine(lineNo);
			if (root !== lineNo) {
				const parent = taskByLine.get(root);
				if (parent) {
					(parent.checklist ??= []).push({
						id,
						title: parsed.title,
						done: parsed.status !== 'todo',
						line: lineNo,
					});
				}
				continue;
			}

			const task: Task = {
				id,
				title: parsed.title,
				file: file.path,
				line: lineNo,
				status: parsed.status,
				scheduled: parsed.scheduled,
				due: parsed.due,
				recurrenceText: parsed.recurrenceText,
				tags: parsed.tags,
				project: isProject ? file.path : undefined,
				projectStatus: project?.status,
				heading: findEnclosingHeading(headings, lineNo),
				order: lineNo,
				completedAt: own(this.plugin.persisted.completedAt, id),
				evening: parsed.evening || undefined,
				someday: parsed.tags.includes('someday') || undefined,
				priority: parsed.priority,
				scheduledTime: parsed.scheduledTime,
			};
			tasks.push(task);
			taskByLine.set(lineNo, task);
			// A task already done/cancelled on this pass might be one the plugin
			// never itself completed (a native checkbox click, hand-typed [x], an
			// externally synced change) — flag it for the unlogged-completion
			// check below, regardless of how it got here.
			if (task.status !== 'todo') {
				completionCandidates.push({
					taskId: id,
					title: task.title,
					project: task.project,
					status: task.status === 'cancelled' ? 'cancelled' : 'done',
					stampDate: parsed.completedDate,
				});
			}
		}

		this.reconcilePersisted(tasks);
		store.setFileIndex(file.path, tasks, project);
		if (missingIds.length > 0) void this.assignBlockIds(file, missingIds);
		const unlogged = findUnloggedCompletions(this.plugin.persisted.log, completionCandidates);
		if (unlogged.length > 0) void this.recordUnloggedCompletions(file, unlogged);
		return tasks.length;
	}

	/**
	 * Keeps the completion log/timestamps consistent with markdown state, so
	 * completions undone outside the plugin (e.g. unticking the checkbox in
	 * the note) disappear from the History.
	 */
	private reconcilePersisted(tasks: Task[]): void {
		const persisted = this.plugin.persisted;
		let changed = false;
		const pruned = reconcileLog(persisted.log, tasks);
		if (pruned) {
			persisted.log = pruned;
			this.plugin.store.getState().setLog([...pruned]);
			changed = true;
		}
		for (const task of tasks) {
			if (
				task.status === 'todo' &&
				task.recurrenceText === undefined &&
				persisted.completedAt[task.id] !== undefined
			) {
				delete persisted.completedAt[task.id];
				task.completedAt = undefined;
				changed = true;
			}
		}
		if (changed) void this.plugin.savePersisted();
	}

	/**
	 * Appends `^t-xxxxxx` block refs to task lines that lack one (or replaces a
	 * duplicated ref), batched per file through vault.process() so concurrent
	 * edits are never clobbered. If a line moved or changed since parsing, it
	 * is skipped — the resulting 'changed' event re-indexes and retries.
	 */
	private async assignBlockIds(
		file: TFile,
		missing: { line: number; id: string; replaces?: string }[],
	): Promise<void> {
		await this.plugin.app.vault.process(file, (content) => {
			const { lines, sep } = splitLines(content);
			for (const { line, id, replaces } of missing) {
				const raw = lines[line];
				if (raw === undefined) continue;
				const parsed = parseTaskLine(raw);
				if (!parsed) continue;
				if (replaces !== undefined) {
					if (parsed.blockId !== replaces) continue;
					lines[line] = raw.replace(/\^[A-Za-z0-9-]+(\s*)$/, `^${id}$1`);
				} else {
					if (parsed.blockId) continue;
					lines[line] = appendBlockId(raw, id);
				}
			}
			return lines.join(sep);
		});
	}

	/**
	 * Backfills History for completions the plugin's own actions never saw:
	 * adds the missing ✅ stamp (batched into one write, same pattern as
	 * assignBlockIds) for 'done' tasks that don't have one yet, then logs
	 * every candidate — mirroring exactly what completing a task through the
	 * plugin does, just triggered by noticing the change instead of causing it.
	 */
	private async recordUnloggedCompletions(
		file: TFile,
		items: ExternalCompletionCandidate[],
	): Promise<void> {
		const today = todayISO();
		const needsStamp = new Set(
			items.filter((i) => i.status === 'done' && i.stampDate === undefined).map((i) => i.taskId),
		);
		if (needsStamp.size > 0) {
			await this.plugin.app.vault.process(file, (content) => {
				const { lines, sep } = splitLines(content);
				for (let i = 0; i < lines.length; i++) {
					const raw = lines[i];
					if (raw === undefined) continue;
					const parsed = parseTaskLine(raw);
					if (!parsed?.blockId || !needsStamp.has(parsed.blockId) || parsed.completedDate) continue;
					lines[i] = addCompletionStamp(raw, today);
				}
				return lines.join(sep);
			});
		}
		for (const item of items) {
			await this.plugin.actions.recordExternalCompletion(item, item.stampDate ?? today);
		}
		this.log(`recovered ${items.length} unlogged completion(s) in ${file.path}`);
	}

	private log(message: string): void {
		if (this.plugin.persisted.settings.debugPerf) console.log(`TaskFlow: ${message}`);
	}
}
