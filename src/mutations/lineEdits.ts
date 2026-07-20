import type { TaskStatus } from '../types';

const CHECKBOX_PREFIX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\])/;
const STAMP_RE = /\s*✅\s*\d{4}-\d{2}-\d{2}/u;
const BLOCK_REF_RE = /\s+\^[A-Za-z0-9-]+\s*$/;

const STATUS_CHAR: Record<TaskStatus, string> = { todo: ' ', done: 'x', cancelled: '-' };

export function setCheckboxStatus(line: string, status: TaskStatus): string {
	return line.replace(CHECKBOX_PREFIX_RE, (_m, pre: string, _char: string, post: string) => {
		return pre + STATUS_CHAR[status] + post;
	});
}

export function removeCompletionStamp(line: string): string {
	return line.replace(STAMP_RE, '');
}

/**
 * Inserts a metadata token at the end of the line's content, but before any
 * ✅ stamp and trailing block ref, preserving everything else byte-for-byte.
 */
function insertMetaToken(line: string, token: string): string {
	let idx = line.length;
	const stamp = STAMP_RE.exec(line);
	if (stamp && stamp.index < idx) idx = stamp.index;
	const block = BLOCK_REF_RE.exec(line);
	if (block && block.index < idx) idx = block.index;
	const head = line.slice(0, idx).replace(/\s+$/, '');
	const tail = line.slice(idx);
	return `${head} ${token}${tail}`;
}

export function addCompletionStamp(line: string, date: string): string {
	const cleaned = removeCompletionStamp(line);
	const block = BLOCK_REF_RE.exec(cleaned);
	const idx = block ? block.index : cleaned.length;
	const head = cleaned.slice(0, idx).replace(/\s+$/, '');
	return `${head} ✅ ${date}${cleaned.slice(idx)}`;
}

export type DateTokenKind = 'scheduled' | 'due';

const DATE_TOKEN: Record<DateTokenKind, { emoji: string; re: RegExp }> = {
	// The scheduled token may carry an optional HH:mm; removal takes it too,
	// while in-place date replacement leaves it alone.
	scheduled: { emoji: '⏳', re: /\s*⏳\s*\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?/u },
	due: { emoji: '📅', re: /\s*📅\s*\d{4}-\d{2}-\d{2}/u },
};

/** Sets, replaces, or (with null) removes a ⏳/📅 date token on a task line. */
export function setDateToken(line: string, kind: DateTokenKind, date: string | null): string {
	const { emoji, re } = DATE_TOKEN[kind];
	const existing = re.exec(line);
	if (date === null) {
		return existing ? line.replace(re, '') : line;
	}
	if (existing) {
		// Replace only the date digits so surrounding spacing stays intact.
		const replaced = existing[0].replace(/\d{4}-\d{2}-\d{2}/, date);
		return line.slice(0, existing.index) + replaced + line.slice(existing.index + existing[0].length);
	}
	return insertMetaToken(line, `${emoji} ${date}`);
}

/** Adds or removes a bare emoji flag (e.g. 🌙) on a task line. */
export function setFlagToken(line: string, emoji: string, on: boolean): string {
	const re = new RegExp(`\\s*${emoji}`, 'u');
	if (!on) return line.replace(re, '');
	if (new RegExp(emoji, 'u').test(line)) return line;
	return insertMetaToken(line, emoji);
}

// No lookbehind — it would fail to compile on iOS < 16.4 and brick the plugin.
// The token is always preceded by whitespace on a real task line.
const PRIORITY_TOKEN_RE = /\s!{2,3}(?=\s|$)/;

/** Sets or clears the standalone !!!/!! priority token. */
export function setPriority(line: string, priority: 1 | 2 | null): string {
	const cleaned = line.replace(PRIORITY_TOKEN_RE, '');
	if (priority === null) return cleaned;
	return insertMetaToken(cleaned, priority === 1 ? '!!!' : '!!');
}

/** Adds or removes a #tag on a task line. */
export function setTag(line: string, tag: string, on: boolean): string {
	const present = new RegExp(`(^|\\s)#${tag}(?=\\s|$)`, 'u');
	if (!on) return line.replace(new RegExp(`\\s#${tag}(?=\\s|$)`, 'u'), '');
	if (present.test(line)) return line;
	return insertMetaToken(line, `#${tag}`);
}

/** Inserts a task line above the file's first heading (or appends if none). */
export function insertTaskLineBeforeHeadings(content: string, taskLine: string): string {
	const { lines, sep } = splitLines(content);
	const headingRe = /^#{1,6}\s/;
	const idx = lines.findIndex((l) => headingRe.test(l));
	if (idx === -1) return insertTaskLine(content, taskLine);
	let pos = idx;
	while (pos > 0 && (lines[pos - 1] ?? '').trim() === '') pos--;
	lines.splice(pos, 0, taskLine);
	return lines.join(sep);
}

/**
 * Splits content preserving the file's line-ending style, so edits on CRLF
 * vaults stay byte-for-byte outside the touched lines.
 */
export function splitLines(content: string): { lines: string[]; sep: '\n' | '\r\n' } {
	const sep = content.includes('\r\n') ? '\r\n' : '\n';
	return { lines: content.split(sep), sep };
}

/** Inserts a task line at the end of a heading's section, or at end of file. */
export function insertTaskLine(content: string, taskLine: string, heading?: string): string {
	const { lines: split, sep } = splitLines(content);
	const lines = content.length === 0 ? [] : split;
	if (heading !== undefined) {
		const headingRe = /^(#{1,6})\s+(.+?)\s*$/;
		let headingLevel = 0;
		let headingIdx = -1;
		for (let i = 0; i < lines.length; i++) {
			const m = headingRe.exec(lines[i] ?? '');
			if (m && m[2] === heading) {
				headingLevel = (m[1] ?? '#').length;
				headingIdx = i;
				break;
			}
		}
		if (headingIdx === -1) {
			// Heading not present: create it at the end of the file.
			if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
			lines.push(`## ${heading}`, '', taskLine);
			return lines.join(sep) + sep;
		}
		let end = lines.length;
		for (let i = headingIdx + 1; i < lines.length; i++) {
			const m = headingRe.exec(lines[i] ?? '');
			if (m && (m[1] ?? '').length <= headingLevel) {
				end = i;
				break;
			}
		}
		// Insert after the last non-blank line of the section.
		while (end > headingIdx + 1 && (lines[end - 1] ?? '').trim() === '') end--;
		lines.splice(end, 0, taskLine);
		return lines.join(sep);
	}
	while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
	lines.push(taskLine);
	return lines.join(sep) + sep;
}
