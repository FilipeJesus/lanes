import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProjectDetail } from '../../pages/ProjectDetail';
import type { SessionInfo } from '../../api/types';
import type { DaemonApiClient } from '../../api/client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

const mockUseDaemonConnection = vi.fn();
vi.mock('../../hooks/useDaemonConnection', () => ({
    useDaemonConnection: () => mockUseDaemonConnection(),
}));

const mockUseSessions = vi.fn();
vi.mock('../../hooks/useSessions', () => ({
    useSessions: () => mockUseSessions(),
}));

const mockSessionDetailPanel = vi.fn();
vi.mock('../../components/SessionDetailPanel', () => ({
    SessionDetailPanel: (props: { sessionName: string; subscribeToSse?: boolean }) => {
        mockSessionDetailPanel(props);
        return <div>Selected session: {props.sessionName}</div>;
    },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
    return {
        name: 'test-session',
        worktreePath: '/projects/app/.worktrees/test-session',
        branch: 'feat/test',
        data: { sessionId: 'test-session', agentName: 'claude' },
        status: { status: 'idle' },
        workflowStatus: { active: false },
        isPinned: false,
        ...overrides,
    };
}

function makeApiClient(): DaemonApiClient {
    return {
        listAgents: vi.fn().mockResolvedValue({ agents: [] }),
        listWorkflows: vi.fn().mockResolvedValue({ workflows: [] }),
        getGitBranches: vi.fn().mockResolvedValue({ branches: [] }),
    } as unknown as DaemonApiClient;
}

function setupDefaultMocks(sessions: SessionInfo[] = []) {
    const apiClient = makeApiClient();

    mockUseDaemonConnection.mockReturnValue({
        apiClient,
        sseClient: null,
        daemonInfo: { projectName: 'my-app', workspaceRoot: '/projects/my-app', registeredAt: new Date().toISOString() },
        loading: false,
        error: null,
        projectState: 'connected',
        refresh: vi.fn(),
    });

    mockUseSessions.mockReturnValue({
        sessions,
        loading: false,
        error: null,
        refresh: vi.fn(),
        createSession: vi.fn(),
        improveSessionPrompt: vi.fn(),
        uploadSessionAttachments: vi.fn(),
        deleteSession: vi.fn(),
        pinSession: vi.fn(),
        unpinSession: vi.fn(),
        enableSessionNotifications: vi.fn(),
        disableSessionNotifications: vi.fn(),
    });

    return { apiClient };
}

function renderProjectDetail(
    projectId: string = 'project-123',
    initialEntry: string = `/project/${projectId}`,
    routePath: string = '/project/:projectId',
) {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
                <Route path={routePath} element={<ProjectDetail />} />
            </Routes>
        </MemoryRouter>
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectDetail', () => {
    beforeEach(() => {
        mockNavigate.mockClear();
        mockUseDaemonConnection.mockClear();
        mockUseSessions.mockClear();
        mockSessionDetailPanel.mockClear();
    });

    it('Given a project id param and a daemon that returns sessions, then session navigation items are rendered', () => {
        const sessions = [
            makeSession({ name: 'session-1' }),
            makeSession({ name: 'session-2' }),
        ];
        setupDefaultMocks(sessions);

        renderProjectDetail('project-123');

        expect(screen.getByText('session-1')).toBeInTheDocument();
        expect(screen.getByText('session-2')).toBeInTheDocument();
    });

    it('Given a selected session route, then the workspace renders that session in the main pane', () => {
        const sessions = [
            makeSession({ name: 'session-1' }),
            makeSession({ name: 'session-2' }),
        ];
        setupDefaultMocks(sessions);

        renderProjectDetail(
            'project-123',
            '/project/project-123/session/session-2',
            '/project/:projectId/session/:name'
        );

        expect(screen.getByText('Selected session: session-2')).toBeInTheDocument();
        expect(mockSessionDetailPanel).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionName: 'session-2',
                subscribeToSse: false,
            })
        );
    });

    it('Given a deep-linked session route while the sidebar list is still loading, then the detail pane still mounts immediately', () => {
        const apiClient = makeApiClient();

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            sseClient: null,
            daemonInfo: { projectName: 'my-app', workspaceRoot: '/projects/my-app', registeredAt: new Date().toISOString() },
            loading: false,
            error: null,
            projectState: 'connected',
            refresh: vi.fn(),
        });

        mockUseSessions.mockReturnValue({
            sessions: [],
            loading: true,
            error: null,
            refresh: vi.fn(),
            createSession: vi.fn(),
            improveSessionPrompt: vi.fn(),
            uploadSessionAttachments: vi.fn(),
            deleteSession: vi.fn(),
            pinSession: vi.fn(),
            unpinSession: vi.fn(),
            enableSessionNotifications: vi.fn(),
            disableSessionNotifications: vi.fn(),
        });

        renderProjectDetail(
            'project-123',
            '/project/project-123/session/session-2',
            '/project/:projectId/session/:name'
        );

        expect(screen.getByText('Selected session: session-2')).toBeInTheDocument();
    });

    it('Given no sessions, then an empty state message is shown', () => {
        setupDefaultMocks([]);

        renderProjectDetail('project-123');

        expect(screen.getByText(/no sessions yet/i)).toBeInTheDocument();
    });

    it('Given a registered project without a running daemon, then onboarding guidance is shown instead of a hard error', () => {
        mockUseDaemonConnection.mockReturnValue({
            apiClient: null,
            sseClient: null,
            daemonInfo: {
                projectName: 'my-app',
                workspaceRoot: '/projects/my-app',
                registeredAt: new Date().toISOString(),
            },
            loading: false,
            error: null,
            projectState: 'offline',
            refresh: vi.fn(),
        });

        mockUseSessions.mockReturnValue({
            sessions: [],
            loading: false,
            error: null,
            refresh: vi.fn(),
            createSession: vi.fn(),
            improveSessionPrompt: vi.fn(),
            uploadSessionAttachments: vi.fn(),
            deleteSession: vi.fn(),
            pinSession: vi.fn(),
            unpinSession: vi.fn(),
            enableSessionNotifications: vi.fn(),
            disableSessionNotifications: vi.fn(),
        });

        renderProjectDetail('project-123');

        expect(screen.getByText(/daemon is offline/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /refresh connection/i })).toBeInTheDocument();
        expect(screen.queryByText(/failed to load sessions/i)).not.toBeInTheDocument();
    });

    it('Given the refresh action is used, then only the connection refresh runs immediately', async () => {
        const user = userEvent.setup();
        const refreshConnection = vi.fn();
        const refreshSessions = vi.fn();

        mockUseDaemonConnection.mockReturnValue({
            apiClient: makeApiClient(),
            sseClient: null,
            daemonInfo: {
                projectName: 'my-app',
                workspaceRoot: '/projects/my-app',
                registeredAt: new Date().toISOString(),
            },
            loading: false,
            error: null,
            projectState: 'connected',
            refresh: refreshConnection,
        });

        mockUseSessions.mockReturnValue({
            sessions: [],
            loading: false,
            error: null,
            refresh: refreshSessions,
            createSession: vi.fn(),
            improveSessionPrompt: vi.fn(),
            uploadSessionAttachments: vi.fn(),
            deleteSession: vi.fn(),
            pinSession: vi.fn(),
            unpinSession: vi.fn(),
            enableSessionNotifications: vi.fn(),
            disableSessionNotifications: vi.fn(),
        });

        renderProjectDetail('project-123');

        await user.click(screen.getByRole('button', { name: /refresh session list/i }));

        expect(refreshConnection).toHaveBeenCalledTimes(1);
        expect(refreshSessions).not.toHaveBeenCalled();
    });

    it('Given a stale project route without workspace information, then the recovery command remains actionable', () => {
        mockUseDaemonConnection.mockReturnValue({
            apiClient: null,
            sseClient: null,
            daemonInfo: null,
            loading: false,
            error: null,
            projectState: 'missing',
            refresh: vi.fn(),
        });

        mockUseSessions.mockReturnValue({
            sessions: [],
            loading: false,
            error: null,
            refresh: vi.fn(),
            createSession: vi.fn(),
            improveSessionPrompt: vi.fn(),
            uploadSessionAttachments: vi.fn(),
            deleteSession: vi.fn(),
            pinSession: vi.fn(),
            unpinSession: vi.fn(),
            enableSessionNotifications: vi.fn(),
            disableSessionNotifications: vi.fn(),
        });

        renderProjectDetail('project-123');

        expect(screen.getByText('lanes daemon unregister /absolute/path/to/repo')).toBeInTheDocument();
    });

    it('When user clicks Create Session, then the CreateSessionDialog opens', async () => {
        const user = userEvent.setup();
        setupDefaultMocks([]);

        renderProjectDetail('project-123');

        // There may be multiple Create Session buttons (header + empty state); click the first
        const createButtons = screen.getAllByRole('button', { name: /\+ create session/i });
        await user.click(createButtons[0]);

        expect(screen.getByRole('dialog', { name: /create session/i })).toBeInTheDocument();
    });

    it('Given a project page, then a Settings link is rendered for the project', () => {
        setupDefaultMocks([]);

        renderProjectDetail('project-123');

        expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute(
            'href',
            '/project/project-123/settings',
        );
    });
});
