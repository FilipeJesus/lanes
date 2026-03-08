/**
 * DiffViewer — renders a unified diff string as a colour-coded table.
 *
 * Parses the diff into file sections and lines, then renders:
 * - File headers (--- / +++ hunk) as section separators
 * - Added lines (+) with green background
 * - Removed lines (-) with red background
 * - Context lines with default background
 * - Old/new line number gutter on each side
 *
 * Long lines scroll horizontally inside the pre element.
 * No external dependencies — pure CSS Modules + design tokens.
 */

import styles from '../styles/DiffViewer.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiffLine {
    type: 'added' | 'removed' | 'context' | 'header' | 'file';
    content: string;
    oldLineNo: number | null;
    newLineNo: number | null;
}

interface DiffFile {
    header: string;
    lines: DiffLine[];
}

// ---------------------------------------------------------------------------
// Unified diff parser
// ---------------------------------------------------------------------------

function parseDiff(raw: string): DiffFile[] {
    const files: DiffFile[] = [];
    let current: DiffFile | null = null;
    let oldLineNo = 0;
    let newLineNo = 0;

    const rawLines = raw.split('\n');

    for (const rawLine of rawLines) {
        // New file block starts with "diff --git" or "--- " at top level
        if (rawLine.startsWith('diff ')) {
            current = { header: rawLine, lines: [] };
            files.push(current);
            oldLineNo = 0;
            newLineNo = 0;
            continue;
        }

        // If we have no current file yet, create one for diffs without "diff --git" headers
        if (!current) {
            current = { header: '', lines: [] };
            files.push(current);
        }

        if (rawLine.startsWith('--- ') || rawLine.startsWith('+++ ')) {
            current.lines.push({
                type: 'file',
                content: rawLine,
                oldLineNo: null,
                newLineNo: null,
            });
            continue;
        }

        if (rawLine.startsWith('@@ ')) {
            // Parse hunk header: @@ -<old>,<count> +<new>,<count> @@
            const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
            if (match) {
                oldLineNo = parseInt(match[1], 10) - 1;
                newLineNo = parseInt(match[2], 10) - 1;
            }
            current.lines.push({
                type: 'header',
                content: rawLine,
                oldLineNo: null,
                newLineNo: null,
            });
            continue;
        }

        if (rawLine.startsWith('+')) {
            newLineNo++;
            current.lines.push({
                type: 'added',
                content: rawLine.slice(1),
                oldLineNo: null,
                newLineNo,
            });
            continue;
        }

        if (rawLine.startsWith('-')) {
            oldLineNo++;
            current.lines.push({
                type: 'removed',
                content: rawLine.slice(1),
                oldLineNo,
                newLineNo: null,
            });
            continue;
        }

        if (rawLine.startsWith(' ') || rawLine === '') {
            oldLineNo++;
            newLineNo++;
            current.lines.push({
                type: 'context',
                content: rawLine.startsWith(' ') ? rawLine.slice(1) : '',
                oldLineNo,
                newLineNo,
            });
            continue;
        }

        // Any other line (index, etc.) — treat as header
        current.lines.push({
            type: 'header',
            content: rawLine,
            oldLineNo: null,
            newLineNo: null,
        });
    }

    return files;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LineNo({ n }: { n: number | null }) {
    return (
        <span className={styles.lineNo} aria-hidden="true">
            {n !== null ? n : ''}
        </span>
    );
}

// ---------------------------------------------------------------------------
// DiffViewer component
// ---------------------------------------------------------------------------

/** Converts a file path into a CSS-safe anchor ID, matching SessionDetail's filePathToId. */
function filePathToId(filePath: string): string {
    return 'diff-file-' + filePath.replace(/[^a-zA-Z0-9-_]/g, '-');
}

export interface DiffViewerProps {
    /** Unified diff string. If empty, shows an empty-state message. */
    diff: string;
    /** @deprecated idPrefix is no longer used; IDs are derived from file paths. */
    idPrefix?: string;
}

export function DiffViewer({ diff }: DiffViewerProps) {
    if (!diff.trim()) {
        return (
            <div className={styles.empty} role="status">
                No changes to display.
            </div>
        );
    }

    const files = parseDiff(diff);

    return (
        <div className={styles.root}>
            {files.map((file, fileIdx) => {
                // Derive a display name from the +++ line or fallback to the diff header
                const fileLine = file.lines.find((l) => l.type === 'file' && l.content.startsWith('+++ '));
                const displayName = fileLine
                    ? fileLine.content.replace(/^\+\+\+ (b\/)?/, '')
                    : file.header;
                // Use a CSS-safe path-based ID so FileList scroll anchors are stable
                const fileId = filePathToId(displayName);

                return (
                    <div key={fileIdx} className={styles.file} id={fileId}>
                        <div className={styles.fileHeader}>
                            <span className={styles.fileHeaderIcon} aria-hidden="true">&#9776;</span>
                            <span className={styles.fileHeaderName}>{displayName}</span>
                        </div>

                        <div className={styles.tableWrapper}>
                            <table className={styles.table} aria-label={`Diff for ${displayName}`}>
                                <colgroup>
                                    <col className={styles.colLineNo} />
                                    <col className={styles.colLineNo} />
                                    <col className={styles.colCode} />
                                </colgroup>
                                <tbody>
                                    {file.lines.map((line, lineIdx) => {
                                        if (line.type === 'file') return null; // rendered in header

                                        if (line.type === 'header') {
                                            return (
                                                <tr key={lineIdx} className={styles.hunkRow}>
                                                    <td colSpan={3} className={styles.hunkCell}>
                                                        <code>{line.content}</code>
                                                    </td>
                                                </tr>
                                            );
                                        }

                                        const rowClass =
                                            line.type === 'added'
                                                ? styles.addedRow
                                                : line.type === 'removed'
                                                  ? styles.removedRow
                                                  : styles.contextRow;

                                        const marker =
                                            line.type === 'added'
                                                ? '+'
                                                : line.type === 'removed'
                                                  ? '-'
                                                  : ' ';

                                        return (
                                            <tr key={lineIdx} className={rowClass}>
                                                <td className={styles.lineNoCell}>
                                                    <LineNo n={line.oldLineNo} />
                                                </td>
                                                <td className={styles.lineNoCell}>
                                                    <LineNo n={line.newLineNo} />
                                                </td>
                                                <td className={styles.codeCell}>
                                                    <span
                                                        className={styles.marker}
                                                        aria-hidden="true"
                                                    >
                                                        {marker}
                                                    </span>
                                                    <code>{line.content}</code>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
