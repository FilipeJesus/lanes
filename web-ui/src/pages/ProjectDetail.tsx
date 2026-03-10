/**
 * Project Detail page — shows sessions for a single registered project.
 * The :projectId URL param identifies which project to connect to.
 *
 * Features:
 * - Lists all sessions with real-time SSE status updates
 * - Create session dialog (fetches agents, workflows, branches from daemon)
 * - Pin / unpin sessions
 * - Delete session with confirmation dialog
 */

import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDaemonConnection } from '../hooks/useDaemonConnection';
import { useSessions } from '../hooks/useSessions';
import { SessionCard } from '../components/SessionCard';
import { CreateSessionDialog } from '../components/CreateSessionDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useProjectNotifications } from '../components/ProjectNotificationsProvider';
import type { CreateSessionRequest } from '../api/types';
import { prepareSessionNotifications } from '../utils/sessionNotifications';
import styles from '../styles/ProjectDetail.module.css';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectDetail() {
    const { projectId } = useParams<{ projectId: string }>();
    const notifications = useProjectNotifications();

    // Daemon connection (provides API client + SSE client)
    const { apiClient, sseClient, daemonInfo, loading: connectionLoading, error: connectionError } =
        useDaemonConnection(projectId);

    // Session list with real-time updates
    const {
        sessions,
        loading: sessionsLoading,
        error: sessionsError,
        refresh,
        createSession,
        improveSessionPrompt,
        uploadSessionAttachments,
        deleteSession,
        pinSession,
        unpinSession,
        enableSessionNotifications,
        disableSessionNotifications,
    } = useSessions(apiClient, sseClient);

    // UI state
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [pendingPinName, setPendingPinName] = useState<string | null>(null);
    const [pendingNotificationName, setPendingNotificationName] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [notificationError, setNotificationError] = useState<string | null>(null);

    // ---------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------

    const handleCreate = useCallback(
        async (params: CreateSessionRequest) => {
            await createSession(params);
        },
        [createSession]
    );

    const handleDeleteRequest = useCallback((name: string) => {
        setDeleteError(null);
        setPendingDeleteName(name);
    }, []);

    const handleDeleteConfirm = useCallback(async () => {
        if (!pendingDeleteName) return;
        setIsDeleting(true);
        try {
            await deleteSession(pendingDeleteName);
            setPendingDeleteName(null);
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsDeleting(false);
        }
    }, [pendingDeleteName, deleteSession]);

    const handleDeleteCancel = useCallback(() => {
        setPendingDeleteName(null);
        setDeleteError(null);
    }, []);

    const handlePin = useCallback(
        async (name: string) => {
            setPendingPinName(name);
            try {
                await pinSession(name);
            } finally {
                setPendingPinName(null);
            }
        },
        [pinSession]
    );

    const handleUnpin = useCallback(
        async (name: string) => {
            setPendingPinName(name);
            try {
                await unpinSession(name);
            } finally {
                setPendingPinName(null);
            }
        },
        [unpinSession]
    );

    const handleEnableNotifications = useCallback(
        async (name: string) => {
            setNotificationError(null);
            setPendingNotificationName(name);
            try {
                await prepareSessionNotifications(notifications);
                await enableSessionNotifications(name);
                const currentSession = sessions.find((session) => session.name === name);
                notifications.syncSessionNotifications(
                    name,
                    true,
                    currentSession?.status ?? null
                );
            } catch (err) {
                setNotificationError(err instanceof Error ? err.message : String(err));
            } finally {
                setPendingNotificationName(null);
            }
        },
        [enableSessionNotifications, notifications, sessions]
    );

    const handleDisableNotifications = useCallback(
        async (name: string) => {
            setNotificationError(null);
            setPendingNotificationName(name);
            try {
                await disableSessionNotifications(name);
                const currentSession = sessions.find((session) => session.name === name);
                notifications.syncSessionNotifications(
                    name,
                    false,
                    currentSession?.status ?? null
                );
            } catch (err) {
                setNotificationError(err instanceof Error ? err.message : String(err));
            } finally {
                setPendingNotificationName(null);
            }
        },
        [disableSessionNotifications, notifications, sessions]
    );

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    const isLoading = connectionLoading || sessionsLoading;
    const error = connectionError ?? sessionsError;

    // Sort: pinned first, then by name
    const sortedSessions = [...sessions].sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return a.name.localeCompare(b.name);
    });

    return (
        <div className={styles.page}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <nav className={styles.breadcrumb} aria-label="Breadcrumb">
                        <Link to="/" className={styles.breadcrumbLink}>
                            Projects
                        </Link>
                        <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
                        <span>{daemonInfo?.projectName ?? projectId}</span>
                    </nav>
                    <h1 className={styles.title}>Sessions</h1>
                    {daemonInfo?.daemon?.port && (
                        <span className={styles.subtitle}>daemon @ localhost:{daemonInfo.daemon.port}</span>
                    )}
                </div>

                <div className={styles.headerActions}>
                    {projectId && (
                        <Link to={`/project/${projectId}/workflows`} className={styles.secondaryButton}>
                            Workflows
                        </Link>
                    )}
                    <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={refresh}
                        aria-label="Refresh session list"
                    >
                        Refresh
                    </button>
                    {apiClient && (
                        <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={() => setShowCreateDialog(true)}
                        >
                            + Create Session
                        </button>
                    )}
                </div>
            </div>

            {/* Loading */}
            {isLoading && sessions.length === 0 && (
                <div className={styles.loadingContainer} role="status" aria-label="Loading sessions">
                    <div className={styles.spinner} aria-hidden="true" />
                    <span>Loading sessions&hellip;</span>
                </div>
            )}

            {/* Error */}
            {!isLoading && error && (
                <div className={styles.errorBanner} role="alert">
                    <div>
                        <div className={styles.errorTitle}>Failed to load sessions</div>
                        <div className={styles.errorMessage}>{error.message}</div>
                    </div>
                </div>
            )}

            {/* Delete error */}
            {deleteError && (
                <div className={styles.errorBanner} role="alert">
                    <div>
                        <div className={styles.errorTitle}>Failed to delete session</div>
                        <div className={styles.errorMessage}>{deleteError}</div>
                    </div>
                </div>
            )}

            {notificationError && (
                <div className={styles.errorBanner} role="alert">
                    <div>
                        <div className={styles.errorTitle}>Failed to update notifications</div>
                        <div className={styles.errorMessage}>{notificationError}</div>
                    </div>
                </div>
            )}

            {/* Session list */}
            {!isLoading && !error && sortedSessions.length === 0 && (
                <div className={styles.emptyState}>
                    <div className={styles.emptyStateTitle}>No sessions yet</div>
                    <p className={styles.emptyStateDescription}>
                        Create your first session to start an isolated AI coding session in a new
                        worktree.
                    </p>
                    {apiClient && (
                        <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={() => setShowCreateDialog(true)}
                        >
                            + Create Session
                        </button>
                    )}
                </div>
            )}

            {sortedSessions.length > 0 && (
                <div>
                    <div className={styles.toolbar}>
                        <span className={styles.sessionCount}>
                            {sortedSessions.length}{' '}
                            {sortedSessions.length === 1 ? 'session' : 'sessions'}
                        </span>
                    </div>

                    <div className={styles.sessionList}>
                        {sortedSessions.map((session) => (
                            <SessionCard
                                key={session.name}
                                session={session}
                                projectId={projectId ?? ''}
                                onPin={(name) => void handlePin(name)}
                                onUnpin={(name) => void handleUnpin(name)}
                                onDelete={handleDeleteRequest}
                                onEnableNotifications={(name) => void handleEnableNotifications(name)}
                                onDisableNotifications={(name) => void handleDisableNotifications(name)}
                                isPinPending={pendingPinName === session.name}
                                isDeletePending={pendingDeleteName === session.name && isDeleting}
                                isNotificationPending={pendingNotificationName === session.name}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Create session dialog */}
            {apiClient && (
                <CreateSessionDialog
                isOpen={showCreateDialog}
                apiClient={apiClient}
                onClose={() => setShowCreateDialog(false)}
                onCreate={handleCreate}
                onImprovePrompt={improveSessionPrompt}
                onUploadAttachments={uploadSessionAttachments}
            />
        )}

            {/* Delete confirmation dialog */}
            <ConfirmDialog
                isOpen={pendingDeleteName !== null}
                title="Delete Session"
                message={`Are you sure you want to delete session "${pendingDeleteName}"? This will remove the worktree and cannot be undone.`}
                confirmLabel="Delete"
                cancelLabel="Cancel"
                onConfirm={() => void handleDeleteConfirm()}
                onCancel={handleDeleteCancel}
                isPending={isDeleting}
            />
        </div>
    );
}
