/**
 * End-to-end tests: the REAL TaskActions + DailySync run against an in-memory
 * vault (obsidian module aliased to tests/mocks/obsidian.ts). A mini indexer
 * turns fixture markdown into store state; assertions check both the store
 * and the resulting markdown bytes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeVault } from './mocks/obsidian';
import { parseCapture, serializeCaptureLine } from '../src/capture/parser';
import { DailySync } from '../src/daily/DailySync';
import { parseTaskLine } from '../src/indexer/tokenizer';
import { TaskActions } from '../src/mutations/actions';
import { insertTaskLine } from '../src/mutations/lineEdits';
import { addDaysISO, todayISO } from '../src/store/selectors';
import { createTaskFlowStore } from '../src/store/store';
import type TaskFlowPlugin from '../src/main';
import type { ProjectInfo, Task } from '../src/types';

const TODAY = todayISO();
const TOMORROW = addDaysISO(TODAY, 1);

interface Harness {
	plugin: TaskFlowPlugin;
	vault: FakeVault;
	actions: TaskActions;
	reindex: () => void;
	fileContent: (path: string) => string;
	task: (id: string) => Task | undefined;
}

function makeHarness(files: Record<string, string>): Harness {
	const vault = new FakeVault();
	vault.seed(files);
	const store = createTaskFlowStore();
	const plugin = {
		app: { vault },
		store,
		persisted: {
			settings: { debugPerf: false, dailySync: true, dailySyncHeading: 'Completed' },
			orders: {},
			completedAt: {},
			log: [],
			filters: [],
		},
		savePersisted: async () => undefined,
	} as unknown as TaskFlowPlugin;
	const actions = new TaskActions(plugin);
	const dailySync = new DailySync(plugin);
	(plugin as { actions: TaskActions }).actions = actions;
	(plugin as { dailySync: DailySync }).dailySync = dailySync;

	const indexFile = (path: string) => {
		const content = vault.files.get(path) ?? '';
		const lines = content.split('\n');
		const fm: Record<string, string> = {};
		if (lines[0] === '---') {
			for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
				const m = /^(\w+):\s*(.+)$/.exec(lines[i] ?? '');
				if (m) fm[m[1] ?? ''] = m[2] ?? '';
			}
		}
		const isProject = fm.type === 'project';
		const project: ProjectInfo | null = isProject
			? {
					path,
					name: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
					status: (fm.status as ProjectInfo['status']) ?? 'active',
					area: fm.area,
				}
			: null;
		let heading: string | undefined;
		const tasks: Task[] = [];
		lines.forEach((raw, line) => {
			const h = /^#{1,6}\s+(.+?)\s*$/.exec(raw);
			if (h) heading = h[1];
			if (/^\s/.test(raw)) return; // flat model: skip checklist children
			const parsed = parseTaskLine(raw);
			if (!parsed?.blockId) return;
			tasks.push({
				id: parsed.blockId,
				title: parsed.title,
				file: path,
				line,
				status: parsed.status,
				scheduled: parsed.scheduled,
				due: parsed.due,
				recurrenceText: parsed.recurrenceText,
				tags: parsed.tags,
				project: isProject ? path : undefined,
				projectStatus: project?.status,
				heading,
				order: line,
				evening: parsed.evening || undefined,
				someday: parsed.tags.includes('someday') || undefined,
				priority: parsed.priority,
				scheduledTime: parsed.scheduledTime,
				completedAt: plugin.persisted.completedAt[parsed.blockId],
			});
		});
		store.getState().setFileIndex(path, tasks, project);
	};
	const reindex = () => {
		for (const path of vault.files.keys()) if (path.endsWith('.md')) indexFile(path);
	};
	reindex();

	return {
		plugin,
		vault,
		actions,
		reindex,
		fileContent: (path) => vault.files.get(path) ?? '',
		task: (id) => store.getState().tasks[id],
	};
}

const INBOX = ['# Inbox', '', '- [ ] Pay bill 📅 2026-01-05 ^t-bill', '- [ ] Call mom ^t-mom', ''].join('\n');
const PROJECT = [
	'---',
	'type: project',
	'status: active',
	'---',
	'',
	'# Site',
	'',
	'## Design',
	'',
	'- [ ] Moodboard ^t-mood',
	'',
	'## Build',
	'',
	`- [ ] Weekly email 🔁 every week ⏳ ${TODAY} ^t-mail`,
	'- [ ] Deploy ^t-deploy',
	'',
].join('\n');

let h: Harness;
beforeEach(() => {
	h = makeHarness({ 'Inbox.md': INBOX, 'Projects/Site.md': PROJECT });
});

describe('e2e: completion lifecycle', () => {
	it('complete writes [x] + stamp, logs, and journals to the daily note', async () => {
		await h.actions.completeTask('t-mom');
		expect(h.fileContent('Inbox.md')).toContain(`- [x] Call mom ✅ ${TODAY} ^t-mom`);
		expect(h.plugin.persisted.log).toHaveLength(1);
		expect(h.plugin.persisted.log[0]).toMatchObject({ taskId: 't-mom', status: 'done' });
		const daily = h.fileContent(`${TODAY}.md`);
		expect(daily).toContain('## Completed');
		expect(daily).toContain('Call mom');
		expect(daily).toContain('%%t-mom%%');
	});

	it('uncomplete restores the line byte-for-byte and cleans log + journal', async () => {
		const before = h.fileContent('Inbox.md');
		await h.actions.completeTask('t-mom');
		h.reindex();
		await h.actions.uncompleteTask('t-mom');
		expect(h.fileContent('Inbox.md')).toBe(before);
		expect(h.plugin.persisted.log).toHaveLength(0);
		expect(h.fileContent(`${TODAY}.md`)).not.toContain('%%t-mom%%');
	});

	it('recurring completion rewrites the line as the next occurrence', async () => {
		await h.actions.completeTask('t-mail');
		const content = h.fileContent('Projects/Site.md');
		expect(content).toContain(`- [ ] Weekly email 🔁 every week ⏳ ${addDaysISO(TODAY, 7)} ^t-mail`);
		expect(content).not.toContain('✅');
		expect(h.plugin.persisted.log[0]).toMatchObject({ taskId: 't-mail', status: 'done' });
		expect(h.fileContent(`${TODAY}.md`)).toContain('Weekly email');
	});

	it('backdated completion stamps and journals on the chosen day', async () => {
		const asOf = addDaysISO(TODAY, -3);
		await h.actions.completeTask('t-mom', asOf);
		expect(h.fileContent('Inbox.md')).toContain(`- [x] Call mom ✅ ${asOf} ^t-mom`);
		expect(h.fileContent(`${asOf}.md`)).toContain('Call mom');
		expect(h.fileContent(`${TODAY}.md`)).toBe('');
		const entryDay = todayISO(new Date(h.plugin.persisted.log[0]?.completedAt ?? ''));
		expect(entryDay).toBe(asOf);
	});

	it('editCompletionDate corrects the ✅ stamp, log day, and journal placement', async () => {
		await h.actions.completeTask('t-mom');
		const original = h.plugin.persisted.log[0]!;
		const corrected = addDaysISO(TODAY, -2);
		await h.actions.editCompletionDate('t-mom', original.completedAt, corrected);

		expect(h.fileContent('Inbox.md')).toContain(`- [x] Call mom ✅ ${corrected} ^t-mom`);
		expect(h.plugin.persisted.log).toHaveLength(1);
		expect(todayISO(new Date(h.plugin.persisted.log[0]!.completedAt))).toBe(corrected);
		expect(h.fileContent(`${TODAY}.md`)).not.toContain('%%t-mom%%');
		expect(h.fileContent(`${corrected}.md`)).toContain('%%t-mom%%');

		h.reindex();
		expect(h.task('t-mom')?.completedAt).toBe(h.plugin.persisted.log[0]!.completedAt);
	});

	it('editCompletionDate on a historical (non-live) entry only touches the log + journal', async () => {
		// Complete the recurring task twice; its line never keeps a ✅ stamp
		// (recurrence rewrites it to the next occurrence), so both completions
		// are purely historical from the moment they're recorded.
		await h.actions.completeTask('t-mail');
		const first = h.plugin.persisted.log[0]!;
		const before = h.fileContent('Projects/Site.md');
		const corrected = addDaysISO(TODAY, -10);

		await h.actions.editCompletionDate('t-mail', first.completedAt, corrected);

		expect(h.fileContent('Projects/Site.md')).toBe(before); // line untouched
		expect(todayISO(new Date(h.plugin.persisted.log[0]!.completedAt))).toBe(corrected);
		expect(h.fileContent(`${corrected}.md`)).toContain('Weekly email');
		expect(h.fileContent(`${TODAY}.md`)).not.toContain('Weekly email');
	});

	it('editCompletionDate ignores cancelled entries and unknown entries', async () => {
		await h.actions.cancelTask('t-mom');
		const cancelled = h.plugin.persisted.log[0]!;
		const before = [...h.plugin.persisted.log];
		await h.actions.editCompletionDate('t-mom', cancelled.completedAt, addDaysISO(TODAY, -1));
		expect(h.plugin.persisted.log).toEqual(before);

		const before2 = [...h.plugin.persisted.log];
		await h.actions.editCompletionDate('t-nope', new Date().toISOString(), TODAY);
		expect(h.plugin.persisted.log).toEqual(before2);
	});

	it('cancel marks [-] with an index-only timestamp and no journal line', async () => {
		await h.actions.cancelTask('t-mom');
		expect(h.fileContent('Inbox.md')).toContain('- [-] Call mom ^t-mom');
		expect(h.plugin.persisted.log[0]?.status).toBe('cancelled');
		expect(h.fileContent(`${TODAY}.md`)).toBe('');
	});
});

describe('e2e: scheduling', () => {
	it('schedule today/tomorrow/clear round-trips the markdown', async () => {
		await h.actions.scheduleTask('t-mom', 'today');
		expect(h.fileContent('Inbox.md')).toContain(`- [ ] Call mom ⏳ ${TODAY} ^t-mom`);
		h.reindex();
		await h.actions.scheduleTask('t-mom', 'tomorrow');
		expect(h.fileContent('Inbox.md')).toContain(`- [ ] Call mom ⏳ ${TOMORROW} ^t-mom`);
		h.reindex();
		await h.actions.scheduleTask('t-mom', null);
		expect(h.fileContent('Inbox.md')).toContain('- [ ] Call mom ^t-mom');
	});

	it('rollOverdueToToday reschedules everything that slipped', async () => {
		const count = await h.actions.rollOverdueToToday();
		expect(count).toBe(1); // t-bill (due 2026-01-05)
		expect(h.fileContent('Inbox.md')).toContain(
			`- [ ] Pay bill 📅 2026-01-05 ⏳ ${TODAY} ^t-bill`,
		);
	});

	it('reorderTasks scopes manual order to one list', async () => {
		await h.actions.reorderTasks('list:inbox', ['t-mom', 't-bill']);
		expect(h.plugin.persisted.orders['list:inbox']).toEqual({ 't-mom': 0, 't-bill': 1 });
		expect(h.plugin.persisted.orders['list:today']).toBeUndefined();
		expect(h.plugin.store.getState().orders['list:inbox']).toEqual({ 't-mom': 0, 't-bill': 1 });
	});

	it('setTaskPriority round-trips the token', async () => {
		await h.actions.setTaskPriority('t-mom', 1);
		expect(h.fileContent('Inbox.md')).toContain('- [ ] Call mom !!! ^t-mom');
		h.reindex();
		expect(h.task('t-mom')?.priority).toBe(1);
		await h.actions.setTaskPriority('t-mom', null);
		expect(h.fileContent('Inbox.md')).toContain('- [ ] Call mom ^t-mom');
	});
});

describe('e2e: moving tasks', () => {
	it('moveToProject moves the line under the target heading', async () => {
		await h.actions.moveToProject('t-mom', 'Projects/Site.md', 'Design');
		expect(h.fileContent('Inbox.md')).not.toContain('t-mom');
		const project = h.fileContent('Projects/Site.md');
		const design = project.slice(project.indexOf('## Design'), project.indexOf('## Build'));
		expect(design).toContain('- [ ] Call mom ^t-mom');
	});

	it('moveToHeading (board drag) relocates within the file', async () => {
		await h.actions.moveToHeading('t-mood', 'Build');
		const project = h.fileContent('Projects/Site.md');
		const build = project.slice(project.indexOf('## Build'));
		expect(build).toContain('^t-mood');
		const design = project.slice(project.indexOf('## Design'), project.indexOf('## Build'));
		expect(design).not.toContain('^t-mood');
	});

	it('moveToHeading undefined inserts above the first heading', async () => {
		await h.actions.moveToHeading('t-deploy', undefined);
		const project = h.fileContent('Projects/Site.md');
		expect(project.indexOf('^t-deploy')).toBeLessThan(project.indexOf('# Site'));
	});
});

describe('e2e: checklist toggle', () => {
	it('toggles a child line by block id', async () => {
		h.vault.seed({
			'List.md': ['- [ ] Parent ^t-parent', '\t- [ ] Child ^t-child', ''].join('\n'),
		});
		h.reindex();
		h.plugin.store.getState().patchTask('t-parent', {
			checklist: [{ id: 't-child', title: 'Child', done: false, line: 1 }],
		});
		await h.actions.toggleChecklistItem('t-parent', 't-child');
		expect(h.fileContent('List.md')).toContain('\t- [x] Child ^t-child');
	});
});

describe('e2e: capture pipeline', () => {
	it('parse → serialize → insert lands a full task line in the inbox', () => {
		const parse = parseCapture('Buy paint tomorrow !! every week #home', new Date());
		const line = serializeCaptureLine(parse);
		const content = insertTaskLine(h.fileContent('Inbox.md'), line);
		const last = content.trimEnd().split('\n').pop() ?? '';
		const reparsed = parseTaskLine(last);
		expect(reparsed?.title).toBe('Buy paint');
		expect(reparsed?.priority).toBe(2);
		expect(reparsed?.scheduled).toBe(TOMORROW);
		expect(reparsed?.recurrenceText).toBe('every week');
		expect(reparsed?.tags).toEqual(['home']);
	});
});
