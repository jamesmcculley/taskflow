import { createStore } from 'zustand/vanilla';
import type { CompletionEntry, ProjectInfo, SavedFilter, Task } from '../types';

export type ListId = 'inbox' | 'today' | 'upcoming' | 'whenever' | 'someday' | 'history' | 'stats';

export type Route =
	| { kind: 'list'; list: ListId }
	| { kind: 'project'; path: string }
	| { kind: 'filter'; id: string }
	| { kind: 'area'; name: string }
	| { kind: 'review' };

export interface TaskFlowState {
	tasks: Record<string, Task>;
	projects: Record<string, ProjectInfo>;
	/** Mirror of the persisted completion log, for reactive views. */
	log: CompletionEntry[];
	/** Mirror of the persisted saved filters. */
	filters: SavedFilter[];
	/** Mirror of persisted per-list manual orders: orderKey -> taskId -> index. */
	orders: Record<string, Record<string, number>>;
	route: Route;
	/** Selected task in the panel (keyboard nav + Quick search target). */
	selectedId: string | null;
	/** Project content layout (board only offered in the wide layout). */
	projectViewMode: 'list' | 'board';
	setRoute: (route: Route) => void;
	select: (id: string | null) => void;
	setProjectViewMode: (mode: 'list' | 'board') => void;
	/** Always pass a fresh array — the store must never alias the persisted log. */
	setLog: (log: CompletionEntry[]) => void;
	/** Always pass a fresh array — same aliasing rule as setLog. */
	setFilters: (filters: SavedFilter[]) => void;
	/** Always pass a fresh object — same aliasing rule as setLog. */
	setOrders: (orders: Record<string, Record<string, number>>) => void;
	/** Replaces everything indexed from one file (tasks + project registration). */
	setFileIndex: (path: string, tasks: Task[], project: ProjectInfo | null) => void;
	removeFile: (path: string) => void;
	renameFile: (oldPath: string, newPath: string) => void;
	/** Optimistic update after a mutation; the debounced reindex reconciles. */
	patchTask: (id: string, patch: Partial<Task>) => void;
}

export type TaskFlowStore = ReturnType<typeof createTaskFlowStore>;

export function createTaskFlowStore() {
	return createStore<TaskFlowState>()((set) => ({
		tasks: {},
		projects: {},
		log: [],
		filters: [],
		orders: {},
		route: { kind: 'list', list: 'today' },
		selectedId: null,
		projectViewMode: 'list',
		setRoute: (route) => set({ route }),
		select: (selectedId) => set({ selectedId }),
		setProjectViewMode: (projectViewMode) => set({ projectViewMode }),
		setLog: (log) => set({ log }),
		setFilters: (filters) => set({ filters }),
		setOrders: (orders) => set({ orders }),
		patchTask: (id, patch) =>
			set((state) => {
				if (!Object.prototype.hasOwnProperty.call(state.tasks, id)) return state;
				const task = state.tasks[id];
				if (!task) return state;
				return { tasks: { ...state.tasks, [id]: { ...task, ...patch } } };
			}),
		setFileIndex: (path, fileTasks, project) =>
			set((state) => {
				const tasks: Record<string, Task> = {};
				for (const t of Object.values(state.tasks)) {
					if (t.file !== path) tasks[t.id] = t;
				}
				for (const t of fileTasks) tasks[t.id] = t;
				const projects = { ...state.projects };
				if (project) projects[path] = project;
				else delete projects[path];
				return { tasks, projects };
			}),
		removeFile: (path) =>
			set((state) => {
				const tasks: Record<string, Task> = {};
				for (const t of Object.values(state.tasks)) {
					if (t.file !== path) tasks[t.id] = t;
				}
				const projects = { ...state.projects };
				delete projects[path];
				return { tasks, projects };
			}),
		renameFile: (oldPath, newPath) =>
			set((state) => {
				const tasks: Record<string, Task> = {};
				for (const t of Object.values(state.tasks)) {
					tasks[t.id] =
						t.file === oldPath
							? {
									...t,
									file: newPath,
									project: t.project === oldPath ? newPath : t.project,
								}
							: t;
				}
				const projects = { ...state.projects };
				const project = projects[oldPath];
				if (project) {
					delete projects[oldPath];
					const name = newPath.split('/').pop()?.replace(/\.md$/, '') ?? newPath;
					projects[newPath] = { ...project, path: newPath, name };
				}
				return { tasks, projects };
			}),
	}));
}
