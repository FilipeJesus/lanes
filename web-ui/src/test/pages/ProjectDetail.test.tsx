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
        loading: false,
        error: null,
    });

    mockUseSessions.mockReturnValue({
        sessions,
        loading: false,
        error: null,
        refresh: vi.fn(),
        createSession: vi.fn(),
        deleteSession: vi.fn(),
        pinSession: vi.fn(),
        unpinSession: vi.fn(),
    });

    return { apiClient };
}

function renderProjectDetail(projectId: string = 'project-123') {
    return render(
        <MemoryRouter initialEntries={[`/project/${projectId}`]}>
            <Routes>
                <Route path="/project/:projectId" element={<ProjectDetail />} />
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
    });

    it('Given a project id param and a daemon that returns sessions, then session cards are rendered', () => {
        const sessions = [
            makeSession({ name: 'session-1' }),
            makeSession({ name: 'session-2' }),
        ];
        setupDefaultMocks(sessions);

        renderProjectDetail('project-123');

        expect(screen.getByText('session-1')).toBeInTheDocument();
        expect(screen.getByText('session-2')).toBeInTheDocument();
    });

    it('Given no sessions, then an empty state message is shown', () => {
        setupDefaultMocks([]);

        renderProjectDetail('project-123');

        expect(screen.getByText(/no sessions yet/i)).toBeInTheDocument();
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
