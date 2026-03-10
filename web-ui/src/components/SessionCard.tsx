/**
 * SessionCard — displays a single session in the session list.
 *
 * Shows session name, status badge, branch, workflow state, and action buttons
 * (pin/unpin, delete). Clicking the card body navigates to session detail.
 */

import { useNavigate } from 'react-router-dom';
import type { SessionInfo } from '../api/types';
import { StatusBadge } from './StatusBadge';
import styles from '../styles/SessionCard.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SessionCardProps {
    session: SessionInfo;
    projectId: string;
    onPin: (name: string) => void;
    onUnpin: (name: string) => void;
    onDelete: (name: string) => void;
    onEnableNotifications: (name: string) => void;
    onDisableNotifications: (name: string) => void;
    isPinPending?: boolean;
    isDeletePending?: boolean;
    isNotificationPending?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionCard({
    session,
    projectId,
    onPin,
    onUnpin,
    onDelete,
    onEnableNotifications,
    onDisableNotifications,
    isPinPending = false,
    isDeletePending = false,
    isNotificationPending = false,
}: SessionCardProps) {
    const navigate = useNavigate();

    function handleCardClick() {
        void navigate(`/project/${projectId}/session/${encodeURIComponent(session.name)}`);
    }

    function handleCardKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCardClick();
        }
    }

    function handlePinClick(e: React.MouseEvent) {
        e.stopPropagation();
        if (session.isPinned) {
            onUnpin(session.name);
        } else {
            onPin(session.name);
        }
    }

    function handleDeleteClick(e: React.MouseEvent) {
        e.stopPropagation();
        onDelete(session.name);
    }

    function handleNotificationClick(e: React.MouseEvent) {
        e.stopPropagation();
        if (session.notificationsEnabled) {
            onDisableNotifications(session.name);
        } else {
            onEnableNotifications(session.name);
        }
    }

    const agentName = session.data?.agentName ?? 'claude';
    const workflowActive = session.workflowStatus?.active ?? false;
    const workflowStep = session.workflowStatus?.step ?? session.workflowStatus?.workflow;

    return (
        <div
            className={`${styles.card} ${session.isPinned ? styles.pinned : ''}`}
            role="button"
            tabIndex={0}
            onClick={handleCardClick}
            onKeyDown={handleCardKeyDown}
            aria-label={`Open session ${session.name}`}
        >
            <div className={styles.info}>
                <div className={styles.nameRow}>
                    <span className={styles.name}>{session.name}</span>
                    {session.isPinned && (
                        <span className={styles.pinnedBadge} aria-label="Pinned">
                            Pinned
                        </span>
                    )}
                </div>

                <div className={styles.meta}>
                    <StatusBadge status={session.status?.status ?? 'idle'} />

                    {session.branch && (
                        <span className={styles.metaItem}>
                            <span className={styles.metaLabel}>Branch</span>
                            <span className={styles.metaValue}>{session.branch}</span>
                        </span>
                    )}

                    <span className={styles.metaItem}>
                        <span className={styles.metaLabel}>Agent</span>
                        <span className={styles.metaValue}>{agentName}</span>
                    </span>

                    {workflowActive && workflowStep && (
                        <span className={styles.workflowBadge} title="Workflow in progress">
                            {workflowStep}
                        </span>
                    )}
                </div>
            </div>

            <div className={styles.actions}>
                <button
                    type="button"
                    className={`${styles.actionButton} ${styles.notificationButton} ${session.notificationsEnabled ? styles.active : ''}`}
                    onClick={handleNotificationClick}
                    disabled={isNotificationPending}
                    aria-label={
                        session.notificationsEnabled
                            ? `Disable notifications for session ${session.name}`
                            : `Enable notifications for session ${session.name}`
                    }
                    title={session.notificationsEnabled ? 'Disable notifications' : 'Enable notifications'}
                >
                    {session.notificationsEnabled ? '\u{1F514}' : '\u{1F515}'}
                </button>

                <button
                    type="button"
                    className={`${styles.actionButton} ${styles.pinButton} ${session.isPinned ? styles.active : ''}`}
                    onClick={handlePinClick}
                    disabled={isPinPending}
                    aria-label={session.isPinned ? `Unpin session ${session.name}` : `Pin session ${session.name}`}
                    title={session.isPinned ? 'Unpin' : 'Pin'}
                >
                    {session.isPinned ? '\u2605' : '\u2606'}
                </button>

                <button
                    type="button"
                    className={`${styles.actionButton} ${styles.deleteButton}`}
                    onClick={handleDeleteClick}
                    disabled={isDeletePending}
                    aria-label={`Delete session ${session.name}`}
                    title="Delete session"
                >
                    &#x1F5D1;
                </button>
            </div>
        </div>
    );
}
