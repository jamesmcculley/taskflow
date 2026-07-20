export type TaskStatus = 'todo' | 'done' | 'cancelled';
export type ProjectStatus = 'active' | 'someday' | 'done';

/** A child checkbox rendered inside its parent task, not an independent task. */
export interface ChecklistItem {
	id: string;
	title: string;
	done: boolean;
	line: number;
}

export interface Task {
	id: string;
	/** Line text stripped of metadata tokens. */
	title: string;
	file: string;
	line: number;
	status: TaskStatus;
	/** ISO date — when the task is planned to start. */
	scheduled?: string;
	/** ISO date (hard deadline). */
	due?: string;
	recurrenceText?: string;
	tags: string[];
	/** Project note path; undefined = Inbox. */
	project?: string;
	projectStatus?: ProjectStatus;
	/** Enclosing markdown heading (the task's section). */
	heading?: string;
	order: number;
	/** ISO datetime, index-only. */
	completedAt?: string;
	/** 🌙 flag — shows in Today's "Tonight" section. */
	evening?: boolean;
	/** Task-level Someday (a #someday tag on the line). */
	someday?: boolean;
	checklist?: ChecklistItem[];
	/** 1 = high (!!!), 2 = medium (!!). Sorts above manual order. */
	priority?: 1 | 2;
	/** Optional HH:mm on the scheduled date — sorts Today chronologically. */
	scheduledTime?: string;
}

export interface ProjectInfo {
	path: string;
	name: string;
	status: ProjectStatus;
	/** Area grouping, from `area: <name>` frontmatter. */
	area?: string;
}

export type FilterDate = 'any' | 'overdue' | 'today' | 'this-week' | 'none' | 'has-date';

/** A pinned smart list, persisted in data.json and shown in the sidebar. */
export interface SavedFilter {
	id: string;
	name: string;
	/** Lucide icon name; default "filter". */
	icon?: string;
	/** Every listed tag must be present (nested tags match by prefix). */
	tags?: string[];
	/** Project name, case-insensitive. */
	project?: string;
	/** Area name, case-insensitive. */
	area?: string;
	date?: FilterDate;
	/** Case-insensitive substring of the title. */
	text?: string;
}

/** One entry in the index-owned completion log (survives recurring rewrites). */
export interface CompletionEntry {
	taskId: string;
	title: string;
	/** Project note path at completion time; undefined = Inbox. */
	project?: string;
	status: 'done' | 'cancelled';
	/** ISO datetime. */
	completedAt: string;
}
