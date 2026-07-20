import { Notice, TFile } from 'obsidian';
import type TaskFlowPlugin from '../main';
import { parseTaskLine } from '../indexer/tokenizer';
import { advanceRecurrence } from '../recurrence/recurrence';
import { addDaysISO, todayISO } from '../store/selectors';
import type { SavedFilter, Task } from '../types';
import { own } from '../utils';
import {
	addCompletionStamp,
	insertTaskLine,
	insertTaskLineBeforeHeadings,
	removeCompletionStamp,
	setCheckboxStatus,
	setDateToken,
	setFlagToken,
	setPriority,
	setTag,
	splitLines,
} from './lineEdits';

export type ScheduleTarget = string | 'today' | 'tomorrow' | null;

function noonISO(dateISO: string): string {
	const [y, m, d] = dateISO.split('-').map(Number);
	return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).toISOString();
}

function findTaskLine(lines: string[], task: Task): number {
	const atKnown = lines[task.line];
	if (atKnown !== undefined && parseTaskLine(atKnown)?.blockId === task.id) return task.line;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line !== undefined && parseTaskLine(line)?.blockId === task.id) return i;
	}
	return -1;
}

/**
 * All task mutations flow through here: each action rewrites the markdown line
 * through vault.process() (atomic read-modify-write, safe against concurrent
 * edits) and then patches the store optimistically; the debounced reindex from
 * the resulting 'changed' event reconciles everything else.
 */
export class TaskActions {
	constructor(private plugin: TaskFlowPlugin) {}

	private getTask(id: string): Task | undefined {
		return own(this.plugin.store.getState().tasks, id);
	}

	private async editTaskLine(task: Task, edit: (line: string) => string): Promise<boolean> {
		const file = this.plugin.app.vault.getAbstractFileByPath(task.file);
		if (!(file instanceof TFile)) return false;
		let edited = false;
		await this.plugin.app.vault.process(file, (content) => {
			const { lines, sep } = splitLines(content);
			const lineNo = findTaskLine(lines, task);
			if (lineNo === -1) return content;
			const raw = lines[lineNo];
			if (raw === undefined) return content;
			lines[lineNo] = edit(raw);
			edited = true;
			return lines.join(sep);
		});
		if (!edited) new Notice('TaskFlow: task line not found — it may have been edited.');
		return edited;
	}

	/** Completes a task; `asOf` (ISO date) backdates the stamp, log, and journal line. */
	async completeTask(id: string, asOf?: string): Promise<void> {
		const task = this.getTask(id);
		if (!task || task.status === 'done') return;
		const today = asOf ?? todayISO();

		if (task.recurrenceText !== undefined) {
			const next = advanceRecurrence(
				{ scheduled: task.scheduled, due: task.due, recurrenceText: task.recurrenceText },
				today,
			);
			if (next) {
				// Rewrite the same line as a fresh todo with advanced date(s);
				// the completion itself lives only in the index log.
				const ok = await this.editTaskLine(task, (l) => {
					let out = removeCompletionStamp(setCheckboxStatus(l, 'todo'));
					if (next.scheduled !== undefined) out = setDateToken(out, 'scheduled', next.scheduled);
					if (next.due !== undefined) out = setDateToken(out, 'due', next.due);
					return out;
				});
				if (!ok) return;
				await this.recordCompletion(task, 'done', asOf);
				this.plugin.store.getState().patchTask(id, {
					status: 'todo',
					scheduled: next.scheduled ?? task.scheduled,
					due: next.due ?? task.due,
				});
				return;
			}
			new Notice(`TaskFlow: couldn't parse recurrence “${task.recurrenceText}” — completing without repeat.`);
		}

		if (!(await this.editTaskLine(task, (l) => addCompletionStamp(setCheckboxStatus(l, 'done'), today)))) return;
		const completedAt = await this.recordCompletion(task, 'done', asOf);
		this.plugin.store.getState().patchTask(id, { status: 'done', completedAt });
	}

	async uncompleteTask(id: string): Promise<void> {
		const task = this.getTask(id);
		if (!task || task.status === 'todo') return;
		if (!(await this.editTaskLine(task, (l) => removeCompletionStamp(setCheckboxStatus(l, 'todo'))))) return;
		delete this.plugin.persisted.completedAt[id];
		// Drop the most recent log entry for this task so the History stays honest.
		const log = this.plugin.persisted.log;
		let removed: (typeof log)[number] | undefined;
		for (let i = log.length - 1; i >= 0; i--) {
			if (log[i]?.taskId === id) {
				removed = log.splice(i, 1)[0];
				break;
			}
		}
		this.plugin.store.getState().setLog([...log]);
		await this.plugin.savePersisted();
		// Only 'done' entries ever wrote a daily-note line; removing on a
		// cancelled entry could delete an older completion's line for the task.
		if (removed?.status === 'done') await this.plugin.dailySync.remove(removed);
		this.plugin.store.getState().patchTask(id, { status: 'todo', completedAt: undefined });
	}

	async cancelTask(id: string): Promise<void> {
		const task = this.getTask(id);
		if (!task || task.status === 'cancelled') return;
		if (!(await this.editTaskLine(task, (l) => setCheckboxStatus(l, 'cancelled')))) return;
		// Index-only timestamp so the History can group cancelled tasks by day;
		// no ✅ stamp is written for cancellations.
		const completedAt = await this.recordCompletion(task, 'cancelled');
		this.plugin.store.getState().patchTask(id, { status: 'cancelled', completedAt });
	}

	/** Toggles the 🌙 Tonight flag; enabling also schedules today when undated. */
	async toggleEvening(id: string): Promise<void> {
		const task = this.getTask(id);
		if (!task) return;
		const on = task.evening !== true;
		const today = todayISO();
		const needsSchedule =
			on && (task.scheduled === undefined || task.scheduled > today) && (task.due === undefined || task.due > today);
		const ok = await this.editTaskLine(task, (l) => {
			let out = setFlagToken(l, '🌙', on);
			if (needsSchedule) out = setDateToken(out, 'scheduled', today);
			return out;
		});
		if (!ok) return;
		this.plugin.store.getState().patchTask(id, {
			evening: on || undefined,
			scheduled: needsSchedule ? today : task.scheduled,
		});
	}

	/** Toggles task-level Someday (a #someday tag on the line). */
	async toggleSomeday(id: string): Promise<void> {
		const task = this.getTask(id);
		if (!task) return;
		const on = task.someday !== true;
		if (!(await this.editTaskLine(task, (l) => setTag(l, 'someday', on)))) return;
		const tags = on
			? [...task.tags, 'someday']
			: task.tags.filter((t) => t !== 'someday');
		this.plugin.store.getState().patchTask(id, { someday: on || undefined, tags });
	}

	/** Toggles one checklist item of a task by the item's block ID. */
	async toggleChecklistItem(parentId: string, itemId: string): Promise<void> {
		const parent = this.getTask(parentId);
		const item = parent?.checklist?.find((c) => c.id === itemId);
		if (!parent || !item) return;
		const file = this.plugin.app.vault.getAbstractFileByPath(parent.file);
		if (!(file instanceof TFile)) return;
		const on = !item.done;
		await this.plugin.app.vault.process(file, (content) => {
			const { lines, sep } = splitLines(content);
			for (let i = 0; i < lines.length; i++) {
				const raw = lines[i];
				if (raw !== undefined && parseTaskLine(raw)?.blockId === itemId) {
					lines[i] = setCheckboxStatus(raw, on ? 'done' : 'todo');
					break;
				}
			}
			return lines.join(sep);
		});
		this.plugin.store.getState().patchTask(parentId, {
			checklist: parent.checklist?.map((c) => (c.id === itemId ? { ...c, done: on } : c)),
		});
	}

	/** Sets or clears the !!!/!! priority token. */
	async setTaskPriority(id: string, priority: 1 | 2 | null): Promise<void> {
		const task = this.getTask(id);
		if (!task) return;
		if (!(await this.editTaskLine(task, (l) => setPriority(l, priority)))) return;
		this.plugin.store.getState().patchTask(id, { priority: priority ?? undefined });
	}

	/** Reschedules every overdue open task to today. Returns the count. */
	async rollOverdueToToday(): Promise<number> {
		const today = todayISO();
		const state = this.plugin.store.getState();
		const overdue = Object.values(state.tasks).filter((t) => {
			if (t.status !== 'todo' || t.someday === true || t.projectStatus === 'someday') return false;
			const date =
				t.scheduled !== undefined && t.due !== undefined
					? t.scheduled < t.due
						? t.scheduled
						: t.due
					: (t.scheduled ?? t.due);
			return date !== undefined && date < today;
		});
		for (const t of overdue) await this.scheduleTask(t.id, today);
		if (overdue.length > 0) {
			new Notice(`TaskFlow: rolled ${overdue.length} task${overdue.length === 1 ? '' : 's'} to today.`);
		}
		return overdue.length;
	}

	/** Moves a task under a different heading within its own file (board drag). */
	async moveToHeading(id: string, heading: string | undefined): Promise<void> {
		const task = this.getTask(id);
		if (!task || task.heading === heading) return;
		const file = this.plugin.app.vault.getAbstractFileByPath(task.file);
		if (!(file instanceof TFile)) return;
		await this.plugin.app.vault.process(file, (content) => {
			const { lines, sep } = splitLines(content);
			const idx = findTaskLine(lines, task);
			if (idx === -1) return content;
			const raw = (lines[idx] ?? '').replace(/^\s+/, '');
			lines.splice(idx, 1);
			const without = lines.join(sep);
			return heading !== undefined
				? insertTaskLine(without, raw, heading)
				: insertTaskLineBeforeHeadings(without, raw);
		});
		this.plugin.store.getState().patchTask(id, { heading });
	}

	/** Persists a manual sort order for one list: index within `ids` wins. */
	async reorderTasks(orderKey: string, ids: string[]): Promise<void> {
		this.plugin.persisted.orders[orderKey] = Object.fromEntries(ids.map((id, i) => [id, i]));
		this.plugin.store.getState().setOrders({ ...this.plugin.persisted.orders });
		await this.plugin.savePersisted();
	}

	/** Removes one History entry (for orphans whose task line no longer exists). */
	async removeLogEntry(taskId: string, completedAt: string): Promise<void> {
		const log = this.plugin.persisted.log;
		const idx = log.findIndex((e) => e.taskId === taskId && e.completedAt === completedAt);
		if (idx === -1) return;
		log.splice(idx, 1);
		this.plugin.store.getState().setLog([...log]);
		await this.plugin.savePersisted();
	}

	/** Appends a completion-log entry and persists; returns the timestamp. */
	private async recordCompletion(
		task: Task,
		status: 'done' | 'cancelled',
		asOf?: string,
	): Promise<string> {
		// Backdated completions get noon local on the chosen day so History,
		// stats, and the daily journal all group under that date.
		const completedAt = asOf ? noonISO(asOf) : new Date().toISOString();
		this.plugin.persisted.completedAt[task.id] = completedAt;
		this.plugin.persisted.log.push({
			taskId: task.id,
			title: task.title,
			project: task.project,
			status,
			completedAt,
		});
		this.plugin.store.getState().setLog([...this.plugin.persisted.log]);
		await this.plugin.savePersisted();
		if (status === 'done') await this.plugin.dailySync.record(task, completedAt);
		return completedAt;
	}

	/** Creates or updates a pinned filter. */
	async saveFilter(filter: SavedFilter): Promise<void> {
		const filters = this.plugin.persisted.filters;
		const idx = filters.findIndex((f) => f.id === filter.id);
		if (idx === -1) filters.push(filter);
		else filters[idx] = filter;
		this.plugin.store.getState().setFilters([...filters]);
		await this.plugin.savePersisted();
	}

	async deleteFilter(id: string): Promise<void> {
		const filters = this.plugin.persisted.filters.filter((f) => f.id !== id);
		this.plugin.persisted.filters = filters;
		this.plugin.store.getState().setFilters([...filters]);
		const route = this.plugin.store.getState().route;
		if (route.kind === 'filter' && route.id === id) {
			this.plugin.store.getState().setRoute({ kind: 'list', list: 'today' });
		}
		await this.plugin.savePersisted();
	}

	async scheduleTask(id: string, target: ScheduleTarget): Promise<void> {
		const date = this.resolveDate(target);
		const task = this.getTask(id);
		if (!task) return;
		if (!(await this.editTaskLine(task, (l) => setDateToken(l, 'scheduled', date)))) return;
		this.plugin.store.getState().patchTask(id, { scheduled: date ?? undefined });
	}

	async setDue(id: string, date: string | null): Promise<void> {
		const task = this.getTask(id);
		if (!task) return;
		if (!(await this.editTaskLine(task, (l) => setDateToken(l, 'due', date)))) return;
		this.plugin.store.getState().patchTask(id, { due: date ?? undefined });
	}

	/**
	 * Moves the task line between files. Inserted into the target first, then
	 * removed from the source — a crash in between leaves a duplicate rather
	 * than a lost task. targetPath null moves to the Inbox.
	 */
	async moveToProject(id: string, targetPath: string | null, heading?: string): Promise<void> {
		const task = this.getTask(id);
		if (!task) return;
		const destPath = targetPath ?? 'Inbox.md';
		if (destPath === task.file) return;

		const source = this.plugin.app.vault.getAbstractFileByPath(task.file);
		if (!(source instanceof TFile)) return;
		const content = await this.plugin.app.vault.read(source);
		const { lines } = splitLines(content);
		const lineNo = findTaskLine(lines, task);
		if (lineNo === -1) {
			new Notice('TaskFlow: task line not found — it may have been edited.');
			return;
		}
		// Moved tasks become top-level items in the destination.
		const raw = (lines[lineNo] ?? '').replace(/^\s+/, '');

		const dest = await this.ensureFile(destPath);
		await this.plugin.app.vault.process(dest, (destContent) =>
			insertTaskLine(destContent, raw, heading),
		);
		await this.plugin.app.vault.process(source, (srcContent) => {
			const { lines: srcLines, sep } = splitLines(srcContent);
			const idx = findTaskLine(srcLines, task);
			if (idx === -1) return srcContent;
			srcLines.splice(idx, 1);
			return srcLines.join(sep);
		});

		const project = targetPath ? this.plugin.store.getState().projects[targetPath] : undefined;
		this.plugin.store.getState().patchTask(id, {
			file: destPath,
			project: targetPath ?? undefined,
			projectStatus: project?.status,
			heading,
		});
	}

	async ensureFile(path: string): Promise<TFile> {
		const existing = this.plugin.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		return this.plugin.app.vault.create(path, '');
	}

	private resolveDate(target: ScheduleTarget): string | null {
		if (target === 'today') return todayISO();
		if (target === 'tomorrow') return addDaysISO(todayISO(), 1);
		return target;
	}
}
