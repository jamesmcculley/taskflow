import { ItemView } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type TaskFlowPlugin from '../main';
import { App } from './App';

export const VIEW_TYPE_TASKFLOW = 'taskflow-view';
export const HOVER_SOURCE_TASKFLOW = 'taskflow';

export class TaskFlowView extends ItemView {
	private root: Root | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: TaskFlowPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_TASKFLOW;
	}

	override getDisplayText(): string {
		return 'TaskFlow';
	}

	override getIcon(): string {
		return 'check-square';
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass('taskflow-view');
		this.root = createRoot(this.contentEl);
		this.root.render(<App plugin={this.plugin} view={this} />);
	}

	override async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}
}
