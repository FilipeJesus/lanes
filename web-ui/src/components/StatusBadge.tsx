/**
 * StatusBadge — coloured pill showing the agent status for a session.
 *
 * Supports all AgentStatusState values: working, waiting_for_user, active,
 * idle, error.
 */

import type { AgentStatusState } from '../api/types';
import styles from '../styles/StatusBadge.module.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function badgeClass(status: AgentStatusState): string {
    switch (status) {
        case 'working':
            return styles.working;
        case 'waiting_for_user':
            return styles.waitingForUser;
        case 'active':
            return styles.active;
        case 'idle':
            return styles.idle;
        case 'error':
            return styles.error;
    }
}

function labelText(status: AgentStatusState): string {
    switch (status) {
        case 'working':
            return 'Working';
        case 'waiting_for_user':
            return 'Waiting';
        case 'active':
            return 'Active';
        case 'idle':
            return 'Idle';
        case 'error':
            return 'Error';
    }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StatusBadgeProps {
    status: AgentStatusState;
    className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatusBadge({ status, className }: StatusBadgeProps) {
    const cls = `${styles.badge} ${badgeClass(status)}${className ? ` ${className}` : ''}`;

    return (
        <span className={cls} title={status} aria-label={`Status: ${status}`}>
            <span className={styles.dot} aria-hidden="true" />
            {labelText(status)}
        </span>
    );
}
