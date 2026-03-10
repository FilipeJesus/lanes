import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffViewer } from '../../components/DiffViewer';
import type { ReviewComment } from '../../utils/reviewFormat';

// ---------------------------------------------------------------------------
// Sample unified diff fixtures
// ---------------------------------------------------------------------------

const SIMPLE_DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 export { x, y };`;

const EMPTY_DIFF = '';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiffViewer', () => {
    it('Given an empty diff string, when rendered, then an empty state message is shown', () => {
        render(<DiffViewer diff={EMPTY_DIFF} />);
        expect(screen.getByRole('status')).toHaveTextContent('No changes to display.');
    });

    it('Given a unified diff, when rendered, then a file section is displayed', () => {
        render(<DiffViewer diff={SIMPLE_DIFF} />);
        // The +++ line is parsed to derive the display name "src/a.ts"
        expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    });

    it('Given a diff with added lines, when rendered, then those rows carry the added row class', () => {
        const { container } = render(<DiffViewer diff={SIMPLE_DIFF} />);
        // Added rows should include "+" marker cells
        const markers = container.querySelectorAll('span[aria-hidden="true"]');
        const plusMarkers = Array.from(markers).filter((m) => m.textContent === '+');
        expect(plusMarkers.length).toBeGreaterThan(0);
    });

    it('Given a diff with removed lines, when rendered, then those rows carry the removed row class', () => {
        const { container } = render(<DiffViewer diff={SIMPLE_DIFF} />);
        const markers = container.querySelectorAll('span[aria-hidden="true"]');
        const minusMarkers = Array.from(markers).filter((m) => m.textContent === '-');
        expect(minusMarkers.length).toBeGreaterThan(0);
    });

    it('Given a diff with context lines, when rendered, then those rows carry a space marker', () => {
        const { container } = render(<DiffViewer diff={SIMPLE_DIFF} />);
        const markers = container.querySelectorAll('span[aria-hidden="true"]');
        const spaceMarkers = Array.from(markers).filter((m) => m.textContent === ' ');
        expect(spaceMarkers.length).toBeGreaterThan(0);
    });

    it('Given a diff, when rendered, then a table with aria-label is present for each file', () => {
        render(<DiffViewer diff={SIMPLE_DIFF} />);
        const table = screen.getByRole('table', { name: /diff for src\/a\.ts/i });
        expect(table).toBeInTheDocument();
    });

    it('Given a diff with file header, when rendered, then line number cells are present', () => {
        const { container } = render(<DiffViewer diff={SIMPLE_DIFF} />);
        // The gutter cells contain span.lineNo elements
        const lineNoCells = container.querySelectorAll('td');
        expect(lineNoCells.length).toBeGreaterThan(0);
    });

    it('Given a hunk header line, when rendered, then hunk content is shown in the table', () => {
        render(<DiffViewer diff={SIMPLE_DIFF} />);
        // The @@ line text should be visible
        expect(screen.getByText(/@@ -1,4 \+1,5 @@/)).toBeInTheDocument();
    });

    it('Given a diff, when rendered, then file section has a path-based id', () => {
        const { container } = render(<DiffViewer diff={SIMPLE_DIFF} />);
        // File path "src/a.ts" becomes "diff-file-src-a-ts"
        const fileSection = container.querySelector('#diff-file-src-a-ts');
        expect(fileSection).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Review mode tests
// ---------------------------------------------------------------------------

describe('DiffViewer — review mode', () => {
    it('Given a diff and an onAddComment callback, when rendered, then add-comment buttons are present', () => {
        render(<DiffViewer diff={SIMPLE_DIFF} onAddComment={vi.fn()} />);
        const addBtns = screen.getAllByRole('button', { name: /add comment/i });
        expect(addBtns.length).toBeGreaterThan(0);
    });

    it('Given a diff with no onAddComment prop, when rendered, then no add-comment buttons are present', () => {
        render(<DiffViewer diff={SIMPLE_DIFF} />);
        const addBtns = screen.queryAllByRole('button', { name: /add comment/i });
        expect(addBtns.length).toBe(0);
    });

    it('Given an onAddComment callback, when the add-comment button is clicked, then a comment textarea appears', () => {
        render(<DiffViewer diff={SIMPLE_DIFF} onAddComment={vi.fn()} />);
        const [firstBtn] = screen.getAllByRole('button', { name: /add comment/i });
        fireEvent.click(firstBtn);
        expect(screen.getByPlaceholderText('Write a review comment...')).toBeInTheDocument();
    });

    it('Given an open comment form, when Cancel is clicked, then the textarea disappears', () => {
        render(<DiffViewer diff={SIMPLE_DIFF} onAddComment={vi.fn()} />);
        const [firstBtn] = screen.getAllByRole('button', { name: /add comment/i });
        fireEvent.click(firstBtn);
        const textarea = screen.getByPlaceholderText('Write a review comment...');
        expect(textarea).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
        expect(screen.queryByPlaceholderText('Write a review comment...')).not.toBeInTheDocument();
    });

    it('Given an open comment form, when Cancel is clicked, then onAddComment is not called', () => {
        const onAddComment = vi.fn();
        render(<DiffViewer diff={SIMPLE_DIFF} onAddComment={onAddComment} />);
        const [firstBtn] = screen.getAllByRole('button', { name: /add comment/i });
        fireEvent.click(firstBtn);

        fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
        expect(onAddComment).not.toHaveBeenCalled();
    });

    it('Given an open comment form with text, when Save is clicked, then onAddComment is called with the correct args', () => {
        const onAddComment = vi.fn();
        render(<DiffViewer diff={SIMPLE_DIFF} onAddComment={onAddComment} />);

        // Click the first add-comment button (context line "const x = 1;", line 1)
        const addBtns = screen.getAllByRole('button', { name: /add comment/i });
        fireEvent.click(addBtns[0]);

        const textarea = screen.getByPlaceholderText('Write a review comment...');
        fireEvent.change(textarea, { target: { value: 'My review note' } });

        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

        expect(onAddComment).toHaveBeenCalledOnce();
        const [filePath, lineNumber, lineType, lineContent, text] = onAddComment.mock.calls[0] as [
            string,
            number,
            string,
            string,
            string,
        ];
        expect(filePath).toBe('src/a.ts');
        expect(lineNumber).toBeGreaterThan(0);
        expect(['added', 'removed', 'context']).toContain(lineType);
        expect(typeof lineContent).toBe('string');
        expect(text).toBe('My review note');
    });

    it('Given a comment form with no text, when Save is clicked, then onAddComment is not called', () => {
        const onAddComment = vi.fn();
        render(<DiffViewer diff={SIMPLE_DIFF} onAddComment={onAddComment} />);
        const [firstBtn] = screen.getAllByRole('button', { name: /add comment/i });
        fireEvent.click(firstBtn);

        // Leave textarea empty and click Save
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        expect(onAddComment).not.toHaveBeenCalled();
    });

    it('Given a comments prop with a saved comment, when rendered, then the comment text is visible', () => {
        const comment: ReviewComment = {
            id: 'c1',
            filePath: 'src/a.ts',
            lineNumber: 1,
            lineType: 'context',
            lineContent: 'const x = 1;',
            text: 'Looks good to me',
        };
        render(
            <DiffViewer
                diff={SIMPLE_DIFF}
                comments={[comment]}
                onAddComment={vi.fn()}
                onDeleteComment={vi.fn()}
                onEditComment={vi.fn()}
            />,
        );
        expect(screen.getByText('Looks good to me')).toBeInTheDocument();
    });

    it('Given a saved comment is displayed, when rendered, then Edit and Delete buttons are present', () => {
        const comment: ReviewComment = {
            id: 'c1',
            filePath: 'src/a.ts',
            lineNumber: 1,
            lineType: 'context',
            lineContent: 'const x = 1;',
            text: 'Some comment',
        };
        render(
            <DiffViewer
                diff={SIMPLE_DIFF}
                comments={[comment]}
                onAddComment={vi.fn()}
                onDeleteComment={vi.fn()}
                onEditComment={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: /edit comment/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete comment/i })).toBeInTheDocument();
    });

    it('Given a saved comment, when Delete is clicked, then onDeleteComment is called with the comment id', () => {
        const onDeleteComment = vi.fn();
        const comment: ReviewComment = {
            id: 'c-delete-test',
            filePath: 'src/a.ts',
            lineNumber: 1,
            lineType: 'context',
            lineContent: 'const x = 1;',
            text: 'Delete me',
        };
        render(
            <DiffViewer
                diff={SIMPLE_DIFF}
                comments={[comment]}
                onAddComment={vi.fn()}
                onDeleteComment={onDeleteComment}
                onEditComment={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /delete comment/i }));
        expect(onDeleteComment).toHaveBeenCalledWith('c-delete-test');
    });

    it('Given a saved comment, when Edit is clicked, then a pre-filled textarea appears', () => {
        const comment: ReviewComment = {
            id: 'c-edit-test',
            filePath: 'src/a.ts',
            lineNumber: 1,
            lineType: 'context',
            lineContent: 'const x = 1;',
            text: 'Original text',
        };
        render(
            <DiffViewer
                diff={SIMPLE_DIFF}
                comments={[comment]}
                onAddComment={vi.fn()}
                onDeleteComment={vi.fn()}
                onEditComment={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /edit comment/i }));

        const textarea = screen.getByRole('textbox', { name: /edit comment/i });
        expect(textarea).toBeInTheDocument();
        expect((textarea as HTMLTextAreaElement).value).toBe('Original text');
    });

    it('Given an edit form is open, when Save is clicked, then onEditComment is called with id and new text', () => {
        const onEditComment = vi.fn();
        const comment: ReviewComment = {
            id: 'c-edit-save',
            filePath: 'src/a.ts',
            lineNumber: 1,
            lineType: 'context',
            lineContent: 'const x = 1;',
            text: 'Original',
        };
        render(
            <DiffViewer
                diff={SIMPLE_DIFF}
                comments={[comment]}
                onAddComment={vi.fn()}
                onDeleteComment={vi.fn()}
                onEditComment={onEditComment}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /edit comment/i }));

        const textarea = screen.getByRole('textbox', { name: /edit comment/i });
        fireEvent.change(textarea, { target: { value: 'Updated text' } });

        // There may be multiple "Save" buttons; pick the one in the edit form
        const saveBtns = screen.getAllByRole('button', { name: /^save$/i });
        fireEvent.click(saveBtns[0]);

        expect(onEditComment).toHaveBeenCalledWith('c-edit-save', 'Updated text');
    });
});
