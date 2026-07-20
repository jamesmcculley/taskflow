import { describe, expect, it } from 'vitest';
import { isExcludedPath, isTaskflowDisabled } from '../src/indexer/indexer';

describe('isExcludedPath', () => {
	it('matches files inside excluded folders, not prefix-similar ones', () => {
		expect(isExcludedPath('Templates/Daily.md', ['Templates'])).toBe(true);
		expect(isExcludedPath('Templates/Sub/T.md', ['Templates'])).toBe(true);
		expect(isExcludedPath('TemplatesOld/T.md', ['Templates'])).toBe(false);
		expect(isExcludedPath('Notes/T.md', ['Templates', 'Archive'])).toBe(false);
		expect(isExcludedPath('Archive/2025.md', ['Templates', 'Archive'])).toBe(true);
	});

	it('tolerates slashes and blank entries', () => {
		expect(isExcludedPath('Templates/T.md', ['/Templates/'])).toBe(true);
		expect(isExcludedPath('Templates/T.md', ['', '  '])).toBe(false);
	});
});

describe('isTaskflowDisabled', () => {
	it('accepts false, "ignore", and "off"', () => {
		expect(isTaskflowDisabled({ taskflow: false })).toBe(true);
		expect(isTaskflowDisabled({ taskflow: 'ignore' })).toBe(true);
		expect(isTaskflowDisabled({ taskflow: 'off' })).toBe(true);
	});

	it('anything else keeps the note indexed', () => {
		expect(isTaskflowDisabled(undefined)).toBe(false);
		expect(isTaskflowDisabled({})).toBe(false);
		expect(isTaskflowDisabled({ taskflow: true })).toBe(false);
		expect(isTaskflowDisabled({ type: 'project' })).toBe(false);
	});
});
