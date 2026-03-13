import { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDaemonConnection } from '../hooks/useDaemonConnection';
import { useSessions } from '../hooks/useSessions';
import { CreateSessionDialog } from '../components/CreateSessionDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SessionDetailPanel } from '../components/SessionDetailPanel';
import { StatusBadge } from '../components/StatusBadge';
import { ProjectConnectionState } from '../components/ProjectConnectionState';
import { useProjectNotifications } from '../components/ProjectNotificationsProvider';
import type { CreateSessionRequest, SessionInfo } from '../api/types';
import { prepareSessionNotifications } from '../utils/sessionNotifications';
import styles from '../styles/ProjectDetail.module.css';

function sortSessions(sessions: SessionInfo[]): SessionInfo[] {
    return [...sessions].sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return a.name.localeCompare(b.name);
    });
}

export function ProjectDetail() {
    const { projectId, name } = useParams<{ projectId: string; name?: string }>();
    const navigate = useNavigate();
    const notifications = useProjectNotifications();
    const decodedName = name ? decodeURIComponent(name) : '';

    const {
        apiClient,
        sseClient,
        daemonInfo,
        loading: connectionLoading,
        error: connectionError,
        projectState,
        refresh: refreshConnection,
    } =
        useDaemonConnection(projectId);

    const {
        sessions,
        loading: sessionsLoading,
        error: sessionsError,
        createSession,
        improveSessionPrompt,
        uploadSessionAttachments,
        deleteSession,
        pinSession,
        unpinSession,
        enableSessionNotifications,
        disableSessionNotifications,
    } = useSessions(apiClient, sseClient);

    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [pendingPinName, setPendingPinName] = useState<string | null>(null);
    const [pendingNotificationName, setPendingNotificationName] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [notificationError, setNotificationError] = useState<string | null>(null);

    const isLoading = connectionLoading || sessionsLoading;
    const error = connectionError ?? sessionsError;
    const sortedSessions = sortSessions(sessions);
    const firstSession = sortedSessions[0] ?? null;
    const projectName = daemonInfo?.projectName ?? projectId ?? 'project';
    const workspaceRoot = daemonInfo?.workspaceRoot;
    const registeredAt = daemonInfo?.registeredAt;

    const handleRefresh = useCallback(() => {
        refreshConnection();
    }, [refreshConnection]);

    useEffect(() => {
        if (!projectId || isLoading || error || decodedName || !firstSession) {
            return;
        }

        void navigate(`/project/${projectId}/session/${encodeURIComponent(firstSession.name)}`, {
            replace: true,
        });
    }, [decodedName, error, firstSession, isLoading, navigate, projectId]);

    const handleCreate = useCallback(
        async (params: CreateSessionRequest) => {
            await createSession(params);

            if (projectId) {
                void navigate(`/project/${projectId}/session/${encodeURIComponent(params.name)}`);
            }
        },
        [createSession, navigate, projectId]
    );

    const handleDeleteRequest = useCallback((sessionName: string) => {
        setDeleteError(null);
        setPendingDeleteName(sessionName);
    }, []);

    const handleDeleteConfirm = useCallback(async () => {
        if (!pendingDeleteName) return;

        setIsDeleting(true);
        try {
            await deleteSession(pendingDeleteName);

            if (projectId && pendingDeleteName === decodedName) {
                const remaining = sortedSessions.filter((session) => session.name !== pendingDeleteName);

                if (remaining[0]) {
                    void navigate(
                        `/project/${projectId}/session/${encodeURIComponent(remaining[0].name)}`,
                        { replace: true }
                    );
                } else {
                    void navigate(`/project/${projectId}`, { replace: true });
                }
            }

            setPendingDeleteName(null);
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsDeleting(false);
        }
    }, [decodedName, deleteSession, navigate, pendingDeleteName, projectId, sortedSessions]);

    const handleDeleteCancel = useCallback(() => {
        setPendingDeleteName(null);
        setDeleteError(null);
    }, []);

    const handlePin = useCallback(
        async (sessionName: string) => {
            setPendingPinName(sessionName);
            try {
                await pinSession(sessionName);
            } finally {
                setPendingPinName(null);
            }
        },
        [pinSession]
    );

    const handleUnpin = useCallback(
        async (sessionName: string) => {
            setPendingPinName(sessionName);
            try {
                await unpinSession(sessionName);
            } finally {
                setPendingPinName(null);
            }
        },
        [unpinSession]
    );

    const handleEnableNotifications = useCallback(
        async (sessionName: string) => {
            setNotificationError(null);
            setPendingNotificationName(sessionName);
            try {
                await prepareSessionNotifications(notifications);
                await enableSessionNotifications(sessionName);
                const currentSession = sessions.find((session) => session.name === sessionName);
                notifications.syncSessionNotifications(
                    sessionName,
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
        async (sessionName: string) => {
            setNotificationError(null);
            setPendingNotificationName(sessionName);
            try {
                await disableSessionNotifications(sessionName);
                const currentSession = sessions.find((session) => session.name === sessionName);
                notifications.syncSessionNotifications(
                    sessionName,
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

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <nav className={styles.breadcrumb} aria-label="Breadcrumb">
                        <Link to="/" className={styles.breadcrumbLink}>
                            Projects
                        </Link>
                        <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
                        <span>{projectName}</span>
                    </nav>
                    <h1 className={styles.title}>Session Workspace</h1>
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
                    {projectId && (
                        <Link to={`/project/${projectId}/settings`} className={styles.secondaryButton}>
                            Settings
                        </Link>
                    )}
                    <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={handleRefresh}
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

            {!isLoading && error && (
                <div className={styles.errorBanner} role="alert">
                    <div>
                        <div className={styles.errorTitle}>Failed to load sessions</div>
                        <div className={styles.errorMessage}>{error.message}</div>
                    </div>
                </div>
            )}

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

            {!connectionError && !connectionLoading && (projectState === 'offline' || projectState === 'missing') && (
                <ProjectConnectionState
                    state={projectState}
                    projectId={projectId}
                    projectName={projectName}
                    workspaceRoot={workspaceRoot}
                    registeredAt={registeredAt}
                    onRefresh={handleRefresh}
                />
            )}

            {projectState === 'connected' && (
                <div className={styles.workspace}>
                    <aside className={styles.sidebar} aria-label="Sessions navigation">
                        <div className={styles.sidebarHeader}>
                            <div>
                                <div className={styles.sidebarEyebrow}>Sessions</div>
                                <div className={styles.sidebarTitle}>
                                    {sortedSessions.length} {sortedSessions.length === 1 ? 'session' : 'sessions'}
                                </div>
                            </div>
                            {apiClient && (
                                <button
                                    type="button"
                                    className={styles.sidebarCreateButton}
                                    onClick={() => setShowCreateDialog(true)}
                                >
                                    New
                                </button>
                            )}
                        </div>

                        {isLoading && sortedSessions.length === 0 && (
                            <div className={styles.loadingContainer} role="status" aria-label="Loading sessions">
                                <div className={styles.spinner} aria-hidden="true" />
                                <span>Loading sessions&hellip;</span>
                            </div>
                        )}

                        {!isLoading && !error && sortedSessions.length === 0 && (
                            <div className={styles.emptyState}>
                                <div className={styles.emptyStateTitle}>No sessions yet</div>
                                <p className={styles.emptyStateDescription}>
                                    Create a session to start working from this daemon.
                                </p>
                            </div>
                        )}

                        {sortedSessions.length > 0 && (
                            <ul className={styles.sessionList}>
                                {sortedSessions.map((session) => {
                                    const isSelected = session.name === decodedName;
                                    const notificationEnabled = session.notificationsEnabled ?? false;

                                    return (
                                        <li
                                            key={session.name}
                                            className={`${styles.sessionItem} ${
                                                isSelected ? styles.sessionItemActive : ''
                                            }`}
                                        >
                                            <button
                                                type="button"
                                                className={styles.sessionButton}
                                                onClick={() => {
                                                    if (projectId) {
                                                        void navigate(
                                                            `/project/${projectId}/session/${encodeURIComponent(session.name)}`
                                                        );
                                                    }
                                                }}
                                                aria-current={isSelected ? 'page' : undefined}
                                            >
                                                <div className={styles.sessionButtonTop}>
                                                    <span className={styles.sessionName}>{session.name}</span>
                                                    {session.isPinned && (
                                                        <span className={styles.sessionPinned}>Pinned</span>
                                                    )}
                                                </div>
                                                <div className={styles.sessionMeta}>
                                                    <StatusBadge status={session.status?.status ?? 'idle'} />
                                                    <span className={styles.sessionBranch}>
                                                        {session.branch || 'No branch'}
                                                    </span>
                                                </div>
                                                <div className={styles.sessionIndicators}>
                                                    <span className={styles.sessionIndicator}>
                                                        {notificationEnabled ? 'Notifications on' : 'Notifications off'}
                                                    </span>
                                                    {session.workflowStatus?.active && (
                                                        <span className={styles.sessionWorkflow}>
                                                            {session.workflowStatus.step ?? session.workflowStatus.workflow}
                                                        </span>
                                                    )}
                                                </div>
                                            </button>

                                            <div className={styles.sessionActions}>
                                                <button
                                                    type="button"
                                                    className={`${styles.iconButton} ${
                                                        session.isPinned ? styles.iconButtonActive : ''
                                                    }`}
                                                    onClick={() =>
                                                        void (session.isPinned
                                                            ? handleUnpin(session.name)
                                                            : handlePin(session.name))
                                                    }
                                                    disabled={pendingPinName === session.name}
                                                    aria-label={
                                                        session.isPinned
                                                            ? `Unpin session ${session.name}`
                                                            : `Pin session ${session.name}`
                                                    }
                                                >
                                                    {session.isPinned ? '\u2605' : '\u2606'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`${styles.iconButton} ${
                                                        notificationEnabled ? styles.iconButtonActive : ''
                                                    }`}
                                                    onClick={() =>
                                                        void (notificationEnabled
                                                            ? handleDisableNotifications(session.name)
                                                            : handleEnableNotifications(session.name))
                                                    }
                                                    disabled={pendingNotificationName === session.name}
                                                    aria-label={
                                                        notificationEnabled
                                                            ? `Disable notifications for session ${session.name}`
                                                            : `Enable notifications for session ${session.name}`
                                                    }
                                                >
                                                    {notificationEnabled ? '\u{1F514}' : '\u{1F515}'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.iconButton}
                                                    onClick={() => handleDeleteRequest(session.name)}
                                                    disabled={pendingDeleteName === session.name && isDeleting}
                                                    aria-label={`Delete session ${session.name}`}
                                                >
                                                    &#x1F5D1;
                                                </button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </aside>

                    <section className={styles.detailPane} aria-label="Selected session">
                        {!isLoading && !error && sortedSessions.length === 0 && (
                            <div className={styles.detailEmptyState}>
                                <div className={styles.detailEmptyTitle}>No session selected</div>
                                <p className={styles.detailEmptyDescription}>
                                    Create a session from the sidebar to populate the workspace.
                                </p>
                            </div>
                        )}

                        {sortedSessions.length > 0 && !decodedName && (
                            <div className={styles.detailEmptyState}>
                                <div className={styles.detailEmptyTitle}>Opening first session</div>
                                <p className={styles.detailEmptyDescription}>
                                    Routing the workspace to the first available session.
                                </p>
                            </div>
                        )}

                        {decodedName && projectId && (
                            <SessionDetailPanel
                                projectId={projectId}
                                sessionName={decodedName}
                                apiClient={apiClient}
                                sseClient={sseClient}
                                daemonInfo={daemonInfo}
                                connectionLoading={connectionLoading}
                                connectionError={connectionError}
                                subscribeToSse={false}
                            />
                        )}

                        {decodedName && !sortedSessions.some((session) => session.name === decodedName) && !isLoading && !error && (
                            <div className={styles.detailEmptyState}>
                                <div className={styles.detailEmptyTitle}>Session not found</div>
                                <p className={styles.detailEmptyDescription}>
                                    Choose an existing session from the left navigation.
                                </p>
                            </div>
                        )}
                    </section>
                </div>
            )}

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
