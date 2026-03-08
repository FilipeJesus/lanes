/**
 * WorkflowTaskList — displays the tasks associated with a loop/ralph workflow
 * step, each with a status indicator.
 *
 * Task status is inferred from the task string format or can be passed
 * explicitly. The raw tasks array from WorkflowState is plain strings, so
 * we display each as-is with a neutral "pending" indicator by default.
 *
 * If `taskStatuses` is provided it maps task strings to their status.
 */

import styles from '../styles/WorkflowTaskList.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export interface WorkflowTaskListProps {
    /** The tasks array from WorkflowState.tasks */
    tasks: string[];
    /**
     * Optional map of task → status. If not provided, all tasks render as
     * pending.
     */
    taskStatuses?: Record<string, TaskStatus>;
    /** Optional heading shown above the list */
    title?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusDotClass(status: TaskStatus): string {
    switch (status) {
        case 'pending':
            return styles.statusPending;
        case 'in_progress':
            return styles.statusInProgress;
        case 'done':
            return styles.statusDone;
        case 'failed':
            return styles.statusFailed;
    }
}

function taskNameClass(status: TaskStatus): string {
    switch (status) {
        case 'done':
            return styles.taskNameDone;
        case 'failed':
            return styles.taskNameFailed;
        case 'in_progress':
            return styles.taskNameInProgress;
        default:
            return '';
    }
}

function statusLabel(status: TaskStatus): string {
    switch (status) {
        case 'pending':
            return 'Pending';
        case 'in_progress':
            return 'In progress';
        case 'done':
            return 'Done';
        case 'failed':
            return 'Failed';
    }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkflowTaskList({ tasks, taskStatuses = {}, title }: WorkflowTaskListProps) {
    if (tasks.length === 0) {
        return <p className={styles.empty}>No tasks.</p>;
    }

    return (
        <div className={styles.root}>
            {title && <div className={styles.title}>{title}</div>}

            <ul className={styles.list} aria-label={title ?? 'Workflow tasks'}>
                {tasks.map((task, i) => {
                    const status: TaskStatus = taskStatuses[task] ?? 'pending';
                    const nameClass = [styles.taskName, taskNameClass(status)]
                        .filter(Boolean)
                        .join(' ');

                    return (
                        <li
                            key={`${task}-${i}`}
                            className={styles.taskItem}
                            data-testid={`task-item-${i}`}
                        >
                            <span
                                className={`${styles.taskStatus} ${statusDotClass(status)}`}
                                role="img"
                                aria-label={statusLabel(status)}
                            />
                            <span className={nameClass}>{task}</span>
                            {status !== 'pending' && (
                                <span className={styles.statusLabel} aria-hidden="true">
                                    {statusLabel(status)}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
