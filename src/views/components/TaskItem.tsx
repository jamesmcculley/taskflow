import { TFile } from 'obsidian';
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type TaskFlowPlugin from '../../main';
import { diffDaysISO, todayISO } from '../../store/selectors';
import type { Task } from '../../types';
import { DateSuggestModal } from '../DateSuggestModal';
import { showTaskMenu } from '../taskMenu';
import { HOVER_SOURCE_TASKFLOW } from '../TaskFlowView';
import type { TaskFlowView } from '../TaskFlowView';

function formatChipDate(iso: string): string {
	const today = todayISO();
	if (iso === today) return 'Today';
	const [y, m, d] = iso.split('-').map(Number);
	if (y === undefined || m === undefined || d === undefined) return iso;
	const date = new Date(y, m - 1, d);
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	if (iso === todayISO(tomorrow)) return 'Tomorrow';
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function deadlineBadge(due: string, today: string): { text: string; urgent: boolean } | null {
	const days = diffDaysISO(today, due);
	if (days < 0) return { text: `${-days}d overdue`, urgent: true };
	if (days === 0) return { text: 'due today', urgent: true };
	if (days <= 14) return { text: `${days}d left`, urgent: days <= 2 };
	return null;
}

export async function openTaskSource(plugin: TaskFlowPlugin, task: Task): Promise<void> {
	const file = plugin.app.vault.getAbstractFileByPath(task.file);
	if (!(file instanceof TFile)) return;
	const leaf = plugin.app.workspace.getLeaf(false);
	await leaf.openFile(file, { eState: { line: task.line } });
}

export function TaskItem({
	task,
	plugin,
	view,
	hideSource,
	lingering,
}: {
	task: Task;
	plugin: TaskFlowPlugin;
	view: TaskFlowView;
	/** Suppress the source-note chip — used inside that note's own project/area view, where it's redundant. */
	hideSource?: boolean;
	lingering?: boolean;
}) {
	const selectedId = useStore(plugin.store, (s) => s.selectedId);
	const select = useStore(plugin.store, (s) => s.select);
	const selected = selectedId === task.id;
	const rowRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
	}, [selected]);

	// The note a task lives in, shown as a tag-like chip regardless of whether
	// that note is a project — Inbox/daily-note/plain-note tasks previously had
	// no visible indicator of where they came from.
	const sourceName = task.file.split('/').pop()?.replace(/\.md$/, '');
	const today = todayISO();
	const badge = task.due && task.status === 'todo' ? deadlineBadge(task.due, today) : null;

	return (
		<div
			ref={rowRef}
			className={`taskflow-task ${selected ? 'is-selected' : ''} ${lingering ? 'is-lingering' : ''}`}
			onClick={() => select(task.id)}
			onDoubleClick={() => void openTaskSource(plugin, task)}
			onContextMenu={(e) => {
				e.preventDefault();
				select(task.id);
				showTaskMenu(plugin, task, e.nativeEvent);
			}}
			onMouseOver={(e) => {
				plugin.app.workspace.trigger('hover-link', {
					event: e.nativeEvent,
					source: HOVER_SOURCE_TASKFLOW,
					hoverParent: view,
					targetEl: e.currentTarget,
					linktext: task.file,
					sourcePath: task.file,
				});
			}}
		>
			<input
				type="checkbox"
				className="taskflow-task-checkbox"
				checked={task.status === 'done'}
				data-status={task.status}
				onClick={(e) => e.stopPropagation()}
				onChange={() => {
					if (task.status === 'done') void plugin.actions.uncompleteTask(task.id);
					else void plugin.actions.completeTask(task.id);
				}}
			/>
			<div className="taskflow-task-body">
				<div
					className={`taskflow-task-title ${task.status !== 'todo' ? 'is-closed' : ''}`}
				>
					{task.title}
				</div>
				{selected && task.checklist && task.checklist.length > 0 && (
					<div className="taskflow-checklist">
						{task.checklist.map((item) => (
							<label
								key={item.id}
								className="taskflow-checklist-item"
								onClick={(e) => e.stopPropagation()}
							>
								<input
									type="checkbox"
									className="taskflow-task-checkbox taskflow-checklist-checkbox"
									checked={item.done}
									onChange={() => void plugin.actions.toggleChecklistItem(task.id, item.id)}
								/>
								<span className={item.done ? 'is-closed' : ''}>{item.title}</span>
							</label>
						))}
					</div>
				)}
				<div className="taskflow-task-meta">
					{task.priority && (
						<span
							className={`taskflow-chip taskflow-chip-priority is-p${task.priority}`}
						>
							{task.priority === 1 ? '!!!' : '!!'}
						</span>
					)}
					{task.checklist && task.checklist.length > 0 && (
						<span className="taskflow-chip taskflow-chip-checklist">
							☑ {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
						</span>
					)}
					{task.evening && <span className="taskflow-chip taskflow-chip-evening">🌙 evening</span>}
					{sourceName && !hideSource && (
						<span className="taskflow-chip taskflow-chip-source" title={task.file}>
							#{sourceName}
						</span>
					)}
					{task.heading && <span className="taskflow-chip taskflow-chip-heading">{task.heading}</span>}
					{task.scheduled && (
						<span
							className={`taskflow-chip taskflow-chip-date taskflow-chip-clickable ${task.scheduled < today ? 'is-overdue' : ''}`}
							title="Reschedule…"
							onClick={(e) => {
								e.stopPropagation();
								new DateSuggestModal(plugin.app, 'Schedule', true, (date) => {
									void plugin.actions.scheduleTask(task.id, date);
								}).open();
							}}
						>
							⏳ {formatChipDate(task.scheduled)}
							{task.scheduledTime ? ` ${task.scheduledTime}` : ''}
						</span>
					)}
					{task.due && (
						<span
							className={`taskflow-chip taskflow-chip-due taskflow-chip-clickable ${task.due < today ? 'is-overdue' : ''}`}
							title="Change deadline…"
							onClick={(e) => {
								e.stopPropagation();
								new DateSuggestModal(plugin.app, 'Deadline', true, (date) => {
									void plugin.actions.setDue(task.id, date);
								}).open();
							}}
						>
							📅 {formatChipDate(task.due)}
						</span>
					)}
					{badge && (
						<span className={`taskflow-chip taskflow-chip-deadline ${badge.urgent ? 'is-overdue' : ''}`}>
							{badge.text}
						</span>
					)}
					{task.recurrenceText && (
						<span className="taskflow-chip taskflow-chip-recur">🔁 {task.recurrenceText}</span>
					)}
					{task.tags
						.filter((tag) => tag !== 'someday')
						.map((tag) => (
							<span key={tag} className="taskflow-chip taskflow-chip-tag">
								#{tag}
							</span>
						))}
				</div>
			</div>
		</div>
	);
}
