import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionDetail } from '../../pages/SessionDetail';
import type { DaemonApiClient } from '../../api/client';
import type { SessionInfo, WorktreeInfo, WorkflowState } from '../../api/types';

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
    } as unknown as DaemonApiClient;
}

function renderSessionDetail(port: string = '3942', sessionName: string = 'my-session') {
    return render(
        <MemoryRouter initialEntries={[`/project/${port}/session/${encodeURIComponent(sessionName)}`]}>
            <Routes>
                <Route path="/project/:port/session/:name" element={<SessionDetail />} />
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

    it('Given port and name params, then session status badge is rendered', async () => {
        const session = makeSession({ name: 'my-session', status: { status: 'working' } });
        const apiClient = makeApiClient([session], makeWorktreeInfo(), makeWorkflowState());

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            loading: false,
            error: null,
        });

        renderSessionDetail('3942', 'my-session');

        await waitFor(() => {
            // StatusBadge renders in header + content, so use getAllByLabelText
            const badges = screen.getAllByLabelText(/status: working/i);
            expect(badges.length).toBeGreaterThan(0);
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

        renderSessionDetail('3942', 'my-session');

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

        renderSessionDetail('3942', 'my-session');

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

        renderSessionDetail('3942', 'my-session');

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

        renderSessionDetail('3942', 'my-session');

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

        renderSessionDetail('3942', 'my-session');

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

        renderSessionDetail('3942', 'my-session');

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

        renderSessionDetail('3942', 'my-session');

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
});
