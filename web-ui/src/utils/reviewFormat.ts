/**
 * reviewFormat — types and formatting helpers for inline code review comments.
 *
 * Comments are stored in memory and formatted for clipboard export.
 * No backend is involved — this is a purely client-side feature.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewComment {
    id: string;
    filePath: string;
    lineNumber: number;
    lineType: 'added' | 'removed' | 'context';
    lineContent: string;
    text: string;
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

/**
 * Formats a list of review comments as a Markdown string suitable for
 * pasting into a code-review tool, PR description, or AI chat.
 */
export function formatReviewForClipboard(comments: ReviewComment[]): string {
    if (comments.length === 0) {
        return 'No comments in this review.';
    }

    const commentsByFile = new Map<string, ReviewComment[]>();
    for (const comment of comments) {
        const existing = commentsByFile.get(comment.filePath) ?? [];
        existing.push(comment);
        commentsByFile.set(comment.filePath, existing);
    }

    const lines: string[] = ['# Code Review Comments', ''];

    for (const [filePath, fileComments] of commentsByFile) {
        lines.push(`## ${filePath}`);
        lines.push('');

        fileComments.sort((a, b) => a.lineNumber - b.lineNumber);

        for (const comment of fileComments) {
            const linePrefix =
                comment.lineType === 'added'
                    ? '+'
                    : comment.lineType === 'removed'
                      ? '-'
                      : ' ';
            lines.push(`**Line ${comment.lineNumber}** (${comment.lineType}):`);
            lines.push('```');
            lines.push(`${linePrefix}${comment.lineContent}`);
            lines.push('```');
            lines.push(`> ${comment.text}`);
            lines.push('');
        }
    }

    return lines.join('\n');
}
