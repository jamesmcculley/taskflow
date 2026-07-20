import * as chrono from 'chrono-node';
import { parseRecurrence } from '../recurrence/recurrence';
import { todayISO } from '../store/selectors';

export interface CaptureParse {
	title: string;
	scheduled?: string;
	/** HH:mm when the natural-language date carried a certain hour. */
	scheduledTime?: string;
	due?: string;
	tags: string[];
	/** Raw text after `>`, resolved against project names at capture time. */
	projectQuery?: string;
	/** rrule text, e.g. "every week" — validated before being accepted. */
	recurrence?: string;
	priority?: 1 | 2;
}

const DUE_TOKEN_RE = /!due\s+([^#>!]+?)\s*(?=$|#|>|!)/iu;
const PROJECT_TOKEN_RE = />\s*([^#>!]+?)\s*(?=$|#|!)/u;
const TAG_RE = /(^|\s)#([A-Za-z0-9_/-]*[A-Za-z_/-][A-Za-z0-9_/-]*)/gu;
const PRIORITY_RE = /(^|\s)(!{2,3})(?=\s|$)/;
const RECUR_SPAN_RE = /\bevery\s+[^#>!\n]+/i;
// rrule's fromText silently ignores trailing junk, so the phrase is bounded by
// a vocabulary check before the parser validates it.
// 'at' is deliberately absent so "every day at 9" leaves "at 9" for chrono's
// time-of-day parsing.
const RECUR_WORD_RE =
	/^(\d+|other|1st|2nd|3rd|4th|5th|last|day|days|week|weeks|weekday|weekdays|month|months|year|years|on|the|after|done|completion|mon(day)?|tue(s|sday)?|wed(nesday)?|thu(rs|rsday)?|fri(day)?|sat(urday)?|sun(day)?)$/i;

/**
 * Finds a valid "every …" recurrence phrase: consumes recurrence-vocabulary
 * words after "every", then requires the recurrence parser to accept them.
 */
function extractRecurrence(text: string): { recurrence: string; start: number; length: number } | null {
	const m = RECUR_SPAN_RE.exec(text);
	if (!m) return null;
	const words = m[0].trim().split(/\s+/);
	const kept = [words[0] ?? 'every'];
	for (const word of words.slice(1, 8)) {
		if (!RECUR_WORD_RE.test(word)) break;
		kept.push(word);
	}
	for (let len = kept.length; len >= 2; len--) {
		const candidate = kept.slice(0, len).join(' ');
		if (parseRecurrence(candidate)) {
			return { recurrence: candidate, start: m.index, length: candidate.length };
		}
	}
	return null;
}

function parseNaturalDate(text: string, ref: Date): string | undefined {
	const result = chrono.casual.parse(text, ref, { forwardDate: true })[0];
	return result ? todayISO(result.start.date()) : undefined;
}

/**
 * Parses quick-capture input: free text + #tags + natural-language scheduled
 * date + optional `!due <date>` + optional `>Project Name`.
 * Precedence: !due, then >project, then #tags, then the first remaining
 * natural-language date becomes the scheduled date.
 */
export function parseCapture(input: string, ref: Date = new Date()): CaptureParse {
	let text = input;

	let due: string | undefined;
	const dueMatch = DUE_TOKEN_RE.exec(text);
	if (dueMatch) {
		due = parseNaturalDate(dueMatch[1] ?? '', ref);
		text = text.slice(0, dueMatch.index) + ' ' + text.slice(dueMatch.index + dueMatch[0].length);
	}

	let projectQuery: string | undefined;
	const projMatch = PROJECT_TOKEN_RE.exec(text);
	if (projMatch) {
		projectQuery = projMatch[1]?.trim() || undefined;
		text = text.slice(0, projMatch.index) + ' ' + text.slice(projMatch.index + projMatch[0].length);
	}

	const tags: string[] = [];
	text = text.replace(TAG_RE, (_all, pre: string, tag: string) => {
		tags.push(tag);
		return pre;
	});

	let priority: 1 | 2 | undefined;
	const pm = PRIORITY_RE.exec(text);
	if (pm) {
		priority = pm[2] === '!!!' ? 1 : 2;
		text = text.slice(0, pm.index) + (pm[1] ?? '') + text.slice(pm.index + pm[0].length);
	}

	// Recurrence before chrono, so "every monday" isn't half-eaten as a date.
	let recurrence: string | undefined;
	const rec = extractRecurrence(text);
	if (rec) {
		recurrence = rec.recurrence;
		text = text.slice(0, rec.start) + ' ' + text.slice(rec.start + rec.length);
	}

	let scheduled: string | undefined;
	let scheduledTime: string | undefined;
	const dateResult = chrono.casual.parse(text, ref, { forwardDate: true })[0];
	if (dateResult) {
		const date = dateResult.start.date();
		scheduled = todayISO(date);
		if (dateResult.start.isCertain('hour')) {
			scheduledTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
		}
		// Also strip a dangling connector ("on friday", "at 2026-08-01").
		let start = dateResult.index;
		const connector = /\b(?:on|at)\s+$/i.exec(text.slice(0, start));
		if (connector) start = connector.index;
		text = text.slice(0, start) + ' ' + text.slice(dateResult.index + dateResult.text.length);
	}

	return {
		title: text.replace(/\s+/g, ' ').trim(),
		scheduled,
		scheduledTime,
		due,
		tags,
		projectQuery,
		recurrence,
		priority,
	};
}

/** Renders a parse as a markdown task line (without a block ID — the indexer assigns one). */
export function serializeCaptureLine(parse: CaptureParse): string {
	let line = `- [ ] ${parse.title}`;
	if (parse.priority) line += ` ${parse.priority === 1 ? '!!!' : '!!'}`;
	if (parse.scheduled) {
		line += ` ⏳ ${parse.scheduled}`;
		if (parse.scheduledTime) line += ` ${parse.scheduledTime}`;
	}
	if (parse.due) line += ` 📅 ${parse.due}`;
	if (parse.recurrence) line += ` 🔁 ${parse.recurrence}`;
	for (const tag of parse.tags) line += ` #${tag}`;
	return line;
}
