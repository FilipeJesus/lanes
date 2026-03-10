import { describe, it, expect } from 'vitest';
import { formatReviewForClipboard } from '../../utils/reviewFormat';
import type { ReviewComment } from '../../utils/reviewFormat';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
    return {
        id: 'test-id',
        filePath: 'src/foo.ts',
        lineNumber: 5,
        lineType: 'added',
        lineContent: 'const x = 1;',
        text: 'This looks good',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatReviewForClipboard', () => {
    it('Given an empty comments array, when called, then returns the no-comments message', () => {
        const result = formatReviewForClipboard([]);
        expect(result).toBe('No comments in this review.');
    });

    it('Given one comment, when called, then the output contains the file path heading', () => {
        const comment = makeComment({ filePath: 'src/foo.ts' });
        const result = formatReviewForClipboard([comment]);
        expect(result).toContain('## src/foo.ts');
    });

    it('Given one comment, when called, then the output contains the line number', () => {
        const comment = makeComment({ lineNumber: 42 });
        const result = formatReviewForClipboard([comment]);
        expect(result).toContain('**Line 42**');
    });

    it('Given one comment with lineType added, when called, then the output contains the type', () => {
        const comment = makeComment({ lineType: 'added' });
        const result = formatReviewForClipboard([comment]);
        expect(result).toContain('(added)');
    });

    it('Given one comment, when called, then the output contains the comment text', () => {
        const comment = makeComment({ text: 'Please rename this variable' });
        const result = formatReviewForClipboard([comment]);
        expect(result).toContain('> Please rename this variable');
    });

    it('Given one added comment, when called, then the line content is prefixed with "+"', () => {
        const comment = makeComment({ lineType: 'added', lineContent: 'const x = 1;' });
        const result = formatReviewForClipboard([comment]);
        expect(result).toContain('+const x = 1;');
    });

    it('Given one removed comment, when called, then the line content is prefixed with "-"', () => {
        const comment = makeComment({ lineType: 'removed', lineContent: 'const y = 2;' });
        const result = formatReviewForClipboard([comment]);
        expect(result).toContain('-const y = 2;');
    });

    it('Given one context comment, when called, then the line content is prefixed with a space', () => {
        const comment = makeComment({ lineType: 'context', lineContent: 'export {};' });
        const result = formatReviewForClipboard([comment]);
        expect(result).toContain(' export {};');
    });

    it('Given comments on two different files, when called, then both file headings appear', () => {
        const comments = [
            makeComment({ id: '1', filePath: 'src/a.ts', lineNumber: 1 }),
            makeComment({ id: '2', filePath: 'src/b.ts', lineNumber: 1 }),
        ];
        const result = formatReviewForClipboard(comments);
        expect(result).toContain('## src/a.ts');
        expect(result).toContain('## src/b.ts');
    });

    it('Given comments on two files, when called, then each comment appears under its own file heading', () => {
        const comments = [
            makeComment({ id: '1', filePath: 'src/a.ts', lineNumber: 1, text: 'comment A' }),
            makeComment({ id: '2', filePath: 'src/b.ts', lineNumber: 1, text: 'comment B' }),
        ];
        const result = formatReviewForClipboard(comments);
        const posA = result.indexOf('## src/a.ts');
        const posCommentA = result.indexOf('> comment A');
        const posB = result.indexOf('## src/b.ts');
        const posCommentB = result.indexOf('> comment B');
        // Each comment must appear after its file heading
        expect(posCommentA).toBeGreaterThan(posA);
        expect(posCommentB).toBeGreaterThan(posB);
    });

    it('Given comments on the same file with line numbers 10 and 5, when called, then line 5 appears before line 10', () => {
        const comments = [
            makeComment({ id: '1', filePath: 'src/a.ts', lineNumber: 10, text: 'line ten' }),
            makeComment({ id: '2', filePath: 'src/a.ts', lineNumber: 5, text: 'line five' }),
        ];
        const result = formatReviewForClipboard(comments);
        const posFive = result.indexOf('**Line 5**');
        const posTen = result.indexOf('**Line 10**');
        expect(posFive).toBeLessThan(posTen);
    });

    it('Given one comment, when called, then the output starts with the top-level heading', () => {
        const result = formatReviewForClipboard([makeComment()]);
        expect(result).toMatch(/^# Code Review Comments/);
    });
});
