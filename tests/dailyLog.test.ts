import { describe, expect, it } from 'vitest';
import {
	formatCompletionLine,
	hasCompletionLine,
	removeCompletionLine,
} from '../src/daily/dailyLog';
import { insertTaskLine } from '../src/mutations/lineEdits';

describe('formatCompletionLine', () => {
	it('formats a journal line with project link and hidden marker', () => {
		const line = formatCompletionLine(
			't-abc123',
			'Send weekly email',
			'Website Redesign',
			new Date(2026, 6, 19, 14, 32).toISOString(),
		);
		expect(line).toBe('- ✅ 14:32 Send weekly email ([[Website Redesign]]) %%t-abc123%%');
	});

	it('omits the project link for inbox tasks and is not a checkbox', () => {
		const line = formatCompletionLine(
			't-abc123',
			'Pay bill',
			undefined,
			new Date(2026, 6, 19, 9, 5).toISOString(),
		);
		expect(line).toBe('- ✅ 09:05 Pay bill %%t-abc123%%');
		expect(line).not.toMatch(/- \[.\]/);
	});
});

describe('removeCompletionLine', () => {
	const content = [
		'# 2026-07-19',
		'',
		'## Completed',
		'',
		'- ✅ 09:05 Pay bill %%t-aaa%%',
		'- ✅ 14:32 Send email ([[Site]]) %%t-bbb%%',
		'- ✅ 15:00 Water plants %%t-aaa%%',
	].join('\n');

	it('removes the last line with the marker', () => {
		const result = removeCompletionLine(content, 't-aaa');
		expect(result).toContain('09:05 Pay bill');
		expect(result).not.toContain('15:00 Water plants');
	});

	it('returns null when the marker is absent', () => {
		expect(removeCompletionLine(content, 't-zzz')).toBeNull();
	});
});

describe('hasCompletionLine', () => {
	it('matches lines in CRLF files', () => {
		const line = '- ✅ 09:05 Pay bill %%t-aaa%%';
		expect(hasCompletionLine(`# D\r\n${line}\r\n`, line)).toBe(true);
		expect(hasCompletionLine(`# D\n${line}\n`, line)).toBe(true);
		expect(hasCompletionLine('# D\n', line)).toBe(false);
	});
});

describe('journal round trip', () => {
	it('append under heading then remove restores the note', () => {
		const note = '# 2026-07-19\n\nSome journaling.\n';
		const line = formatCompletionLine('t-abc', 'Task', undefined, new Date().toISOString());
		const appended = insertTaskLine(note, line, 'Completed');
		expect(hasCompletionLine(appended, line)).toBe(true);
		expect(appended).toContain('## Completed');
		const removed = removeCompletionLine(appended, 't-abc');
		expect(removed).not.toContain('%%t-abc%%');
	});
});
