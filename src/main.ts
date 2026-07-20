import { Notice, Plugin, TFile } from 'obsidian';
import type { Editor } from 'obsidian';
import { CaptureModal } from './capture/CaptureModal';
import { DailySync } from './daily/DailySync';
import { TaskIndexer } from './indexer/indexer';
import { parseTaskLine } from './indexer/tokenizer';
import { TaskActions } from './mutations/actions';
import { DEFAULT_PERSISTED, DEFAULT_SETTINGS, TaskFlowSettingTab } from './settings';
import type { PersistedData } from './settings';
import { buildHistoryCsv } from './store/csv';
import { createTaskFlowStore } from './store/store';
import type { TaskFlowStore } from './store/store';
import { own } from './utils';
import { DateSuggestModal } from './views/DateSuggestModal';
import { ProjectSuggestModal } from './views/ProjectSuggestModal';
import { QuickFindModal } from './views/QuickFindModal';
import { HOVER_SOURCE_TASKFLOW, TaskFlowView, VIEW_TYPE_TASKFLOW } from './views/TaskFlowView';

export default class TaskFlowPlugin extends Plugin {
	persisted: PersistedData = DEFAULT_PERSISTED;
	store: TaskFlowStore = createTaskFlowStore();
	actions: TaskActions = new TaskActions(this);
	dailySync: DailySync = new DailySync(this);
	private indexer: TaskIndexer = new TaskIndexer(this);

	override async onload(): Promise<void> {
		await this.loadPersisted();

		this.registerView(VIEW_TYPE_TASKFLOW, (leaf) => new TaskFlowView(leaf, this));
		this.registerHoverLinkSource(HOVER_SOURCE_TASKFLOW, {
			display: 'TaskFlow',
			defaultMod: true,
		});

		this.addCommand({
			id: 'open-sidebar',
			name: 'Open sidebar',
			callback: () => void this.activateView(),
		});
		this.addCommand({
			id: 'quick-capture',
			name: 'Quick capture',
			callback: () => new CaptureModal(this).open(),
		});
		this.addCommand({
			id: 'sync-daily-note',
			name: "Sync today's completions to daily note",
			callback: () => void this.dailySync.backfillToday(),
		});
		this.addCommand({
			id: 'quick-find',
			name: 'Quick search',
			callback: () => new QuickFindModal(this).open(),
		});
		this.addCommand({
			id: 'weekly-review',
			name: 'Start weekly review',
			callback: () => {
				this.store.getState().setRoute({ kind: 'review' });
				void this.activateView();
			},
		});
		this.addCommand({
			id: 'roll-overdue',
			name: 'Roll all overdue tasks to today',
			callback: () => void this.actions.rollOverdueToToday(),
		});
		this.addCommand({
			id: 'export-history-csv',
			name: 'Export History as CSV',
			callback: () => void this.exportHistoryCsv(),
		});
		this.addTaskCommand('priority-high', 'Toggle high priority for task under cursor', (id) => {
			const task = this.store.getState().tasks[id];
			void this.actions.setTaskPriority(id, task?.priority === 1 ? null : 1);
		});
		this.addTaskCommand('priority-medium', 'Toggle medium priority for task under cursor', (id) => {
			const task = this.store.getState().tasks[id];
			void this.actions.setTaskPriority(id, task?.priority === 2 ? null : 2);
		});
		this.addTaskCommand('toggle-evening', 'Toggle Tonight for task under cursor', (id) =>
			void this.actions.toggleEvening(id),
		);
		this.addTaskCommand('toggle-someday', 'Toggle Someday for task under cursor', (id) =>
			void this.actions.toggleSomeday(id),
		);
		this.addTaskCommand('toggle-complete', 'Complete/uncomplete task under cursor', (id) => {
			const task = this.store.getState().tasks[id];
			if (task?.status === 'done') void this.actions.uncompleteTask(id);
			else void this.actions.completeTask(id);
		});
		this.addTaskCommand('cancel-task', 'Cancel task under cursor', (id) =>
			void this.actions.cancelTask(id),
		);
		this.addTaskCommand('schedule-today', 'Schedule task under cursor: today', (id) =>
			void this.actions.scheduleTask(id, 'today'),
		);
		this.addTaskCommand('schedule-tomorrow', 'Schedule task under cursor: tomorrow', (id) =>
			void this.actions.scheduleTask(id, 'tomorrow'),
		);
		this.addTaskCommand('clear-schedule', 'Clear scheduled date of task under cursor', (id) =>
			void this.actions.scheduleTask(id, null),
		);
		this.addTaskCommand('schedule-pick', 'Schedule task under cursor: pick date…', (id) => {
			const task = this.store.getState().tasks[id];
			new DateSuggestModal(this.app, 'Schedule', task?.scheduled !== undefined, (date) => {
				void this.actions.scheduleTask(id, date);
			}).open();
		});
		this.addTaskCommand('due-pick', 'Set deadline of task under cursor: pick date…', (id) => {
			const task = this.store.getState().tasks[id];
			new DateSuggestModal(this.app, 'Deadline', task?.due !== undefined, (date) => {
				void this.actions.setDue(id, date);
			}).open();
		});
		this.addTaskCommand('move-to-project', 'Move task under cursor to project…', (id) => {
			new ProjectSuggestModal(this, (choice) => {
				void this.actions.moveToProject(id, choice.path);
			}).open();
		});

		this.addSettingTab(new TaskFlowSettingTab(this.app, this));
		this.indexer.start();
	}

	override onunload(): void {
		this.indexer.stop();
	}

	/** Registers an editor command that resolves the task on the cursor's line. */
	private addTaskCommand(id: string, name: string, run: (taskId: string) => void): void {
		this.addCommand({
			id,
			name,
			editorCallback: (editor: Editor) => {
				const line = editor.getLine(editor.getCursor().line);
				const blockId = parseTaskLine(line)?.blockId;
				const task = blockId ? own(this.store.getState().tasks, blockId) : undefined;
				if (!task) {
					new Notice('TaskFlow: no indexed task on this line.');
					return;
				}
				run(task.id);
			},
		});
	}

	/** Full re-index — used after settings changes that alter what gets indexed. */
	async rescan(): Promise<void> {
		await this.indexer.fullScan();
	}

	private async exportHistoryCsv(): Promise<void> {
		const csv = buildHistoryCsv(this.persisted.log, this.store.getState().projects);
		const path = 'TaskFlow History.csv';
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) await this.app.vault.modify(existing, csv);
		else await this.app.vault.create(path, csv);
		new Notice(`TaskFlow: exported ${this.persisted.log.length} entries to ${path}`);
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_TASKFLOW)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_TASKFLOW, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	async loadPersisted(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Partial<PersistedData>;
		this.persisted = {
			settings: { ...DEFAULT_SETTINGS, ...raw.settings },
			// Pre-0.9.2 data had a single global `order` map; per-list orders
			// can't be derived from it, so legacy manual sort resets once.
			orders: raw.orders ?? {},
			completedAt: raw.completedAt ?? {},
			log: raw.log ?? [],
			filters: raw.filters ?? [],
			lastReview: raw.lastReview,
		};
		this.store.getState().setLog([...this.persisted.log]);
		this.store.getState().setFilters([...this.persisted.filters]);
		this.store.getState().setOrders({ ...this.persisted.orders });
	}

	async savePersisted(): Promise<void> {
		await this.saveData(this.persisted);
	}
}
