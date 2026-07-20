import { RRule } from 'rrule';
import { addDaysISO } from '../store/selectors';

// rrule's fromText doesn't understand "every 3rd friday"; treat it
// as monthly (the common expectation), so normalize to rrule's "every month on the 3rd friday".
const ORDINAL_RE = /^every\s+(1st|2nd|3rd|4th|5th|last)\s+([a-z]+)$/i;
// "every week after done" — an after-completion repeat: the next
// occurrence anchors on the completion date instead of the schedule pattern.
const AFTER_RE = /\s+after\s+(?:done|completion)$/i;

export function splitRecurrenceText(text: string): { base: string; afterCompletion: boolean } {
	const trimmed = text.trim();
	const m = AFTER_RE.exec(trimmed);
	return m
		? { base: trimmed.slice(0, m.index), afterCompletion: true }
		: { base: trimmed, afterCompletion: false };
}

export function normalizeRecurrenceText(text: string): string {
	const m = ORDINAL_RE.exec(text.trim());
	return m ? `every month on the ${m[1]} ${m[2]}` : text.trim();
}

export function parseRecurrence(text: string): RRule | null {
	const normalized = normalizeRecurrenceText(splitRecurrenceText(text).base);
	// fromText silently falls back to a yearly rule for unparseable input, so
	// gate on the "every …" prefix all supported phrases share.
	if (!/^every\s+\S/i.test(normalized)) return null;
	try {
		const rule = RRule.fromText(normalized);
		return Number.isFinite(rule.options.freq) ? rule : null;
	} catch {
		return null;
	}
}

function utcDate(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function isoFromUTC(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function diffDays(fromISO: string, toISO: string): number {
	return Math.round((utcDate(toISO).getTime() - utcDate(fromISO).getTime()) / 86400000);
}

export interface AdvanceInput {
	scheduled?: string;
	due?: string;
	recurrenceText: string;
}

export interface AdvanceResult {
	scheduled?: string;
	due?: string;
}

/**
 * Computes the dates for the next occurrence of a recurring task.
 * Anchor: scheduled if present, else due, else today. The next occurrence is
 * the first one strictly after max(anchor, today), aligned to the anchor. When
 * both dates are present, the scheduled date follows the pattern and the due
 * date keeps its offset from scheduled. Returns null if the text doesn't parse.
 */
export function advanceRecurrence(input: AdvanceInput, today: string): AdvanceResult | null {
	const parsed = parseRecurrence(input.recurrenceText);
	if (!parsed) return null;
	const { afterCompletion } = splitRecurrenceText(input.recurrenceText);
	// After-completion repeats anchor on today (the completion date); fixed
	// repeats stay aligned to the scheduled/due pattern.
	const anchor = afterCompletion ? today : (input.scheduled ?? input.due ?? today);
	const rule = new RRule({ ...parsed.origOptions, dtstart: utcDate(anchor) });
	const base = anchor > today ? anchor : today;
	const next = rule.after(utcDate(base), false);
	if (!next) return null;
	const nextISO = isoFromUTC(next);

	if (input.scheduled !== undefined) {
		if (input.due !== undefined) {
			return { scheduled: nextISO, due: addDaysISO(nextISO, diffDays(input.scheduled, input.due)) };
		}
		return { scheduled: nextISO };
	}
	if (input.due !== undefined) return { due: nextISO };
	return { scheduled: nextISO };
}
