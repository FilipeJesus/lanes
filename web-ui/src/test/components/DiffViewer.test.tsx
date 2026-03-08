import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiffViewer } from '../../components/DiffViewer';

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
