import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../../pages/Dashboard';
import type { EnrichedDaemon } from '../../hooks/useDaemons';
import type { DaemonInfo, DiscoveryInfo, GatewayProjectInfo } from '../../api/types';

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

const mockUseDaemons = vi.fn();
vi.mock('../../hooks/useDaemons', () => ({
    useDaemons: () => mockUseDaemons(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDaemonInfo(overrides: Partial<DaemonInfo> = {}): DaemonInfo {
    return {
        projectId: 'project-123',
        workspaceRoot: '/projects/my-app',
        port: 3942,
        pid: 1234,
        token: 'test-token',
        startedAt: new Date().toISOString(),
        projectName: 'my-app',
        ...overrides,
    };
}

function makeDiscovery(overrides: Partial<DiscoveryInfo> = {}): DiscoveryInfo {
    return {
        projectId: 'project-123',
        projectName: 'my-app',
        gitRemote: null,
        sessionCount: 0,
        uptime: 100,
        workspaceRoot: '/projects/my-app',
        port: 3942,
        apiVersion: '1',
        ...overrides,
    };
}

function makeProjectInfo(overrides: Partial<GatewayProjectInfo> = {}): GatewayProjectInfo {
    const projectId = overrides.projectId ?? 'project-123';
    return {
        projectId,
        daemonProjectId: projectId,
        workspaceRoot: '/projects/my-app',
        projectName: 'my-app',
        registeredAt: new Date().toISOString(),
        status: 'running',
        daemon: makeDaemonInfo({ projectId }),
        ...overrides,
    };
}

function makeEnrichedDaemon(port: number, projectName: string): EnrichedDaemon {
    const projectId = `project-${projectName}`;
    return {
        project: makeProjectInfo({ projectId, workspaceRoot: `/projects/${projectName}`, projectName }),
        daemon: makeDaemonInfo({ projectId, port, projectName }),
        discovery: makeDiscovery({ projectId, port, projectName }),
        health: 'healthy',
        healthResponse: { status: 'ok', version: '1.0.0' },
    };
}

function makeRegisteredProject(projectName: string): EnrichedDaemon {
    return {
        project: makeProjectInfo({
            projectId: `project-${projectName}`,
            workspaceRoot: `/projects/${projectName}`,
            projectName,
            status: 'registered',
            daemon: null,
        }),
        daemon: null,
        discovery: null,
        health: 'registered',
        healthResponse: null,
    };
}

function renderDashboard() {
    return render(
        <MemoryRouter>
            <Dashboard />
        </MemoryRouter>
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard', () => {
    beforeEach(() => {
        mockNavigate.mockClear();
        mockUseDaemons.mockClear();
    });

    it('Given useDaemons returns loading=true, then a loading indicator element is rendered', () => {
        mockUseDaemons.mockReturnValue({
            daemons: [],
            loading: true,
            error: null,
            refresh: vi.fn(),
        });

        renderDashboard();

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('Given useDaemons returns loading=false, then the loading indicator is not rendered', () => {
        mockUseDaemons.mockReturnValue({
            daemons: [],
            loading: false,
            error: null,
            refresh: vi.fn(),
        });

        renderDashboard();

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('Given useDaemons returns empty daemons array and loading=false, then empty state message is shown', () => {
        mockUseDaemons.mockReturnValue({
            daemons: [],
            loading: false,
            error: null,
            refresh: vi.fn(),
        });

        renderDashboard();

        expect(screen.getByText(/no projects registered/i)).toBeInTheDocument();
    });

    it('Given empty state, then a helpful message about running "lanes daemon register ." is visible', () => {
        mockUseDaemons.mockReturnValue({
            daemons: [],
            loading: false,
            error: null,
            refresh: vi.fn(),
        });

        renderDashboard();

        expect(screen.getByText(/lanes daemon register \./i)).toBeInTheDocument();
    });

    it('Given empty state, then the onboarding copy explains that projects are registered first and daemons start later', () => {
        mockUseDaemons.mockReturnValue({
            daemons: [],
            loading: false,
            error: null,
            refresh: vi.fn(),
        });

        renderDashboard();

        expect(screen.getByText(/register a repo locally, or register a remote daemon to browse the projects it tracks/i)).toBeInTheDocument();
    });

    it('Given useDaemons returns 3 daemons, then 3 ProjectCard elements are rendered', () => {
        mockUseDaemons.mockReturnValue({
            daemons: [
                makeEnrichedDaemon(3942, 'project-a'),
                makeEnrichedDaemon(3943, 'project-b'),
                makeEnrichedDaemon(3944, 'project-c'),
            ],
            loading: false,
            error: null,
            refresh: vi.fn(),
        });

        renderDashboard();

        const projectCards = screen.getAllByRole('button', { name: /open project/i });
        expect(projectCards).toHaveLength(3);
    });

    it('Given useDaemons returns 1 daemon, then 1 ProjectCard element is rendered', () => {
        mockUseDaemons.mockReturnValue({
            daemons: [makeEnrichedDaemon(3942, 'project-a')],
            loading: false,
            error: null,
            refresh: vi.fn(),
        });

        renderDashboard();

        const projectCards = screen.getAllByRole('button', { name: /open project/i });
        expect(projectCards).toHaveLength(1);
    });

    it('Given a registered offline project, then its card renders as a non-clickable setup state', () => {
        mockUseDaemons.mockReturnValue({
            daemons: [makeRegisteredProject('project-a')],
            loading: false,
            error: null,
            refresh: vi.fn(),
        });

        renderDashboard();

        expect(screen.getByText(/ready to start/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /open project project-a/i })).not.toBeInTheDocument();
    });

    it('Given useDaemons returns an error, then an error message is displayed', () => {
        mockUseDaemons.mockReturnValue({
            daemons: [],
            loading: false,
            error: new Error('Network failure'),
            refresh: vi.fn(),
        });

        renderDashboard();

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/network failure/i)).toBeInTheDocument();
    });

    it('Given useDaemons returns an error, then no project cards are rendered', () => {
        mockUseDaemons.mockReturnValue({
            daemons: [],
            loading: false,
            error: new Error('Network failure'),
            refresh: vi.fn(),
        });

        renderDashboard();

        expect(screen.queryAllByRole('button', { name: /open project/i })).toHaveLength(0);
    });

    it('Given the Dashboard is rendered, then a refresh button is present', () => {
        mockUseDaemons.mockReturnValue({
            daemons: [],
            loading: false,
            error: null,
            refresh: vi.fn(),
        });

        renderDashboard();

        expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });

    it('Given the refresh button is clicked, then the refresh function from useDaemons is called', async () => {
        const refresh = vi.fn();
        const user = userEvent.setup();

        mockUseDaemons.mockReturnValue({
            daemons: [],
            loading: false,
            error: null,
            refresh,
        });

        renderDashboard();

        await user.click(screen.getByRole('button', { name: /refresh/i }));
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});
