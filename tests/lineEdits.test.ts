import { describe, expect, it } from 'vitest';
import {
	addCompletionStamp,
	insertTaskLine,
	insertTaskLineBeforeHeadings,
	removeCompletionStamp,
	setCheckboxStatus,
	setDateToken,
	setFlagToken,
	setPriority,
	setTag,
	splitLines,
} from '../src/mutations/lineEdits';

const TODAY = '2026-07-18';

function complete(line: string): string {
	return addCompletionStamp(setCheckboxStatus(line, 'done'), TODAY);
}

function uncomplete(line: string): string {
	return removeCompletionStamp(setCheckboxStatus(line, 'todo'));
}

describe('complete/uncomplete round trip', () => {
	const fixtures = [
		'- [ ] Buy milk',
		'- [ ] Buy milk ⏳ 2026-07-20 📅 2026-07-25 #errand ^t-abc123',
		'- [ ] Progress email 🔁 every week ⏳ 2026-07-20 #comms ^t-def456',
		'  - [ ] Indented subtask #a ^t-ghi789',
		'* [ ] Star marker task ^t-jkl012',
		'1. [ ] Numbered task 📅 2026-08-01',
	];

	for (const line of fixtures) {
		it(`preserves the line byte-for-byte: "${line}"`, () => {
			const completed = complete(line);
			expect(completed).toContain('[x]');
			expect(completed).toContain(`✅ ${TODAY}`);
			expect(uncomplete(completed)).toBe(line);
		});
	}

	it('places the stamp before a trailing block ref', () => {
		expect(complete('- [ ] Task ^t-abc123')).toBe(`- [x] Task ✅ ${TODAY} ^t-abc123`);
	});

	it('replaces an existing stamp instead of stacking', () => {
		expect(complete('- [x] Task ✅ 2026-01-01 ^t-abc123')).toBe(
			`- [x] Task ✅ ${TODAY} ^t-abc123`,
		);
	});
});

describe('setCheckboxStatus', () => {
	it('cancels and restores', () => {
		const line = '- [ ] Task #x ^t-abc123';
		const cancelled = setCheckboxStatus(line, 'cancelled');
		expect(cancelled).toBe('- [-] Task #x ^t-abc123');
		expect(setCheckboxStatus(cancelled, 'todo')).toBe(line);
	});

	it('leaves non-task lines untouched', () => {
		expect(setCheckboxStatus('plain text', 'done')).toBe('plain text');
	});
});

describe('setDateToken', () => {
	it('adds a scheduled date before tags stay intact and block ref stays last', () => {
		expect(setDateToken('- [ ] Task #x ^t-abc123', 'scheduled', '2026-07-20')).toBe(
			'- [ ] Task #x ⏳ 2026-07-20 ^t-abc123',
		);
	});

	it('replaces an existing scheduled date in place', () => {
		const line = '- [ ] Task ⏳ 2026-07-01 📅 2026-08-01 ^t-abc123';
		expect(setDateToken(line, 'scheduled', '2026-07-20')).toBe(
			'- [ ] Task ⏳ 2026-07-20 📅 2026-08-01 ^t-abc123',
		);
	});

	it('removes a date token with null', () => {
		const line = '- [ ] Task ⏳ 2026-07-01 #x ^t-abc123';
		expect(setDateToken(line, 'scheduled', null)).toBe('- [ ] Task #x ^t-abc123');
		expect(setDateToken('- [ ] Task', 'scheduled', null)).toBe('- [ ] Task');
	});

	it('add-then-remove round-trips byte-for-byte', () => {
		const line = '- [ ] Task #x ^t-abc123';
		expect(setDateToken(setDateToken(line, 'due', '2026-08-01'), 'due', null)).toBe(line);
	});

	it('inserts before a completion stamp', () => {
		expect(setDateToken('- [x] Task ✅ 2026-07-15 ^t-abc123', 'due', '2026-08-01')).toBe(
			'- [x] Task 📅 2026-08-01 ✅ 2026-07-15 ^t-abc123',
		);
	});
});

describe('setFlagToken / setTag', () => {
	it('🌙 flag round-trips byte-for-byte', () => {
		const line = '- [ ] Task ⏳ 2026-07-19 #x ^t-abc123';
		const on = setFlagToken(line, '🌙', true);
		expect(on).toBe('- [ ] Task ⏳ 2026-07-19 #x 🌙 ^t-abc123');
		expect(setFlagToken(on, '🌙', false)).toBe(line);
		expect(setFlagToken(on, '🌙', true)).toBe(on);
	});

	it('#someday tag round-trips byte-for-byte', () => {
		const line = '- [ ] Task #home ^t-abc123';
		const on = setTag(line, 'someday', true);
		expect(on).toBe('- [ ] Task #home #someday ^t-abc123');
		expect(setTag(on, 'someday', false)).toBe(line);
		expect(setTag(on, 'someday', true)).toBe(on);
	});

	it('does not strip nested tags sharing the prefix', () => {
		expect(setTag('- [ ] Task #someday/maybe', 'someday', false)).toBe(
			'- [ ] Task #someday/maybe',
		);
	});
});

describe('setPriority', () => {
	it('adds, replaces, and clears the token byte-for-byte', () => {
		const line = '- [ ] Task ⏳ 2026-07-20 #x ^t-abc123';
		const high = setPriority(line, 1);
		expect(high).toBe('- [ ] Task ⏳ 2026-07-20 #x !!! ^t-abc123');
		expect(setPriority(high, 2)).toBe('- [ ] Task ⏳ 2026-07-20 #x !! ^t-abc123');
		expect(setPriority(high, null)).toBe(line);
	});

	it('leaves title exclamation marks alone', () => {
		expect(setPriority('- [ ] Do it now!', null)).toBe('- [ ] Do it now!');
	});
});

describe('scheduled token with time', () => {
	it('removes date and time together', () => {
		expect(setDateToken('- [ ] Standup ⏳ 2026-07-20 09:30 #w', 'scheduled', null)).toBe(
			'- [ ] Standup #w',
		);
	});

	it('replaces the date in place, preserving the time', () => {
		expect(setDateToken('- [ ] Standup ⏳ 2026-07-20 09:30', 'scheduled', '2026-07-21')).toBe(
			'- [ ] Standup ⏳ 2026-07-21 09:30',
		);
	});
});

describe('insertTaskLineBeforeHeadings', () => {
	it('inserts above the first heading', () => {
		const content = '---\ntype: project\n---\n\n- [ ] Loose task\n\n## Design\n\n- [ ] A\n';
		expect(insertTaskLineBeforeHeadings(content, '- [ ] New')).toBe(
			'---\ntype: project\n---\n\n- [ ] Loose task\n- [ ] New\n\n## Design\n\n- [ ] A\n',
		);
	});

	it('appends when the file has no headings', () => {
		expect(insertTaskLineBeforeHeadings('- [ ] A\n', '- [ ] New')).toBe('- [ ] A\n- [ ] New\n');
	});
});

describe('CRLF handling', () => {
	it('splitLines preserves the ending style', () => {
		expect(splitLines('a\r\nb\r\n')).toEqual({ lines: ['a', 'b', ''], sep: '\r\n' });
		expect(splitLines('a\nb')).toEqual({ lines: ['a', 'b'], sep: '\n' });
	});

	it('insertTaskLine keeps CRLF files CRLF', () => {
		const content = '# Inbox\r\n\r\n- [ ] Existing\r\n';
		const result = insertTaskLine(content, '- [ ] New');
		expect(result).toBe('# Inbox\r\n\r\n- [ ] Existing\r\n- [ ] New\r\n');
	});

	it('insertTaskLine under a heading keeps CRLF', () => {
		const content = '# D\r\n\r\n## Completed\r\n\r\n- done a\r\n';
		const result = insertTaskLine(content, '- done b', 'Completed');
		expect(result).toBe('# D\r\n\r\n## Completed\r\n\r\n- done a\r\n- done b\r\n');
	});
});

describe('insertTaskLine', () => {
	it('appends at end of file with trailing newline', () => {
		expect(insertTaskLine('# Inbox\n\n- [ ] Existing\n', '- [ ] New')).toBe(
			'# Inbox\n\n- [ ] Existing\n- [ ] New\n',
		);
	});

	it('handles an empty file', () => {
		expect(insertTaskLine('', '- [ ] New')).toBe('- [ ] New\n');
	});

	it('inserts at the end of a heading section', () => {
		const content = '# P\n\n## Design\n\n- [ ] A\n\n## Build\n\n- [ ] B\n';
		expect(insertTaskLine(content, '- [ ] New', 'Design')).toBe(
			'# P\n\n## Design\n\n- [ ] A\n- [ ] New\n\n## Build\n\n- [ ] B\n',
		);
	});

	it('creates a missing heading at end of file', () => {
		expect(insertTaskLine('# P\n\n- [ ] A\n', '- [ ] New', 'Later')).toBe(
			'# P\n\n- [ ] A\n\n## Later\n\n- [ ] New\n',
		);
	});
});
