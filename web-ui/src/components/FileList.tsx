/**
 * FileList — displays the list of changed files for a session.
 *
 * Each file is shown as a clickable item. When `onFileClick` is provided,
 * clicking a file calls the callback with the file path (e.g., so the parent
 * can scroll the DiffViewer to the relevant section).
 */

import styles from '../styles/FileList.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FileListProps {
    /** List of changed file paths */
    files: string[];
    /** Called with the file path when a file item is clicked */
    onFileClick?: (filePath: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basename(filePath: string): string {
    return filePath.split('/').pop() ?? filePath;
}

function dirname(filePath: string): string {
    const parts = filePath.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileList({ files, onFileClick }: FileListProps) {
    if (files.length === 0) {
        return (
            <div className={styles.empty} role="status">
                No changed files.
            </div>
        );
    }

    return (
        <ul className={styles.list} aria-label="Changed files">
            {files.map((filePath) => {
                const name = basename(filePath);
                const dir = dirname(filePath);

                return (
                    <li key={filePath} className={styles.item}>
                        <button
                            type="button"
                            className={styles.fileButton}
                            onClick={() => onFileClick?.(filePath)}
                            aria-label={`View diff for ${filePath}`}
                        >
                            <span className={styles.fileIcon} aria-hidden="true">
                                &#128196;
                            </span>
                            <span className={styles.fileMeta}>
                                <span className={styles.fileName}>{name}</span>
                                {dir && (
                                    <span className={styles.fileDir}>{dir}/</span>
                                )}
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
