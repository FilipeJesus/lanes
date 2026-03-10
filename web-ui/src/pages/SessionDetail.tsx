/**
 * Session Detail page — shows detailed information for a single session.
 * The :projectId and :name URL params identify the project and session.
 *
 * Shows:
 * - Status badge with optional message and timestamp
 * - Worktree info (path, branch, commit, clean state)
 * - Workflow state summary (current step, completed steps, progress)
 * - Agent and session metadata
 * - Changes tab: file list + unified diff viewer with uncommitted toggle
 * - Insights tab: insights and analysis panel
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDaemonConnection } from '../hooks/useDaemonConnection';
import { useDiff } from '../hooks/useDiff';
import { useInsights } from '../hooks/useInsights';
import { StatusBadge } from '../components/StatusBadge';
import { DiffViewer } from '../components/DiffViewer';
import { FileList } from '../components/FileList';
import { InsightsPanel } from '../components/InsightsPanel';
import { StepProgressTracker } from '../components/StepProgressTracker';
import { WorkflowTaskList } from '../components/WorkflowTaskList';
import { formatReviewForClipboard } from '../utils/reviewFormat';
import type { ReviewComment } from '../utils/reviewFormat';
import { TerminalView } from '../components/TerminalView';
import type { SseCallbacks } from '../api/sse';
import type { AgentSessionStatus, SessionInfo, WorktreeInfo, WorkflowState, WorkflowStep } from '../api/types';
import styles from '../styles/SessionDetail.module.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Converts a file path into a CSS-safe anchor ID. */
function filePathToId(filePath: string): string {
    return 'diff-file-' + filePath.replace(/[^a-zA-Z0-9-_]/g, '-');
}

/**
 * When we don't have the full workflow template (with step types), build a
 * minimal WorkflowStep list from the WorkflowState completed + current steps.
 */
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

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type ActiveTab = 'changes' | 'insights' | 'terminal';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionDetail() {
    const { projectId, name } = useParams<{ projectId: string; name: string }>();

    const { apiClient, sseClient, daemonInfo, loading: connectionLoading, error: connectionError } =
        useDaemonConnection(projectId);

    const [session, setSession] = useState<SessionInfo | null>(null);
    const [worktree, setWorktree] = useState<WorktreeInfo | null>(null);
    const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
    const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
    const [dataLoading, setDataLoading] = useState(false);
    const [dataError, setDataError] = useState<Error | null>(null);

    // Tab state
    const [activeTab, setActiveTab] = useState<ActiveTab>('changes');

    // Uncommitted toggle for diff
    const [includeUncommitted, setIncludeUncommitted] = useState(false);

    // Branch selector for diff — empty string means auto-detect
    const [baseBranch, setBaseBranch] = useState('');
    // Input field value (separate from committed baseBranch state)
    const [branchInputValue, setBranchInputValue] = useState('');

    // Ref for scrolling to a specific file in the diff
    const diffSectionRef = useRef<HTMLDivElement>(null);

    // ---------------------------------------------------------------------------
    // Review / inline comments state
    // ---------------------------------------------------------------------------

    const [comments, setComments] = useState<ReviewComment[]>([]);

    const decodedName = name ? decodeURIComponent(name) : '';

    // ---------------------------------------------------------------------------
    // Diff and insights hooks
    // ---------------------------------------------------------------------------

    const {
        files: diffFiles,
        diff,
        loading: diffLoading,
        error: diffError,
        refresh: refreshDiff,
        resolvedBaseBranch,
    } = useDiff(apiClient, decodedName || undefined, includeUncommitted, baseBranch);

    const {
        insights,
        analysis,
        loading: insightsLoading,
        error: insightsError,
        refresh: refreshInsights,
    } = useInsights(apiClient, decodedName || undefined);

    // ---------------------------------------------------------------------------
    // Session data load
    // ---------------------------------------------------------------------------

    const load = useCallback(async () => {
        if (!apiClient || !decodedName) return;

        setDataLoading(true);
        setDataError(null);

        try {
            const [sessionsRes, worktreeRes, workflowRes] = await Promise.allSettled([
                apiClient.listSessions(),
                apiClient.getSessionWorktree(decodedName),
                apiClient.getSessionWorkflow(decodedName),
            ]);

            if (sessionsRes.status === 'fulfilled') {
                const found = sessionsRes.value.sessions.find((s) => s.name === decodedName);
                setSession(found ?? null);
            }

            if (worktreeRes.status === 'fulfilled') {
                setWorktree(worktreeRes.value);
            }

            if (workflowRes.status === 'fulfilled') {
                const wfState = workflowRes.value;
                setWorkflow(wfState);

                // If a workflow is active, try to fetch its step definitions
                if (wfState.workflowName) {
                    try {
                        const wfListRes = await apiClient.listWorkflows();
                        const match = wfListRes.workflows.find(
                            (w) => w.name === wfState.workflowName
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
    }, [apiClient, decodedName]);

    useEffect(() => {
        void load();
    }, [load]);

    // ---------------------------------------------------------------------------
    // SSE subscription for real-time status updates
    // ---------------------------------------------------------------------------

    useEffect(() => {
        if (!sseClient || !name) return;

        const callbacks: SseCallbacks = {
            onSessionStatusChanged: ({ sessionName, status }) => {
                if (sessionName === decodedName) {
                    setSession((prev) =>
                        prev ? { ...prev, status: status as AgentSessionStatus } : prev
                    );
                }
            },
            onSessionDeleted: ({ sessionName }) => {
                if (sessionName === decodedName) {
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
            unsubscribe?.();
            sseClient.disconnect();
        };
    }, [sseClient, name, decodedName]);

    // ---------------------------------------------------------------------------
    // File click handler — scroll to file diff section
    // ---------------------------------------------------------------------------

    const handleFileClick = useCallback((filePath: string) => {
        if (!diffSectionRef.current) return;

        const id = filePathToId(filePath);
        const el = diffSectionRef.current.querySelector(`[id="${CSS.escape(id)}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    // ---------------------------------------------------------------------------
    // Review handlers
    // ---------------------------------------------------------------------------

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
        setComments((prev) => prev.filter((c) => c.id !== commentId));
    }, []);

    const handleEditComment = useCallback((commentId: string, newText: string) => {
        setComments((prev) =>
            prev.map((c) => (c.id === commentId ? { ...c, text: newText } : c)),
        );
    }, []);

    const handleSubmitReview = useCallback(async () => {
        const formatted = formatReviewForClipboard(comments);
        await navigator.clipboard.writeText(formatted);
    }, [comments]);

    // ---------------------------------------------------------------------------
    // Render helpers
    // ---------------------------------------------------------------------------

    const isLoading = connectionLoading || dataLoading;
    const error = connectionError ?? dataError;

    function formatTimestamp(ts: string | undefined): string {
        if (!ts) return '';
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return ts;
        return d.toLocaleString();
    }

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

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
                        <Link to={`/project/${projectId}`} className={styles.breadcrumbLink}>
                            {daemonInfo?.projectName ?? projectId}
                        </Link>
                        <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
                        <span>{decodedName}</span>
                    </nav>

                    <div className={styles.titleRow}>
                        <h1 className={styles.title}>{decodedName}</h1>
                        {session && (
                            <StatusBadge status={session.status?.status ?? 'idle'} />
                        )}
                    </div>
                </div>

                <div className={styles.headerActions}>
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

            {/* Loading */}
            {isLoading && !session && (
                <div className={styles.loadingContainer} role="status" aria-label="Loading session">
                    <div className={styles.spinner} aria-hidden="true" />
                    <span>Loading session&hellip;</span>
                </div>
            )}

            {/* Error */}
            {!isLoading && error && (
                <div className={styles.errorBanner} role="alert">
                    <div className={styles.errorTitle}>Failed to load session</div>
                    <div className={styles.errorMessage}>{error.message}</div>
                </div>
            )}

            {/* Session not found */}
            {!isLoading && !error && !session && (
                <div className={styles.errorBanner} role="status">
                    <div className={styles.errorTitle}>Session not found</div>
                    <div className={styles.errorMessage}>
                        No session named &ldquo;{decodedName}&rdquo; exists on this daemon.
                    </div>
                </div>
            )}

            {/* Content grid */}
            {session && (
                <div className={styles.grid}>
                    {/* Status card */}
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
                                    <span className={styles.statusMessage}>
                                        {session.status.message}
                                    </span>
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

                            {session.isPinned && (
                                <div className={styles.fieldRow}>
                                    <span className={styles.fieldLabel}>Pinned</span>
                                    <span className={styles.fieldValue}>Yes</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Worktree card */}
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

                    {/* Workflow card */}
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

                                    {/* Step progress tracker — uses step definitions if available,
                                        falls back to completed/current from WorkflowState */}
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

                                    {/* Task list for loop/ralph steps */}
                                    {workflow?.tasks && workflow.tasks.length > 0 && (
                                        <div className={styles.fieldRow}>
                                            <WorkflowTaskList
                                                tasks={workflow.tasks}
                                                title="Tasks"
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Tab section — Changes and Insights */}
            {session && (
                <div className={styles.tabSection}>
                    {/* Tab bar */}
                    <div className={styles.tabBar} role="tablist">
                        <button
                            type="button"
                            role="tab"
                            id="tab-changes"
                            aria-selected={activeTab === 'changes'}
                            aria-controls="tabpanel-changes"
                            className={`${styles.tabButton} ${activeTab === 'changes' ? styles.tabButtonActive : ''}`}
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
                            className={`${styles.tabButton} ${activeTab === 'insights' ? styles.tabButtonActive : ''}`}
                            onClick={() => setActiveTab('insights')}
                        >
                            Insights
                        </button>
                        <button
                            type="button"
                            role="tab"
                            id="tab-terminal"
                            aria-selected={activeTab === 'terminal'}
                            aria-controls="tabpanel-terminal"
                            className={`${styles.tabButton} ${activeTab === 'terminal' ? styles.tabButtonActive : ''}`}
                            onClick={() => setActiveTab('terminal')}
                        >
                            Terminal
                        </button>
                    </div>

                    {/* Changes tab */}
                    {activeTab === 'changes' && (
                        <div role="tabpanel" id="tabpanel-changes" aria-labelledby="tab-changes" className={styles.changesLayout}>
                            {/* Sidebar: file list + toggle */}
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
                                <FileList
                                    files={diffFiles}
                                    onFileClick={handleFileClick}
                                />
                            </aside>

                            {/* Main: diff viewer */}
                            <div className={styles.changesMain} ref={diffSectionRef}>
                                {/* Review bar — only shown when comments exist */}
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

                    {/* Insights tab */}
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

                    {/* Terminal tab */}
                    {activeTab === 'terminal' && (
                        <div role="tabpanel" id="tabpanel-terminal" aria-labelledby="tab-terminal">
                            <TerminalView
                                apiClient={apiClient}
                                terminalName={session.data?.tmuxSessionName ?? decodedName}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
