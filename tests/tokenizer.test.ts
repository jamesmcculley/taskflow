import { describe, expect, it } from 'vitest';
import { appendBlockId, isTaskLine, parseTaskLine } from '../src/indexer/tokenizer';

describe('parseTaskLine', () => {
	it('parses a bare todo', () => {
		const t = parseTaskLine('- [ ] Buy milk');
		expect(t).toMatchObject({ status: 'todo', title: 'Buy milk', tags: [] });
		expect(t?.scheduled).toBeUndefined();
		expect(t?.blockId).toBeUndefined();
	});

	it('parses done and cancelled statuses', () => {
		expect(parseTaskLine('- [x] Done thing')?.status).toBe('done');
		expect(parseTaskLine('- [X] Done thing')?.status).toBe('done');
		expect(parseTaskLine('- [-] Skipped thing')?.status).toBe('cancelled');
	});

	it('indexes unknown status chars as todo', () => {
		expect(parseTaskLine('- [/] In progress')?.status).toBe('todo');
		expect(parseTaskLine('- [>] Forwarded')?.status).toBe('todo');
	});

	it('returns null for non-task lines', () => {
		expect(parseTaskLine('Just a paragraph')).toBeNull();
		expect(parseTaskLine('- A plain list item')).toBeNull();
		expect(parseTaskLine('## A heading')).toBeNull();
		expect(isTaskLine('- [ ] yes')).toBe(true);
		expect(isTaskLine('- no')).toBe(false);
	});

	it('supports * and numbered list markers', () => {
		expect(parseTaskLine('* [ ] Star task')?.title).toBe('Star task');
		expect(parseTaskLine('1. [x] Numbered task')?.status).toBe('done');
		expect(parseTaskLine('  - [ ] Indented subtask')?.title).toBe('Indented subtask');
	});

	it('extracts scheduled and due dates', () => {
		const t = parseTaskLine('- [ ] Ship it ⏳ 2026-07-21 📅 2026-07-28');
		expect(t?.scheduled).toBe('2026-07-21');
		expect(t?.due).toBe('2026-07-28');
		expect(t?.title).toBe('Ship it');
	});

	it('extracts the completion stamp', () => {
		const t = parseTaskLine('- [x] Audit current site ✅ 2026-07-15');
		expect(t?.completedDate).toBe('2026-07-15');
		expect(t?.title).toBe('Audit current site');
	});

	it('extracts recurrence text up to the next token', () => {
		const t = parseTaskLine('- [ ] Progress email 🔁 every week ⏳ 2026-07-20 #comms');
		expect(t?.recurrenceText).toBe('every week');
		expect(t?.scheduled).toBe('2026-07-20');
		expect(t?.tags).toEqual(['comms']);
		expect(t?.title).toBe('Progress email');
	});

	it('extracts recurrence text at end of line', () => {
		expect(parseTaskLine('- [ ] Water plants 🔁 every 3 days')?.recurrenceText).toBe(
			'every 3 days',
		);
	});

	it('stops recurrence text at a block ref', () => {
		const t = parseTaskLine('- [ ] Practice 🔁 every weekday ^t-abc123');
		expect(t?.recurrenceText).toBe('every weekday');
		expect(t?.blockId).toBe('t-abc123');
	});

	it('extracts tags but not mid-word hashes', () => {
		const t = parseTaskLine('- [ ] Learn C# basics #learning #dev/backend');
		expect(t?.tags).toEqual(['learning', 'dev/backend']);
		expect(t?.title).toBe('Learn C# basics');
	});

	it('ignores purely numeric tags', () => {
		const t = parseTaskLine('- [ ] Issue #123 fix #bug');
		expect(t?.tags).toEqual(['bug']);
		expect(t?.title).toBe('Issue #123 fix');
	});

	it('extracts a trailing block id', () => {
		const t = parseTaskLine('- [ ] Create moodboard ⏳ 2026-07-18 #design ^t-seed01');
		expect(t?.blockId).toBe('t-seed01');
		expect(t?.title).toBe('Create moodboard');
	});

	it('reuses any pre-existing block ref as the id', () => {
		expect(parseTaskLine('- [ ] Old note ^abc123def')?.blockId).toBe('abc123def');
	});

	it('parses a line with every metadata field', () => {
		const t = parseTaskLine(
			'- [x] The works ⏳ 2026-07-18 📅 2026-07-25 🔁 every week #a #b/c ✅ 2026-07-18 ^t-zzz999',
		);
		expect(t).toEqual({
			status: 'done',
			title: 'The works',
			scheduled: '2026-07-18',
			due: '2026-07-25',
			completedDate: '2026-07-18',
			recurrenceText: 'every week',
			tags: ['a', 'b/c'],
			blockId: 't-zzz999',
			evening: false,
			priority: undefined,
			scheduledTime: undefined,
		});
	});

	it('parses the 🌙 evening flag and strips it from the title', () => {
		const t = parseTaskLine('- [ ] Review dashboards 🌙 ⏳ 2026-07-19 #dev');
		expect(t?.evening).toBe(true);
		expect(t?.title).toBe('Review dashboards');
		expect(t?.scheduled).toBe('2026-07-19');
		expect(parseTaskLine('- [ ] Plain task')?.evening).toBe(false);
	});

	it('stops recurrence text at the 🌙 flag', () => {
		const t = parseTaskLine('- [ ] Wind down 🔁 every day 🌙');
		expect(t?.recurrenceText).toBe('every day');
		expect(t?.evening).toBe(true);
	});

	it('parses !!/!!! priority tokens, standalone only', () => {
		expect(parseTaskLine('- [ ] Ship it !!!')?.priority).toBe(1);
		expect(parseTaskLine('- [ ] Ship it !! ⏳ 2026-07-20')?.priority).toBe(2);
		expect(parseTaskLine('- [ ] Ship it !!')?.title).toBe('Ship it');
		expect(parseTaskLine('- [ ] Do it now!')?.priority).toBeUndefined();
		expect(parseTaskLine('- [ ] Do it now!')?.title).toBe('Do it now!');
	});

	it('parses an optional time on the scheduled date', () => {
		const t = parseTaskLine('- [ ] Standup ⏳ 2026-07-20 9:30 #work');
		expect(t?.scheduled).toBe('2026-07-20');
		expect(t?.scheduledTime).toBe('09:30');
		expect(t?.title).toBe('Standup');
		expect(parseTaskLine('- [ ] No time ⏳ 2026-07-20')?.scheduledTime).toBeUndefined();
	});

	it('keeps after-completion recurrence text intact', () => {
		expect(parseTaskLine('- [ ] Clean garage 🔁 every 2 weeks after done')?.recurrenceText).toBe(
			'every 2 weeks after done',
		);
	});
});

describe('appendBlockId', () => {
	it('appends and round-trips through the parser', () => {
		const line = appendBlockId('- [ ] Buy milk ⏳ 2026-07-20', 't-abc123');
		expect(line).toBe('- [ ] Buy milk ⏳ 2026-07-20 ^t-abc123');
		const t = parseTaskLine(line);
		expect(t?.blockId).toBe('t-abc123');
		expect(t?.scheduled).toBe('2026-07-20');
		expect(t?.title).toBe('Buy milk');
	});

	it('strips trailing whitespace before appending', () => {
		expect(appendBlockId('- [ ] Task   ', 't-abc123')).toBe('- [ ] Task ^t-abc123');
	});
});
