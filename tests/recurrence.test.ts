import { describe, expect, it } from 'vitest';
import {
	advanceRecurrence,
	normalizeRecurrenceText,
	parseRecurrence,
} from '../src/recurrence/recurrence';

// Sat 2026-07-18.
const TODAY = '2026-07-18';

describe('normalizeRecurrenceText', () => {
	it('rewrites ordinal-weekday shorthand to monthly', () => {
		expect(normalizeRecurrenceText('every 3rd friday')).toBe('every month on the 3rd friday');
		expect(normalizeRecurrenceText('every last monday')).toBe('every month on the last monday');
		expect(normalizeRecurrenceText('every week')).toBe('every week');
	});
});

describe('parseRecurrence', () => {
	it('parses the required phrases', () => {
		for (const text of ['every day', 'every week', 'every weekday', 'every 3rd friday']) {
			expect(parseRecurrence(text), text).not.toBeNull();
		}
	});

	it('returns null for junk', () => {
		expect(parseRecurrence('whenever I feel like it')).toBeNull();
	});
});

describe('advanceRecurrence', () => {
	it('every day advances scheduled to tomorrow', () => {
		expect(
			advanceRecurrence({ scheduled: '2026-07-18', recurrenceText: 'every day' }, TODAY),
		).toEqual({ scheduled: '2026-07-19' });
	});

	it('every week advances one week from the scheduled anchor', () => {
		expect(
			advanceRecurrence({ scheduled: '2026-07-18', recurrenceText: 'every week' }, TODAY),
		).toEqual({ scheduled: '2026-07-25' });
	});

	it('overdue tasks skip to the next occurrence after today, staying aligned', () => {
		// Anchored Fri 2026-07-10, weekly: 07-17 is ≤ today, so next is 07-24.
		expect(
			advanceRecurrence({ scheduled: '2026-07-10', recurrenceText: 'every week' }, TODAY),
		).toEqual({ scheduled: '2026-07-24' });
	});

	it('completing early still advances past the future anchor', () => {
		expect(
			advanceRecurrence({ scheduled: '2026-07-20', recurrenceText: 'every week' }, TODAY),
		).toEqual({ scheduled: '2026-07-27' });
	});

	it('every weekday skips the weekend', () => {
		// Today is Saturday; next weekday is Monday.
		expect(
			advanceRecurrence({ scheduled: '2026-07-17', recurrenceText: 'every weekday' }, TODAY),
		).toEqual({ scheduled: '2026-07-20' });
	});

	it('every day crosses month boundaries', () => {
		expect(
			advanceRecurrence({ scheduled: '2026-07-31', recurrenceText: 'every day' }, '2026-07-31'),
		).toEqual({ scheduled: '2026-08-01' });
	});

	it('every 3rd friday is monthly, including month boundary', () => {
		// 3rd Friday of July 2026 is 07-17; next is 3rd Friday of August, 08-21.
		expect(
			advanceRecurrence({ scheduled: '2026-07-17', recurrenceText: 'every 3rd friday' }, TODAY),
		).toEqual({ scheduled: '2026-08-21' });
	});

	it('anchors on due when no scheduled date exists', () => {
		expect(advanceRecurrence({ due: '2026-07-18', recurrenceText: 'every week' }, TODAY)).toEqual(
			{ due: '2026-07-25' },
		);
	});

	it('keeps the due offset when both dates are present', () => {
		expect(
			advanceRecurrence(
				{ scheduled: '2026-07-18', due: '2026-07-21', recurrenceText: 'every week' },
				TODAY,
			),
		).toEqual({ scheduled: '2026-07-25', due: '2026-07-28' });
	});

	it('anchors on today when the task has no dates', () => {
		expect(advanceRecurrence({ recurrenceText: 'every day' }, TODAY)).toEqual({
			scheduled: '2026-07-19',
		});
	});

	it('returns null for unparseable text', () => {
		expect(advanceRecurrence({ scheduled: TODAY, recurrenceText: 'sometimes' }, TODAY)).toBeNull();
	});

	it('after-completion repeats anchor on today, not the schedule', () => {
		// Fixed weekly from 07-10 would give 07-24; after-done gives today + 1 week.
		expect(
			advanceRecurrence(
				{ scheduled: '2026-07-10', recurrenceText: 'every week after done' },
				TODAY,
			),
		).toEqual({ scheduled: '2026-07-25' });
	});

	it('after-completion works with "after completion" phrasing and intervals', () => {
		expect(
			advanceRecurrence(
				{ scheduled: '2026-07-01', recurrenceText: 'every 2 weeks after completion' },
				TODAY,
			),
		).toEqual({ scheduled: '2026-08-01' });
	});

	it('after-completion keeps the due offset', () => {
		expect(
			advanceRecurrence(
				{ scheduled: '2026-07-15', due: '2026-07-17', recurrenceText: 'every week after done' },
				TODAY,
			),
		).toEqual({ scheduled: '2026-07-25', due: '2026-07-27' });
	});
});
