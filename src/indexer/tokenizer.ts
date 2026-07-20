import type { TaskStatus } from '../types';

export interface ParsedTaskLine {
	status: TaskStatus;
	/** Line text stripped of all metadata tokens. */
	title: string;
	scheduled?: string;
	due?: string;
	/** Date from a ✅ stamp on the line, if any. */
	completedDate?: string;
	recurrenceText?: string;
	tags: string[];
	blockId?: string;
	/** 🌙 evening flag. */
	evening: boolean;
	/** 1 = high (!!!), 2 = medium (!!). */
	priority?: 1 | 2;
	/** HH:mm following the scheduled date. */
	scheduledTime?: string;
}

const CHECKBOX_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[(.)\]\s?(.*)$/;
const DATE = '(\\d{4}-\\d{2}-\\d{2})';
const SCHEDULED_RE = new RegExp(`⏳\\s*${DATE}(?:\\s+(\\d{1,2}:\\d{2}))?`, 'u');
const DUE_RE = new RegExp(`📅\\s*${DATE}`, 'u');
const COMPLETED_RE = new RegExp(`✅\\s*${DATE}`, 'u');
// Recurrence text runs until the next metadata emoji, #tag, !priority, or block ref.
const RECUR_RE = /🔁\s*([^⏳📅✅🔁🌙#^!]*)/u;
const EVENING_RE = /\s*🌙/u;
// Standalone !! / !!! only — a trailing "!" in a title never counts.
const PRIORITY_RE = /(^|\s)(!{2,3})(?=\s|$)/;
const BLOCK_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;
// Obsidian tags: letters/digits/_/-//, at least one non-digit character.
const TAG_RE = /(^|\s)#([A-Za-z0-9_/-]*[A-Za-z_/-][A-Za-z0-9_/-]*)/gu;

function statusFromCheckbox(char: string): TaskStatus {
	if (char === 'x' || char === 'X') return 'done';
	if (char === '-') return 'cancelled';
	// Unknown status chars from other plugins ([/], [>], …) index as todo
	// so tasks never silently disappear from views.
	return 'todo';
}

export function isTaskLine(line: string): boolean {
	return CHECKBOX_RE.test(line);
}

export function parseTaskLine(line: string): ParsedTaskLine | null {
	const m = CHECKBOX_RE.exec(line);
	if (!m) return null;
	const status = statusFromCheckbox(m[2] ?? ' ');
	let body = m[3] ?? '';

	let blockId: string | undefined;
	const bm = BLOCK_ID_RE.exec(body);
	if (bm) {
		blockId = bm[1];
		body = body.slice(0, bm.index);
	}

	const take = (re: RegExp): string | undefined => {
		const mm = re.exec(body);
		if (!mm) return undefined;
		body = body.slice(0, mm.index) + ' ' + body.slice(mm.index + mm[0].length);
		return mm[1]?.trim();
	};

	let scheduled: string | undefined;
	let scheduledTime: string | undefined;
	const sm = SCHEDULED_RE.exec(body);
	if (sm) {
		scheduled = sm[1];
		scheduledTime = sm[2] !== undefined ? normalizeTime(sm[2]) : undefined;
		body = body.slice(0, sm.index) + ' ' + body.slice(sm.index + sm[0].length);
	}
	const due = take(DUE_RE);
	const completedDate = take(COMPLETED_RE);
	const recurrenceText = take(RECUR_RE) || undefined;
	const evening = EVENING_RE.test(body);
	if (evening) body = body.replace(EVENING_RE, ' ');

	let priority: 1 | 2 | undefined;
	const pm = PRIORITY_RE.exec(body);
	if (pm) {
		priority = pm[2] === '!!!' ? 1 : 2;
		body = body.slice(0, pm.index) + (pm[1] ?? '') + body.slice(pm.index + pm[0].length);
	}

	const tags: string[] = [];
	body = body.replace(TAG_RE, (_all, pre: string, tag: string) => {
		tags.push(tag);
		return pre;
	});

	const title = body.replace(/\s+/g, ' ').trim();
	return {
		status,
		title,
		scheduled,
		due,
		completedDate,
		recurrenceText,
		tags,
		blockId,
		evening,
		priority,
		scheduledTime,
	};
}

function normalizeTime(time: string): string {
	const [h, m] = time.split(':');
	return `${(h ?? '0').padStart(2, '0')}:${m ?? '00'}`;
}

/** Appends a block reference to a line, preserving everything else byte-for-byte. */
export function appendBlockId(line: string, id: string): string {
	return line.replace(/\s*$/, '') + ` ^${id}`;
}
