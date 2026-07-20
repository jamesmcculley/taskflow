import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type TaskFlowPlugin from '../main';
import {
	applyManualOrder,
	selectProjectGroups,
	selectProjectSomedayTasks,
} from '../store/selectors';
import { own } from '../utils';
import { TaskItem } from './components/TaskItem';
import type { TaskFlowView } from './TaskFlowView';

/**
 * Kanban layout for a project: columns are the project's headings, dragging a
 * card between columns moves the task line under the target heading.
 */
export function BoardView({
	plugin,
	view,
	path,
}: {
	plugin: TaskFlowPlugin;
	view: TaskFlowView;
	path: string;
}) {
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const orders = useStore(plugin.store, (s) => s.orders);
	// Same manual order the project's list view uses, so both layouts agree.
	const groups = useMemo(
		() =>
			selectProjectGroups(tasks, path).map((g) => ({
				...g,
				tasks: applyManualOrder(g.tasks, own(orders, `project:${path}`)),
			})),
		[tasks, orders, path],
	);
	const someday = useMemo(() => selectProjectSomedayTasks(tasks, path), [tasks, path]);
	const [dragId, setDragId] = useState<string | null>(null);

	if (groups.length === 0 && someday.length === 0) {
		return <div className="taskflow-empty">No open tasks.</div>;
	}

	const dropOn = (heading: string | undefined) => {
		if (dragId) void plugin.actions.moveToHeading(dragId, heading);
		setDragId(null);
	};

	const column = (
		key: string,
		heading: string | undefined,
		list: typeof groups[number]['tasks'],
		dimmed = false,
	) => (
		<div
			key={key}
			className={`taskflow-board-column ${dimmed ? 'is-dimmed' : ''}`}
			onDragOver={(e) => {
				if (dragId) e.preventDefault();
			}}
			onDrop={(e) => {
				e.preventDefault();
				if (!dimmed) dropOn(heading);
			}}
		>
			<div className="taskflow-board-column-header">
				{heading ?? 'No heading'}
				<span className="taskflow-nav-count">{list.length}</span>
			</div>
			{list.map((t) => (
				<div
					key={t.id}
					draggable={!dimmed}
					className={dragId === t.id ? 'taskflow-dragging' : ''}
					onDragStart={() => setDragId(t.id)}
					onDragEnd={() => setDragId(null)}
				>
					<TaskItem task={t} plugin={plugin} view={view} hideSource />
				</div>
			))}
		</div>
	);

	return (
		<div className="taskflow-board">
			{groups.map(({ heading, tasks: list }) => column(`h:${heading ?? ''}`, heading, list))}
			{someday.length > 0 && column('__someday__', 'Someday', someday, true)}
		</div>
	);
}
