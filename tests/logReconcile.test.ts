import { describe, expect, it } from 'vitest';
import { reconcileLog } from '../src/store/logReconcile';
import type { CompletionEntry, Task } from '../src/types';

function task(over: Partial<Task>): Task {
	return {
		id: 't-a',
		title: 'Test',
		file: 'Inbox.md',
		line: 0,
		status: 'todo',
		tags: [],
		order: 0,
		...over,
	};
}

function entry(over: Partial<CompletionEntry>): CompletionEntry {
	return {
		taskId: 't-a',
		title: 'Test',
		status: 'done',
		completedAt: '2026-07-19T01:23:01.581Z',
		...over,
	};
}

describe('reconcileLog', () => {
	it('drops all entries for a non-recurring task that is open in markdown', () => {
		const log = [
			entry({ completedAt: '2026-07-19T01:23:01.581Z' }),
			entry({ completedAt: '2026-07-19T01:33:00.887Z' }),
		];
		expect(reconcileLog(log, [task({ status: 'todo' })])).toEqual([]);
	});

	it('keeps only the latest entry for a closed non-recurring task', () => {
		const log = [
			entry({ completedAt: '2026-07-19T01:23:01.581Z' }),
			entry({ completedAt: '2026-07-19T01:33:00.887Z' }),
		];
		expect(reconcileLog(log, [task({ status: 'done' })])).toEqual([
			entry({ completedAt: '2026-07-19T01:33:00.887Z' }),
		]);
	});

	it('keeps every entry for recurring tasks, even when open', () => {
		const log = [
			entry({ completedAt: '2026-07-12T09:00:00.000Z' }),
			entry({ completedAt: '2026-07-19T09:00:00.000Z' }),
		];
		expect(reconcileLog(log, [task({ status: 'todo', recurrenceText: 'every week' })])).toBeNull();
	});

	it('leaves entries of other tasks (incl. orphans) untouched', () => {
		const log = [entry({ taskId: 't-gone' }), entry({ taskId: 't-a' })];
		expect(reconcileLog(log, [task({ status: 'todo' })])).toEqual([
			entry({ taskId: 't-gone' }),
		]);
	});

	it('returns null when nothing changes', () => {
		expect(reconcileLog([entry({})], [task({ status: 'done' })])).toBeNull();
		expect(reconcileLog([], [task({ status: 'todo' })])).toBeNull();
	});

	it('handles cancelled like done', () => {
		const log = [
			entry({ status: 'cancelled', completedAt: '2026-07-18T00:00:00.000Z' }),
			entry({ status: 'cancelled', completedAt: '2026-07-19T00:00:00.000Z' }),
		];
		expect(reconcileLog(log, [task({ status: 'cancelled' })])).toEqual([
			entry({ status: 'cancelled', completedAt: '2026-07-19T00:00:00.000Z' }),
		]);
	});
});
