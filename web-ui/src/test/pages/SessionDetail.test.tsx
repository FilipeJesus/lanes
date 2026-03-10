import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionDetail } from '../../pages/SessionDetail';
import type { DaemonApiClient } from '../../api/client';
import type { SessionInfo, WorktreeInfo, WorkflowState } from '../../api/types';

// Stub out navigator.clipboard for tests that exercise "Copy Review to Clipboard"
Object.assign(navigator, {
    clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
    },
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseDaemonConnection = vi.fn();
vi.mock('../../hooks/useDaemonConnection', () => ({
    useDaemonConnection: () => mockUseDaemonConnection(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
    return {
        name: 'my-session',
        worktreePath: '/projects/app/.worktrees/my-session',
        branch: 'feat/my-session',
        data: { sessionId: 'my-session', agentName: 'claude' },
        status: { status: 'working' },
        workflowStatus: { active: false },
        isPinned: false,
        ...overrides,
    };
}

function makeWorktreeInfo(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
    return {
        path: '/projects/app/.worktrees/my-session',
        branch: 'feat/my-session',
        commit: 'abc1234567890',
        isClean: true,
        ...overrides,
    };
}

function makeWorkflowState(overrides: Partial<WorkflowState> = {}): WorkflowState {
    return {
        workflowName: 'basic-feature',
        currentStep: 'implement',
        completedSteps: ['plan'],
        outputs: {},
        ...overrides,
    };
}

function makeApiClient(sessions: SessionInfo[], worktree: WorktreeInfo, workflow: WorkflowState): DaemonApiClient {
    return {
        listSessions: vi.fn().mockResolvedValue({ sessions }),
        getSessionWorktree: vi.fn().mockResolvedValue(worktree),
        getSessionWorkflow: vi.fn().mockResolvedValue(workflow),
        getSessionDiffFiles: vi.fn().mockResolvedValue({ files: [], sessionName: 'my-session' }),
        getSessionDiff: vi.fn().mockResolvedValue({ diff: '', sessionName: 'my-session' }),
        getSessionInsights: vi.fn().mockResolvedValue({ insights: '', analysis: undefined, sessionName: 'my-session' }),
        streamTerminalOutput: vi.fn().mockReturnValue({ close: vi.fn() }),
        sendToTerminal: vi.fn().mockResolvedValue(undefined),
        resizeTerminal: vi.fn().mockResolvedValue(undefined),
    } as unknown as DaemonApiClient;
}

function renderSessionDetail(projectId: string = 'project-123', sessionName: string = 'my-session') {
    return render(
        <MemoryRouter initialEntries={[`/project/${projectId}/session/${encodeURIComponent(sessionName)}`]}>
            <Routes>
                <Route path="/project/:projectId/session/:name" element={<SessionDetail />} />
            </Routes>
        </MemoryRouter>
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionDetail', () => {
    beforeEach(() => {
        mockUseDaemonConnection.mockClear();
    });

    it('Given project id and name params, then session status badge is rendered', async () => {
        const session = makeSession({ name: 'my-session', status: { status: 'working' } });
        const apiClient = makeApiClient([session], makeWorktreeInfo(), makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            daemonInfo: { projectName: 'payments-service' },
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        await waitFor(() => {
            // StatusBadge renders in header + content, so use getAllByLabelText
            const badges = screen.getAllByLabelText(/status: working/i);
            expect(badges.length).toBeGreaterThan(0);
        });
    });

    it('Given daemon info with projectName, then breadcrumb shows the project name instead of raw project id text', async () => {
        const session = makeSession({ name: 'my-session' });
        const apiClient = makeApiClient([session], makeWorktreeInfo(), makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            daemonInfo: { projectName: 'payments-service' },
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        await waitFor(() => {
            expect(screen.getByRole('link', { name: 'payments-service' })).toBeInTheDocument();
        });
    });

    it('Given worktree info available, then worktree path and branch are shown', async () => {
        const session = makeSession({ name: 'my-session' });
        const worktree = makeWorktreeInfo({
            path: '/projects/app/.worktrees/my-session',
            branch: 'feat/my-session',
        });
        const apiClient = makeApiClient([session], worktree, makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        await waitFor(() => {
            expect(screen.getByText('/projects/app/.worktrees/my-session')).toBeInTheDocument();
            expect(screen.getByText('feat/my-session')).toBeInTheDocument();
        });
    });

    it('Given workflow state available, then workflow name and current step are shown', async () => {
        const session = makeSession({
            name: 'my-session',
            workflowStatus: { active: true, workflow: 'basic-feature', step: 'implement' },
        });
        const workflow = makeWorkflowState({
            workflowName: 'basic-feature',
            currentStep: 'implement',
            completedSteps: ['plan'],
        });
        const apiClient = makeApiClient([session], makeWorktreeInfo(), workflow);

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        await waitFor(() => {
            expect(screen.getByText('basic-feature')).toBeInTheDocument();
            expect(screen.getAllByText('implement').length).toBeGreaterThan(0);
        });
    });

    it('Given a session is loaded, when the page renders, then Changes and Insights tab buttons are visible', async () => {
        const session = makeSession({ name: 'my-session' });
        const apiClient = makeApiClient([session], makeWorktreeInfo(), makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /changes/i })).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: /insights/i })).toBeInTheDocument();
        });
    });

    it('Given Changes tab is active (default), then the file list sidebar is visible', async () => {
        const session = makeSession({ name: 'my-session' });
        const apiClient = makeApiClient([session], makeWorktreeInfo(), makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /changes/i })).toHaveAttribute('aria-selected', 'true');
            // The changed files sidebar heading
            expect(screen.getByText('Files')).toBeInTheDocument();
        });
    });

    it('Given Changes tab is active, then Include uncommitted toggle checkbox is visible', async () => {
        const session = makeSession({ name: 'my-session' });
        const apiClient = makeApiClient([session], makeWorktreeInfo(), makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        await waitFor(() => {
            expect(screen.getByLabelText(/include uncommitted/i)).toBeInTheDocument();
        });
    });

    it('Given Insights tab is clicked, then the insights panel is shown', async () => {
        const session = makeSession({ name: 'my-session' });
        const apiClient = makeApiClient([session], makeWorktreeInfo(), makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /insights/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('tab', { name: /insights/i }));

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /insights/i })).toHaveAttribute('aria-selected', 'true');
            // InsightsPanel shows the Refresh Insights button
            expect(screen.getByRole('button', { name: /refresh insights/i })).toBeInTheDocument();
        });
    });

    it('Given the Include uncommitted checkbox is toggled, then getSessionDiff is called again', async () => {
        const session = makeSession({ name: 'my-session' });
        const apiClient = makeApiClient([session], makeWorktreeInfo(), makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        await waitFor(() => {
            expect(screen.getByLabelText(/include uncommitted/i)).toBeInTheDocument();
        });

        const prevCallCount = vi.mocked(apiClient.getSessionDiff).mock.calls.length;

        fireEvent.click(screen.getByLabelText(/include uncommitted/i));

        await waitFor(() => {
            expect(vi.mocked(apiClient.getSessionDiff).mock.calls.length).toBeGreaterThan(prevCallCount);
        });

        // The last call should pass includeUncommitted=true
        const lastCall = vi.mocked(apiClient.getSessionDiff).mock.calls.at(-1);
        expect(lastCall?.[1]).toBe(true);
    });

    // -------------------------------------------------------------------------
    // SessionDetail-terminal-tab: Terminal tab button is present
    // -------------------------------------------------------------------------

    it('Given a session is loaded, when the tab bar renders, then a Terminal tab button is present', async () => {
        const session = makeSession({ name: 'my-session' });
        const apiClient = makeApiClient([session], makeWorktreeInfo(), makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /terminal/i })).toBeInTheDocument();
        });
    });

    // -------------------------------------------------------------------------
    // SessionDetail-terminal-tab-content: TerminalView shown when Terminal tab clicked
    // -------------------------------------------------------------------------

    it('Given a session is loaded and the Terminal tab is clicked, when the tab panel renders, then the TerminalView component is shown', async () => {
        const session = makeSession({ name: 'my-session' });
        const apiClient = makeApiClient([session], makeWorktreeInfo(), makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /terminal/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('tab', { name: /terminal/i }));

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /terminal/i })).toHaveAttribute('aria-selected', 'true');
            // TerminalView renders an aria-label="Terminal output" on its output div
            expect(screen.getByLabelText(/terminal output/i)).toBeInTheDocument();
        });
    });
});

// ---------------------------------------------------------------------------
// Review feature tests
// ---------------------------------------------------------------------------

const SIMPLE_DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 export { x, y };`;

function makeApiClientWithDiff(sessions: SessionInfo[], worktree: WorktreeInfo, workflow: WorkflowState): DaemonApiClient {
    return {
        listSessions: vi.fn().mockResolvedValue({ sessions }),
        getSessionWorktree: vi.fn().mockResolvedValue(worktree),
        getSessionWorkflow: vi.fn().mockResolvedValue(workflow),
        getSessionDiffFiles: vi.fn().mockResolvedValue({ files: ['src/a.ts'], sessionName: 'my-session' }),
        getSessionDiff: vi.fn().mockResolvedValue({ diff: SIMPLE_DIFF, sessionName: 'my-session' }),
        getSessionInsights: vi.fn().mockResolvedValue({ insights: '', analysis: undefined, sessionName: 'my-session' }),
    } as unknown as DaemonApiClient;
}

describe('SessionDetail — review', () => {
    beforeEach(() => {
        mockUseDaemonConnection.mockClear();
    });

    it('Given a session is loaded with no comments, then the Copy Review to Clipboard button is not visible', async () => {
        const session = makeSession({ name: 'my-session' });
        const apiClient = makeApiClient([session], makeWorktreeInfo(), makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: /changes/i })).toBeInTheDocument();
        });

        expect(
            screen.queryByRole('button', { name: /copy review to clipboard/i }),
        ).not.toBeInTheDocument();
    });

    it('Given a diff is loaded, when a comment is added via the DiffViewer, then the review bar appears', async () => {
        const session = makeSession({ name: 'my-session' });
        const apiClient = makeApiClientWithDiff([session], makeWorktreeInfo(), makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            loading: false,
            error: null,
        });

        renderSessionDetail('project-123', 'my-session');

        // Wait for the diff to render (add-comment buttons appear)
        await waitFor(() => {
            const addBtns = screen.queryAllByRole('button', { name: /add comment/i });
            expect(addBtns.length).toBeGreaterThan(0);
        });

        // Open the comment form on the first line
        const [firstAddBtn] = screen.getAllByRole('button', { name: /add comment/i });
        fireEvent.click(firstAddBtn);

        const textarea = await screen.findByPlaceholderText('Write a review comment...');
        fireEvent.change(textarea, { target: { value: 'Great change!' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

        // The review bar should now show the comment count and copy button
        await waitFor(() => {
            expect(
                screen.getByRole('button', { name: /copy review to clipboard/i }),
            ).toBeInTheDocument();
            expect(screen.getByText(/1 comment/i)).toBeInTheDocument();
        });
    });
});
