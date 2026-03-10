import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { DaemonApiClient } from '../api/client';
import type { DaemonSseClient, SseCallbacks } from '../api/sse';
import type {
    AgentSessionStatus,
    GatewayProjectInfo,
    SessionInfo,
    WorkflowState,
    WorkflowStep,
    WorktreeInfo,
} from '../api/types';
import { useDiff } from '../hooks/useDiff';
import { useInsights } from '../hooks/useInsights';
import { StatusBadge } from './StatusBadge';
import { DiffViewer } from './DiffViewer';
import { FileList } from './FileList';
import { InsightsPanel } from './InsightsPanel';
import { StepProgressTracker } from './StepProgressTracker';
import { WorkflowTaskList } from './WorkflowTaskList';
import { TerminalView } from './TerminalView';
import { useProjectNotifications } from './ProjectNotificationsProvider';
import { formatReviewForClipboard } from '../utils/reviewFormat';
import type { ReviewComment } from '../utils/reviewFormat';
import { prepareSessionNotifications } from '../utils/sessionNotifications';
import styles from '../styles/SessionDetail.module.css';

function filePathToId(filePath: string): string {
    return 'diff-file-' + filePath.replace(/[^a-zA-Z0-9-_]/g, '-');
}

function buildFallbackSteps(workflow: WorkflowState): WorkflowStep[] {
    const seen = new Set<string>();
    const steps: WorkflowStep[] = [];

    for (const id of workflow.completedSteps ?? []) {
        if (!seen.has(id)) {
            seen.add(id);
            steps.push({ id, type: 'step' });
        }
    }

    if (workflow.currentStep && !seen.has(workflow.currentStep)) {
        steps.push({ id: workflow.currentStep, type: 'step' });
    }

    return steps;
}

type ActiveTab = 'changes' | 'insights' | 'terminal';

export interface SessionDetailPanelProps {
    projectId: string;
    sessionName: string;
    apiClient: DaemonApiClient | null;
    sseClient: DaemonSseClient | null;
    daemonInfo: GatewayProjectInfo | null;
    connectionLoading: boolean;
    connectionError: Error | null;
    showBreadcrumb?: boolean;
    subscribeToSse?: boolean;
}

export function SessionDetailPanel({
    projectId,
    sessionName,
    apiClient,
    sseClient,
    daemonInfo,
    connectionLoading,
    connectionError,
    showBreadcrumb = false,
    subscribeToSse = true,
}: SessionDetailPanelProps) {
    const notifications = useProjectNotifications();

    const [session, setSession] = useState<SessionInfo | null>(null);
    const [worktree, setWorktree] = useState<WorktreeInfo | null>(null);
    const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
    const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
    const [dataLoading, setDataLoading] = useState(false);
    const [dataError, setDataError] = useState<Error | null>(null);
    const [notificationError, setNotificationError] = useState<string | null>(null);
    const [notificationPending, setNotificationPending] = useState(false);
    const [activeTab, setActiveTab] = useState<ActiveTab>('terminal');
    const [includeUncommitted, setIncludeUncommitted] = useState(false);
    const [baseBranch, setBaseBranch] = useState('');
    const [branchInputValue, setBranchInputValue] = useState('');
    const diffSectionRef = useRef<HTMLDivElement>(null);
    const [comments, setComments] = useState<ReviewComment[]>([]);

    const {
        files: diffFiles,
        diff,
        loading: diffLoading,
        error: diffError,
        refresh: refreshDiff,
        resolvedBaseBranch,
    } = useDiff(apiClient, sessionName || undefined, includeUncommitted, baseBranch);

    const {
        insights,
        analysis,
        loading: insightsLoading,
        error: insightsError,
        refresh: refreshInsights,
    } = useInsights(apiClient, sessionName || undefined);

    const load = useCallback(async () => {
        if (!apiClient || !sessionName) return;

        setDataLoading(true);
        setDataError(null);

        try {
            const [sessionsRes, worktreeRes, workflowRes] = await Promise.allSettled([
                apiClient.listSessions(),
                apiClient.getSessionWorktree(sessionName),
                apiClient.getSessionWorkflow(sessionName),
            ]);

            if (sessionsRes.status === 'fulfilled') {
                const found = sessionsRes.value.sessions.find((entry) => entry.name === sessionName);
                setSession(found ?? null);
            }

            if (worktreeRes.status === 'fulfilled') {
                setWorktree(worktreeRes.value);
            }

            if (workflowRes.status === 'fulfilled') {
                const wfState = workflowRes.value;
                setWorkflow(wfState);

                if (wfState.workflowName) {
                    try {
                        const wfListRes = await apiClient.listWorkflows();
                        const match = wfListRes.workflows.find(
                            (entry) => entry.name === wfState.workflowName
                        );
                        setWorkflowSteps(match?.steps ?? []);
                    } catch {
                        setWorkflowSteps([]);
                    }
                } else {
                    setWorkflowSteps([]);
                }
            }
        } catch (err) {
            setDataError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            setDataLoading(false);
        }
    }, [apiClient, sessionName]);

    useEffect(() => {
        setActiveTab('terminal');
        setIncludeUncommitted(false);
        setBaseBranch('');
        setBranchInputValue('');
        setComments([]);
        setSession(null);
        setWorktree(null);
        setWorkflow(null);
        setWorkflowSteps([]);
        setDataError(null);
        void load();
    }, [load]);

    useEffect(() => {
        if (!subscribeToSse || !sseClient || !sessionName) return;

        const callbacks: SseCallbacks = {
            onSessionStatusChanged: ({ sessionName: changedName, status }) => {
                if (changedName === sessionName) {
                    setSession((prev) =>
                        prev ? { ...prev, status: status as AgentSessionStatus } : prev
                    );
                }
            },
            onSessionDeleted: ({ sessionName: deletedName }) => {
                if (deletedName === sessionName) {
                    setSession(null);
                    setDataError(new Error('Session was deleted'));
                }
            },
        };

        const unsubscribe = sseClient.subscribe?.(callbacks);
        if (!unsubscribe) {
            sseClient.setCallbacks(callbacks);
        }
        sseClient.connect();

        return () => {
            if (unsubscribe) {
                unsubscribe();
                return;
            }

            sseClient.disconnect();
        };
    }, [sseClient, sessionName, subscribeToSse]);

    const handleFileClick = useCallback((filePath: string) => {
        if (!diffSectionRef.current) return;

        const id = filePathToId(filePath);
        const el = diffSectionRef.current.querySelector(`[id="${CSS.escape(id)}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    const handleAddComment = useCallback(
        (
            filePath: string,
            lineNumber: number,
            lineType: 'added' | 'removed' | 'context',
            lineContent: string,
            text: string,
        ) => {
            setComments((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    filePath,
                    lineNumber,
                    lineType,
                    lineContent,
                    text,
                },
            ]);
        },
        [],
    );

    const handleDeleteComment = useCallback((commentId: string) => {
        setComments((prev) => prev.filter((entry) => entry.id !== commentId));
    }, []);

    const handleEditComment = useCallback((commentId: string, newText: string) => {
        setComments((prev) =>
            prev.map((entry) => (entry.id === commentId ? { ...entry, text: newText } : entry)),
        );
    }, []);

    const handleSubmitReview = useCallback(async () => {
        const formatted = formatReviewForClipboard(comments);
        await navigator.clipboard.writeText(formatted);
    }, [comments]);

    const handleEnableNotifications = useCallback(async () => {
        if (!apiClient || !session) return;

        setNotificationError(null);
        setNotificationPending(true);
        try {
            await prepareSessionNotifications(notifications);
            const updated = await apiClient.enableSessionNotifications(session.name);
            notifications.syncSessionNotifications(session.name, true, session.status ?? null);
            setSession((prev) =>
                prev ? { ...prev, notificationsEnabled: updated.notificationsEnabled ?? true } : prev
            );
        } catch (err) {
            setNotificationError(err instanceof Error ? err.message : String(err));
        } finally {
            setNotificationPending(false);
        }
    }, [apiClient, notifications, session]);

    const handleDisableNotifications = useCallback(async () => {
        if (!apiClient || !session) return;

        setNotificationError(null);
        setNotificationPending(true);
        try {
            const updated = await apiClient.disableSessionNotifications(session.name);
            notifications.syncSessionNotifications(session.name, false, session.status ?? null);
            setSession((prev) =>
                prev ? { ...prev, notificationsEnabled: updated.notificationsEnabled ?? false } : prev
            );
        } catch (err) {
            setNotificationError(err instanceof Error ? err.message : String(err));
        } finally {
            setNotificationPending(false);
        }
    }, [apiClient, notifications, session]);

    const isLoading = connectionLoading || dataLoading;
    const error = connectionError ?? dataError;

    function formatTimestamp(ts: string | undefined): string {
        if (!ts) return '';
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return ts;
        return d.toLocaleString();
    }

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    {showBreadcrumb && (
                        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
                            <Link to="/" className={styles.breadcrumbLink}>
                                Projects
                            </Link>
                            <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
                            <Link to={`/project/${projectId}`} className={styles.breadcrumbLink}>
                                {daemonInfo?.projectName ?? projectId}
                            </Link>
                            <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
                            <span>{sessionName}</span>
                        </nav>
                    )}

                    <div className={styles.titleRow}>
                        <h1 className={styles.title}>{sessionName}</h1>
                        {session && <StatusBadge status={session.status?.status ?? 'idle'} />}
                    </div>
                </div>

                <div className={styles.headerActions}>
                    {session && (
                        <button
                            type="button"
                            className={`${styles.secondaryButton} ${
                                session.notificationsEnabled ? styles.notificationButtonActive : ''
                            }`}
                            onClick={() =>
                                void (session.notificationsEnabled
                                    ? handleDisableNotifications()
                                    : handleEnableNotifications())
                            }
                            disabled={notificationPending}
                            aria-label={
                                session.notificationsEnabled
                                    ? `Disable notifications for session ${session.name}`
                                    : `Enable notifications for session ${session.name}`
                            }
                        >
                            {session.notificationsEnabled
                                ? '\u{1F514} Notifications on'
                                : '\u{1F515} Notifications off'}
                        </button>
                    )}
                    <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => void load()}
                        aria-label="Refresh session info"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {isLoading && !session && (
                <div className={styles.loadingContainer} role="status" aria-label="Loading session">
                    <div className={styles.spinner} aria-hidden="true" />
                    <span>Loading session&hellip;</span>
                </div>
            )}

            {!isLoading && error && (
                <div className={styles.errorBanner} role="alert">
                    <div className={styles.errorTitle}>Failed to load session</div>
                    <div className={styles.errorMessage}>{error.message}</div>
                </div>
            )}

            {notificationError && (
                <div className={styles.errorBanner} role="alert">
                    <div className={styles.errorTitle}>Failed to update notifications</div>
                    <div className={styles.errorMessage}>{notificationError}</div>
                </div>
            )}

            {!isLoading && !error && !session && (
                <div className={styles.errorBanner} role="status">
                    <div className={styles.errorTitle}>Session not found</div>
                    <div className={styles.errorMessage}>
                        No session named &ldquo;{sessionName}&rdquo; exists on this daemon.
                    </div>
                </div>
            )}

            {session && (
                <div className={styles.grid}>
                    <div className={styles.card}>
                        <h2 className={styles.cardTitle}>Status</h2>
                        <div className={styles.cardContent}>
                            <div className={styles.fieldRow}>
                                <span className={styles.fieldLabel}>State</span>
                                <StatusBadge status={session.status?.status ?? 'idle'} />
                            </div>

                            {session.status?.message && (
                                <div className={styles.fieldRow}>
                                    <span className={styles.fieldLabel}>Message</span>
                                    <span className={styles.statusMessage}>{session.status.message}</span>
                                </div>
                            )}

                            {session.status?.timestamp && (
                                <div className={styles.fieldRow}>
                                    <span className={styles.fieldLabel}>Last updated</span>
                                    <span className={styles.timestamp}>
                                        {formatTimestamp(session.status.timestamp)}
                                    </span>
                                </div>
                            )}

                            <div className={styles.fieldRow}>
                                <span className={styles.fieldLabel}>Agent</span>
                                <span className={styles.fieldValue}>
                                    {session.data?.agentName ?? 'claude'}
                                </span>
                            </div>

                            <div className={styles.fieldRow}>
                                <span className={styles.fieldLabel}>Notifications</span>
                                <span className={styles.fieldValue}>
                                    {session.notificationsEnabled ? 'Enabled' : 'Disabled'}
                                </span>
                            </div>

                            {session.isPinned && (
                                <div className={styles.fieldRow}>
                                    <span className={styles.fieldLabel}>Pinned</span>
                                    <span className={styles.fieldValue}>Yes</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className={styles.card}>
                        <h2 className={styles.cardTitle}>Worktree</h2>
                        <div className={styles.cardContent}>
                            <div className={styles.fieldRow}>
                                <span className={styles.fieldLabel}>Branch</span>
                                <span className={styles.fieldValueMono}>
                                    {worktree?.branch ?? session.branch ?? '—'}
                                </span>
                            </div>

                            <div className={styles.fieldRow}>
                                <span className={styles.fieldLabel}>Path</span>
                                <span className={styles.fieldValueMono}>
                                    {worktree?.path ?? session.worktreePath}
                                </span>
                            </div>

                            {worktree?.commit && (
                                <div className={styles.fieldRow}>
                                    <span className={styles.fieldLabel}>Commit</span>
                                    <span className={styles.fieldValueMono}>
                                        {worktree.commit.slice(0, 8)}
                                    </span>
                                </div>
                            )}

                            {worktree !== null && (
                                <div className={styles.fieldRow}>
                                    <span className={styles.fieldLabel}>Working tree</span>
                                    {worktree.isClean !== undefined ? (
                                        <span
                                            className={`${styles.cleanBadge} ${
                                                worktree.isClean
                                                    ? styles.cleanBadgeClean
                                                    : styles.cleanBadgeDirty
                                            }`}
                                        >
                                            {worktree.isClean ? 'Clean' : 'Dirty'}
                                        </span>
                                    ) : (
                                        <span className={styles.fieldValue}>Unknown</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className={styles.card}>
                        <h2 className={styles.cardTitle}>Workflow</h2>
                        <div className={styles.cardContent}>
                            {!session.workflowStatus?.active ? (
                                <span className={styles.inactiveWorkflow}>No active workflow</span>
                            ) : (
                                <>
                                    {session.workflowStatus.workflow && (
                                        <div className={styles.fieldRow}>
                                            <span className={styles.fieldLabel}>Workflow</span>
                                            <span className={styles.fieldValue}>
                                                {session.workflowStatus.workflow}
                                            </span>
                                        </div>
                                    )}

                                    {session.workflowStatus.progress && (
                                        <div className={styles.fieldRow}>
                                            <span className={styles.fieldLabel}>Progress</span>
                                            <span className={styles.progressText}>
                                                {session.workflowStatus.progress}
                                            </span>
                                        </div>
                                    )}

                                    {session.workflowStatus.summary && (
                                        <div className={styles.fieldRow}>
                                            <span className={styles.fieldLabel}>Summary</span>
                                            <span className={styles.fieldValue}>
                                                {session.workflowStatus.summary}
                                            </span>
                                        </div>
                                    )}

                                    {workflow && (
                                        <div className={styles.fieldRow}>
                                            <span className={styles.fieldLabel}>Steps</span>
                                            <StepProgressTracker
                                                steps={
                                                    workflowSteps.length > 0
                                                        ? workflowSteps
                                                        : buildFallbackSteps(workflow)
                                                }
                                                currentStep={workflow.currentStep}
                                                completedSteps={workflow.completedSteps ?? []}
                                            />
                                        </div>
                                    )}

                                    {workflow?.tasks && workflow.tasks.length > 0 && (
                                        <div className={styles.fieldRow}>
                                            <WorkflowTaskList tasks={workflow.tasks} title="Tasks" />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {session && (
                <div className={styles.tabSection}>
                    <div className={styles.tabBar} role="tablist">
                        <button
                            type="button"
                            role="tab"
                            id="tab-terminal"
                            aria-selected={activeTab === 'terminal'}
                            aria-controls="tabpanel-terminal"
                            className={`${styles.tabButton} ${
                                activeTab === 'terminal' ? styles.tabButtonActive : ''
                            }`}
                            onClick={() => setActiveTab('terminal')}
                        >
                            Terminal
                        </button>
                        <button
                            type="button"
                            role="tab"
                            id="tab-changes"
                            aria-selected={activeTab === 'changes'}
                            aria-controls="tabpanel-changes"
                            className={`${styles.tabButton} ${
                                activeTab === 'changes' ? styles.tabButtonActive : ''
                            }`}
                            onClick={() => setActiveTab('changes')}
                        >
                            Changes
                            {diffFiles.length > 0 && (
                                <span aria-label={`${diffFiles.length} changed files`}>
                                    {' '}({diffFiles.length})
                                </span>
                            )}
                        </button>
                        <button
                            type="button"
                            role="tab"
                            id="tab-insights"
                            aria-selected={activeTab === 'insights'}
                            aria-controls="tabpanel-insights"
                            className={`${styles.tabButton} ${
                                activeTab === 'insights' ? styles.tabButtonActive : ''
                            }`}
                            onClick={() => setActiveTab('insights')}
                        >
                            Insights
                        </button>
                    </div>

                    {activeTab === 'changes' && (
                        <div
                            role="tabpanel"
                            id="tabpanel-changes"
                            aria-labelledby="tab-changes"
                            className={styles.changesLayout}
                        >
                            <aside className={styles.changesSidebar} aria-label="Changed files">
                                <h3 className={styles.changesSidebarTitle}>Files</h3>
                                <div className={styles.toggleRow}>
                                    <label className={styles.toggleLabel}>
                                        <input
                                            type="checkbox"
                                            className={styles.toggleCheckbox}
                                            checked={includeUncommitted}
                                            onChange={(e) => setIncludeUncommitted(e.target.checked)}
                                        />
                                        Include uncommitted
                                    </label>
                                </div>
                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        const trimmed = branchInputValue.trim();
                                        setBaseBranch(trimmed);
                                        (e.target as HTMLFormElement).querySelector('input')?.blur();
                                    }}
                                >
                                    <input
                                        type="text"
                                        className={styles.branchInput}
                                        placeholder="main (auto)"
                                        aria-label="Compare against branch"
                                        value={branchInputValue}
                                        onChange={(e) => setBranchInputValue(e.target.value)}
                                        onBlur={() => {
                                            const trimmed = branchInputValue.trim();
                                            if (trimmed !== baseBranch) {
                                                setBaseBranch(trimmed);
                                            }
                                        }}
                                    />
                                    {resolvedBaseBranch && (
                                        <div className={styles.branchInputHint}>
                                            Comparing against: {resolvedBaseBranch}
                                        </div>
                                    )}
                                </form>
                                <FileList files={diffFiles} onFileClick={handleFileClick} />
                            </aside>

                            <div className={styles.changesMain} ref={diffSectionRef}>
                                {comments.length > 0 && (
                                    <div className={styles.reviewBar}>
                                        <span className={styles.commentCount}>
                                            {comments.length}{' '}
                                            {comments.length === 1 ? 'comment' : 'comments'}
                                        </span>
                                        <button
                                            type="button"
                                            className={styles.primaryButton}
                                            onClick={() => void handleSubmitReview()}
                                        >
                                            Copy Review to Clipboard
                                        </button>
                                    </div>
                                )}

                                {diffLoading && (
                                    <div className={styles.diffLoading} role="status">
                                        <div className={styles.spinner} aria-hidden="true" />
                                        <span>Loading diff&hellip;</span>
                                    </div>
                                )}
                                {diffError && !diffLoading && (
                                    <div className={styles.diffError} role="alert">
                                        Failed to load diff: {diffError.message}
                                        <button
                                            type="button"
                                            className={`${styles.secondaryButton} ${styles.retryButton}`}
                                            onClick={() => refreshDiff()}
                                        >
                                            Retry
                                        </button>
                                    </div>
                                )}
                                {!diffLoading && !diffError && (
                                    <DiffViewer
                                        diff={diff}
                                        comments={comments}
                                        onAddComment={handleAddComment}
                                        onDeleteComment={handleDeleteComment}
                                        onEditComment={handleEditComment}
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'insights' && (
                        <div role="tabpanel" id="tabpanel-insights" aria-labelledby="tab-insights">
                            <InsightsPanel
                                insights={insights}
                                analysis={analysis}
                                loading={insightsLoading}
                                error={insightsError}
                                onGenerate={refreshInsights}
                            />
                        </div>
                    )}

                    {activeTab === 'terminal' && (
                        <div role="tabpanel" id="tabpanel-terminal" aria-labelledby="tab-terminal">
                            <TerminalView
                                apiClient={apiClient}
                                terminalName={session.data?.tmuxSessionName ?? sessionName}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
