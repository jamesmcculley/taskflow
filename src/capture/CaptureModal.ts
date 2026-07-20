import { Modal, Notice } from 'obsidian';
import type TaskFlowPlugin from '../main';
import { insertTaskLine } from '../mutations/lineEdits';
import type { ProjectInfo } from '../types';
import { parseCapture, serializeCaptureLine } from './parser';
import type { CaptureParse } from './parser';

function resolveProject(query: string, projects: ProjectInfo[]): ProjectInfo | undefined {
	const q = query.toLowerCase();
	return (
		projects.find((p) => p.name.toLowerCase() === q) ??
		projects.find((p) => p.name.toLowerCase().startsWith(q)) ??
		projects.find((p) => p.name.toLowerCase().includes(q))
	);
}

export interface CaptureDefaults {
	/** Pre-targeted destination (e.g. the project view the plus button was pressed in). */
	destPath?: string;
	destLabel?: string;
	/** Applied when the input contains no date of its own (e.g. Today view). */
	scheduled?: string;
}

export class CaptureModal extends Modal {
	private parse: CaptureParse = { title: '', tags: [] };

	constructor(
		private plugin: TaskFlowPlugin,
		private defaults: CaptureDefaults = {},
	) {
		super(plugin.app);
	}

	override onOpen(): void {
		this.modalEl.addClass('taskflow-capture-modal');
		this.titleEl.setText('Quick capture');

		const input = this.contentEl.createEl('input', {
			type: 'text',
			cls: 'taskflow-capture-input',
			attr: { placeholder: 'Buy paint tomorrow #home !due friday >Home Renovation' },
		});
		const preview = this.contentEl.createDiv({ cls: 'taskflow-capture-preview' });
		const hint = this.contentEl.createDiv({ cls: 'taskflow-capture-hint' });
		hint.setText('Enter to capture · natural dates schedule · !due <date> · >Project · #tags');

		const renderPreview = () => {
			this.parse = parseCapture(input.value);
			preview.empty();
			if (input.value.trim() === '') return;
			const row = (label: string, value: string) => {
				const el = preview.createDiv({ cls: 'taskflow-capture-row' });
				el.createSpan({ cls: 'taskflow-capture-label', text: label });
				el.createSpan({ text: value });
			};
			row('Task', this.parse.title || '—');
			if (this.parse.priority) row('Priority', this.parse.priority === 1 ? 'High (!!!)' : 'Medium (!!)');
			if (this.parse.scheduled)
				row('When', this.parse.scheduled + (this.parse.scheduledTime ? ` ${this.parse.scheduledTime}` : ''));
			if (this.parse.due) row('Due', this.parse.due);
			if (this.parse.recurrence) row('Repeat', this.parse.recurrence);
			if (this.parse.tags.length > 0) row('Tags', this.parse.tags.map((t) => `#${t}`).join(' '));
			row('To', this.destinationLabel());
		};

		input.addEventListener('input', renderPreview);
		input.addEventListener('keydown', (e) => {
			// isComposing: don't submit mid-IME-composition (CJK input).
			if (e.key === 'Enter' && !e.isComposing) {
				e.preventDefault();
				void this.submit();
			}
		});
		input.focus();
	}

	private destination(): { path: string; label: string } {
		if (this.parse.projectQuery) {
			const projects = Object.values(this.plugin.store.getState().projects);
			const match = resolveProject(this.parse.projectQuery, projects);
			if (match) return { path: match.path, label: match.name };
		}
		if (this.defaults.destPath) {
			return { path: this.defaults.destPath, label: this.defaults.destLabel ?? this.defaults.destPath };
		}
		return { path: 'Inbox.md', label: 'Inbox' };
	}

	private destinationLabel(): string {
		const dest = this.destination();
		if (this.parse.projectQuery && dest.path === 'Inbox.md') {
			return `Inbox (no project matches “${this.parse.projectQuery}”)`;
		}
		return dest.label;
	}

	private async submit(): Promise<void> {
		if (this.parse.title.trim() === '') return;
		const dest = this.destination();
		if (this.parse.scheduled === undefined && this.defaults.scheduled !== undefined) {
			this.parse = { ...this.parse, scheduled: this.defaults.scheduled };
		}
		const line = serializeCaptureLine(this.parse);
		const file = await this.plugin.actions.ensureFile(dest.path);
		await this.plugin.app.vault.process(file, (content) => insertTaskLine(content, line));
		new Notice(`Captured to ${dest.label}: ${this.parse.title}`);
		this.close();
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
