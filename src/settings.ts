import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type TaskFlowPlugin from './main';
import type { CompletionEntry, SavedFilter } from './types';

export interface TaskFlowSettings {
	debugPerf: boolean;
	/** Mirror completions into the day's daily note. */
	dailySync: boolean;
	/** Heading (without #s) the journal lines go under. */
	dailySyncHeading: string;
}

export const DEFAULT_SETTINGS: TaskFlowSettings = {
	debugPerf: false,
	dailySync: true,
	dailySyncHeading: 'Completed',
};

/**
 * Everything persisted via saveData. Markdown is the source of truth for all
 * task fields; this only owns sort order, completion history, and (later)
 * recurrence bookkeeping. Deleting data.json loses nothing else.
 */
export interface PersistedData {
	settings: TaskFlowSettings;
	/** Manual sort order, scoped per list: orderKey -> taskId -> index. */
	orders: Record<string, Record<string, number>>;
	/** Completion timestamps by task ID (ISO datetime). */
	completedAt: Record<string, string>;
	/** Completion log for the History (survives recurring-task rewrites). */
	log: CompletionEntry[];
	/** Pinned smart-list filters shown in the sidebar. */
	filters: SavedFilter[];
	/** ISO datetime of the last completed weekly review. */
	lastReview?: string;
}

export const DEFAULT_PERSISTED: PersistedData = {
	settings: DEFAULT_SETTINGS,
	orders: {},
	completedAt: {},
	log: [],
	filters: [],
};

export class TaskFlowSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: TaskFlowPlugin,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName('Sync completions to daily note')
			.setDesc('Append a journal line to the day’s daily note when a task is completed.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.persisted.settings.dailySync).onChange(async (value) => {
					this.plugin.persisted.settings.dailySync = value;
					await this.plugin.savePersisted();
				}),
			);
		new Setting(containerEl)
			.setName('Daily note heading')
			.setDesc('Heading the completion lines are grouped under (created if missing).')
			.addText((text) =>
				text
					.setValue(this.plugin.persisted.settings.dailySyncHeading)
					.onChange(async (value) => {
						this.plugin.persisted.settings.dailySyncHeading =
							value.replace(/^#+\s*/, '').trim() || 'Completed';
						await this.plugin.savePersisted();
					}),
			);
		new Setting(containerEl)
			.setName('Debug performance logging')
			.setDesc('Log indexer timings to the developer console.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.persisted.settings.debugPerf).onChange(async (value) => {
					this.plugin.persisted.settings.debugPerf = value;
					await this.plugin.savePersisted();
				}),
			);
	}
}
