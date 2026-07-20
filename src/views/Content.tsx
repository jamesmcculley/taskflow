import { Menu } from 'obsidian';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import type TaskFlowPlugin from '../main';
import { selectFilterTasks } from '../store/filters';
import {
	selectWheneverTasks,
	selectAreaTasks,
	selectInboxTasks,
	selectHistoryGroups,
	selectProjectGroups,
	selectProjectSomedayTasks,
	selectSomedayTasks,
	selectTodayGroups,
	selectUpcomingGroups,
	todayISO,
	upcomingLabel,
} from '../store/selectors';
import type { Route } from '../store/store';
import type { CompletionEntry } from '../types';
import { LIST_META } from './components/Sidebar';
import { ObsidianIcon } from './components/ObsidianIcon';
import { TaskList, TaskRows } from './components/TaskList';
import { BoardView } from './BoardView';
import { ReviewView } from './ReviewView';
import { StatsView } from './StatsView';
import type { TaskFlowView } from './TaskFlowView';

interface ViewProps {
	plugin: TaskFlowPlugin;
	view: TaskFlowView;
	/** Two-pane layout — the board option is only offered here. */
	wide?: boolean;
}

function dayLabel(day: string): string {
	const today = todayISO();
	if (day === today) return 'Today';
	const [y, m, d] = day.split('-').map(Number);
	const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
	return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function TodayView({ plugin, view }: ViewProps) {
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const groups = useMemo(() => selectTodayGroups(tasks, todayISO()), [tasks]);
	return (
		<div className="taskflow-list">
			{groups.overdue.length > 0 && (
				<>
					<div className="taskflow-group-header is-overdue">
						Overdue
						<button
							className="taskflow-roll-button"
							title="Reschedule all overdue tasks to today"
							onClick={() => void plugin.actions.rollOverdueToToday()}
						>
							→ Today
						</button>
					</div>
					<TaskRows tasks={groups.overdue} plugin={plugin} view={view} />
				</>
			)}
			{groups.overdue.length > 0 && groups.today.length > 0 && (
				<div className="taskflow-group-header">Today</div>
			)}
			<TaskRows
				tasks={groups.today}
				plugin={plugin}
				view={view}
				orderKey="list:today"
				emptyMessage={
					groups.overdue.length === 0 && groups.evening.length === 0
						? 'Nothing scheduled for today.'
						: undefined
				}
			/>
			{groups.evening.length > 0 && (
				<>
					<div className="taskflow-group-header taskflow-evening-header">🌙 Tonight</div>
					<TaskRows tasks={groups.evening} plugin={plugin} view={view} orderKey="list:today-evening" />
				</>
			)}
		</div>
	);
}

function AreaView({ plugin, view, name }: ViewProps & { name: string }) {
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const projects = useStore(plugin.store, (s) => s.projects);
	const groups = useMemo(() => selectAreaTasks(tasks, projects, name), [tasks, projects, name]);
	if (groups.length === 0) return <div className="taskflow-empty">No open tasks in this area.</div>;
	return (
		<div className="taskflow-list">
			{groups.map(({ project, tasks: list }) => (
				<div key={project.path}>
					<div className="taskflow-group-header">{project.name}</div>
					<TaskRows tasks={list} plugin={plugin} view={view} hideProject />
				</div>
			))}
		</div>
	);
}

function UpcomingView({ plugin, view }: ViewProps) {
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const groups = useMemo(() => selectUpcomingGroups(tasks, todayISO()), [tasks]);
	if (groups.length === 0) return <div className="taskflow-empty">Nothing upcoming.</div>;
	const today = todayISO();
	return (
		<div className="taskflow-list">
			{groups.map(({ date, tasks: list }) => (
				<div key={date}>
					<div className="taskflow-group-header">
						{upcomingLabel(date, today)}
						<span className="taskflow-group-date">{date}</span>
					</div>
					<TaskRows tasks={list} plugin={plugin} view={view} />
				</div>
			))}
		</div>
	);
}

function HistoryEntry({ entry, plugin }: { entry: CompletionEntry; plugin: TaskFlowPlugin }) {
	const projects = useStore(plugin.store, (s) => s.projects);
	const projectName = entry.project
		? (projects[entry.project]?.name ??
			entry.project.split('/').pop()?.replace(/\.md$/, ''))
		: undefined;
	return (
		<div
			className="taskflow-task taskflow-history-entry"
			onContextMenu={(e) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem((i) =>
					i
						.setTitle('Remove from History')
						.setIcon('trash')
						.onClick(() => void plugin.actions.removeLogEntry(entry.taskId, entry.completedAt)),
				);
				menu.showAtMouseEvent(e.nativeEvent);
			}}>
			<ObsidianIcon
				name={entry.status === 'done' ? 'check' : 'x'}
				className={entry.status === 'done' ? 'taskflow-log-done' : 'taskflow-log-cancelled'}
			/>
			<div className="taskflow-task-body">
				<div className="taskflow-task-title is-closed">{entry.title}</div>
				{projectName && (
					<div className="taskflow-task-meta">
						<span className="taskflow-chip taskflow-chip-project">{projectName}</span>
					</div>
				)}
			</div>
		</div>
	);
}

function HistoryView({ plugin }: ViewProps) {
	const log = useStore(plugin.store, (s) => s.log);
	const groups = useMemo(() => selectHistoryGroups(log), [log]);
	if (groups.length === 0) {
		return <div className="taskflow-empty">Completed tasks will appear here.</div>;
	}
	return (
		<div className="taskflow-list">
			{groups.map(({ day, entries }) => (
				<div key={day}>
					<div className="taskflow-group-header">{dayLabel(day)}</div>
					{entries.map((entry, i) => (
						<HistoryEntry key={`${entry.taskId}-${entry.completedAt}-${i}`} entry={entry} plugin={plugin} />
					))}
				</div>
			))}
		</div>
	);
}

function ProjectView({ plugin, view, path, wide }: ViewProps & { path: string }) {
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const mode = useStore(plugin.store, (s) => s.projectViewMode);
	const groups = useMemo(() => selectProjectGroups(tasks, path), [tasks, path]);
	const someday = useMemo(() => selectProjectSomedayTasks(tasks, path), [tasks, path]);
	if (wide && mode === 'board') {
		return <BoardView plugin={plugin} view={view} path={path} />;
	}
	if (groups.length === 0 && someday.length === 0)
		return <div className="taskflow-empty">No open tasks.</div>;
	return (
		<div className="taskflow-list">
			{groups.map(({ heading, tasks: list }) => (
				<div key={heading ?? ''}>
					{heading !== undefined && <div className="taskflow-group-header">{heading}</div>}
					<TaskRows tasks={list} plugin={plugin} view={view} hideProject orderKey={`project:${path}`} />
				</div>
			))}
			{someday.length > 0 && (
				<div className="taskflow-project-someday">
					<div className="taskflow-group-header">Someday</div>
					<TaskRows tasks={someday} plugin={plugin} view={view} hideProject />
				</div>
			)}
		</div>
	);
}

export function contentTitle(route: Route, plugin: TaskFlowPlugin): { title: string; icon: string } {
	if (route.kind === 'project') {
		const project = plugin.store.getState().projects[route.path];
		return { title: project?.name ?? route.path, icon: 'circle-dashed' };
	}
	if (route.kind === 'filter') {
		const filter = plugin.store.getState().filters.find((f) => f.id === route.id);
		return { title: filter?.name ?? 'Filter', icon: filter?.icon ?? 'filter' };
	}
	if (route.kind === 'area') {
		return { title: route.name, icon: 'folder' };
	}
	if (route.kind === 'review') {
		return { title: 'Review', icon: 'clipboard-check' };
	}
	if (route.list === 'stats') {
		return { title: 'Stats', icon: 'activity' };
	}
	const meta = LIST_META.find((m) => m.list === route.list);
	return { title: meta?.label ?? '', icon: meta?.icon ?? 'list' };
}

export function Content({ plugin, view, wide }: ViewProps) {
	const route = useStore(plugin.store, (s) => s.route);
	const tasks = useStore(plugin.store, (s) => s.tasks);
	const projects = useStore(plugin.store, (s) => s.projects);
	const filters = useStore(plugin.store, (s) => s.filters);

	if (route.kind === 'project') {
		return <ProjectView plugin={plugin} view={view} path={route.path} wide={wide} />;
	}
	if (route.kind === 'area') {
		return <AreaView plugin={plugin} view={view} name={route.name} />;
	}
	if (route.kind === 'review') {
		return <ReviewView plugin={plugin} view={view} />;
	}
	if (route.kind === 'filter') {
		const filter = filters.find((f) => f.id === route.id);
		if (!filter) return <div className="taskflow-empty">Filter not found.</div>;
		return (
			<TaskList
				tasks={selectFilterTasks(tasks, filter, projects, todayISO())}
				plugin={plugin}
				view={view}
				emptyMessage="No tasks match this filter."
			/>
		);
	}
	switch (route.list) {
		case 'today':
			return <TodayView plugin={plugin} view={view} />;
		case 'upcoming':
			return <UpcomingView plugin={plugin} view={view} />;
		case 'history':
			return <HistoryView plugin={plugin} view={view} />;
		case 'stats':
			return <StatsView plugin={plugin} />;
		case 'inbox':
			return (
				<TaskList
					tasks={selectInboxTasks(tasks)}
					plugin={plugin}
					view={view}
					orderKey="list:inbox"
					emptyMessage="Inbox is empty."
				/>
			);
		case 'whenever':
			return (
				<TaskList
					tasks={selectWheneverTasks(tasks)}
					plugin={plugin}
					view={view}
					orderKey="list:whenever"
					emptyMessage="No unscheduled tasks in active projects."
				/>
			);
		case 'someday':
			return (
				<TaskList
					tasks={selectSomedayTasks(tasks)}
					plugin={plugin}
					view={view}
					orderKey="list:someday"
					emptyMessage="No someday tasks."
				/>
			);
	}
}
