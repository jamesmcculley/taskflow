import { selectFilterTasks } from './filters';
import {
	applyManualOrder,
	selectWheneverTasks,
	selectAreaTasks,
	selectInboxTasks,
	selectProjectGroups,
	selectProjectSomedayTasks,
	selectSomedayTasks,
	selectTodayGroups,
	selectUpcomingGroups,
} from './selectors';
import type { Route } from './store';
import type { ProjectInfo, SavedFilter, Task } from '../types';
import { own } from '../utils';

export interface VisibleState {
	tasks: Record<string, Task>;
	projects: Record<string, ProjectInfo>;
	filters: SavedFilter[];
	/** Per-list manual orders — keeps keyboard order matching render order. */
	orders?: Record<string, Record<string, number>>;
}

/** The flat, in-render-order task list for a route — drives keyboard navigation. */
export function selectVisibleTasks(route: Route, state: VisibleState, today: string): Task[] {
	const { tasks, projects, filters } = state;
	const orders = state.orders ?? {};
	const inOrder = (list: Task[], key: string) => applyManualOrder(list, own(orders, key));
	if (route.kind === 'project') {
		const key = `project:${route.path}`;
		return [
			...selectProjectGroups(tasks, route.path).flatMap((g) => inOrder(g.tasks, key)),
			...selectProjectSomedayTasks(tasks, route.path),
		];
	}
	if (route.kind === 'filter') {
		const filter = filters.find((f) => f.id === route.id);
		return filter ? selectFilterTasks(tasks, filter, projects, today) : [];
	}
	if (route.kind === 'area') {
		return selectAreaTasks(tasks, projects, route.name).flatMap((g) => g.tasks);
	}
	if (route.kind === 'review') return [];
	switch (route.list) {
		case 'inbox':
			return inOrder(selectInboxTasks(tasks), 'list:inbox');
		case 'today': {
			const groups = selectTodayGroups(tasks, today);
			return [
				...groups.overdue,
				...inOrder(groups.today, 'list:today'),
				...inOrder(groups.evening, 'list:today-evening'),
			];
		}
		case 'upcoming':
			return selectUpcomingGroups(tasks, today).flatMap((g) => g.tasks);
		case 'whenever':
			return inOrder(selectWheneverTasks(tasks), 'list:whenever');
		case 'someday':
			return inOrder(selectSomedayTasks(tasks), 'list:someday');
		case 'history':
		case 'stats':
			return [];
	}
}
