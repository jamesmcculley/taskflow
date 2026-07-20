import type { CompletionEntry, Task } from '../types';

/**
 * Markdown is the source of truth for task status, so the History must follow
 * it: a non-recurring task that is open in markdown has no business in the
 * log (its completion was undone outside the plugin — e.g. the checkbox was
 * unticked in the note), and a closed one keeps only its most recent entry.
 * Recurring tasks are exempt: their lines are rewritten to todo on completion
 * and the log is the only history of past occurrences.
 * Returns the pruned log, or null if nothing changed.
 */
export function reconcileLog(log: CompletionEntry[], tasks: Task[]): CompletionEntry[] | null {
	const drop = new Set<CompletionEntry>();
	for (const task of tasks) {
		if (task.recurrenceText !== undefined) continue;
		const entries = log.filter((e) => e.taskId === task.id);
		if (entries.length === 0) continue;
		const keep =
			task.status === 'todo'
				? null
				: entries.reduce((a, b) => (a.completedAt >= b.completedAt ? a : b));
		for (const e of entries) {
			if (e !== keep) drop.add(e);
		}
	}
	if (drop.size === 0) return null;
	return log.filter((e) => !drop.has(e));
}
