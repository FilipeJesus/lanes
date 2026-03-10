import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ProjectCard } from '../../components/ProjectCard';
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDaemonInfo(overrides: Partial<DaemonInfo> = {}): DaemonInfo {
    return {
        workspaceRoot: '/projects/my-app',
        port: 3942,
        pid: 1234,
        token: 'test-token',
        startedAt: new Date(Date.now() - 3_600_000).toISOString(), // 1h ago
        projectName: 'my-app',
        ...overrides,
    };
}

function makeDiscovery(overrides: Partial<DiscoveryInfo> = {}): DiscoveryInfo {
    return {
        projectName: 'my-app',
        gitRemote: 'github.com/org/my-app',
        sessionCount: 3,
        uptime: 3600,
        workspaceRoot: '/projects/my-app',
        port: 3942,
        apiVersion: '1',
        ...overrides,
    };
}

function makeProjectInfo(overrides: Partial<GatewayProjectInfo> = {}): GatewayProjectInfo {
    return {
        workspaceRoot: '/projects/my-app',
        projectName: 'my-app',
        registeredAt: new Date().toISOString(),
        status: 'running',
        daemon: makeDaemonInfo(),
        ...overrides,
    };
}

function makeEnrichedDaemon(overrides: Partial<EnrichedDaemon> = {}): EnrichedDaemon {
    return {
        project: makeProjectInfo(),
        daemon: makeDaemonInfo(),
        discovery: makeDiscovery(),
        health: 'healthy',
        healthResponse: { status: 'ok', version: '1.0.0' },
        ...overrides,
    };
}

function renderCard(enrichedDaemon: EnrichedDaemon) {
    return render(
        <MemoryRouter>
            <ProjectCard enrichedDaemon={enrichedDaemon} />
        </MemoryRouter>
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectCard', () => {
    beforeEach(() => {
        mockNavigate.mockClear();
    });

    it('Given a daemon with projectName "my-app", then "my-app" is visible in the rendered card', () => {
        renderCard(makeEnrichedDaemon());
        expect(screen.getByText('my-app')).toBeInTheDocument();
    });

    it('Given a daemon with gitRemote "github.com/org/repo", then that remote is shown', () => {
        const enriched = makeEnrichedDaemon({
            discovery: makeDiscovery({ gitRemote: 'github.com/org/repo' }),
        });
        renderCard(enriched);
        expect(screen.getByText('github.com/org/repo')).toBeInTheDocument();
    });

    it('Given a daemon with sessionCount 3, then "3" sessions label is visible', () => {
        const enriched = makeEnrichedDaemon({
            discovery: makeDiscovery({ sessionCount: 3 }),
        });
        renderCard(enriched);
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('Given a daemon with startedAt timestamp, then formatted uptime is shown', () => {
        const enriched = makeEnrichedDaemon();
        renderCard(enriched);
        // Uptime should be displayed — we just check that it's not empty
        const uptimeLabel = screen.getByText('Uptime');
        expect(uptimeLabel).toBeInTheDocument();
        // The sibling value should contain a time unit
        expect(screen.getByText(/\d+[smhd]/)).toBeInTheDocument();
    });

    it('Given health = "healthy", then indicator has green color class', () => {
        const enriched = makeEnrichedDaemon({ health: 'healthy' });
        const { container } = renderCard(enriched);
        const indicator = container.querySelector('[aria-label="Health: healthy"]');
        expect(indicator?.className).toMatch(/healthHealthy/i);
    });

    it('Given health = "healthy", then accessible label contains "healthy"', () => {
        const enriched = makeEnrichedDaemon({ health: 'healthy' });
        renderCard(enriched);
        expect(screen.getByLabelText('Health: healthy')).toBeInTheDocument();
    });

    it('Given health = "degraded", then indicator has warning/yellow color class', () => {
        const enriched = makeEnrichedDaemon({ health: 'degraded' });
        const { container } = renderCard(enriched);
        const indicator = container.querySelector('[aria-label="Health: degraded"]');
        expect(indicator?.className).toMatch(/healthDegraded/i);
    });

    it('Given health = "degraded", then accessible label contains "degraded"', () => {
        const enriched = makeEnrichedDaemon({ health: 'degraded' });
        renderCard(enriched);
        expect(screen.getByLabelText('Health: degraded')).toBeInTheDocument();
    });

    it('Given health = "unreachable", then indicator has danger/red color class', () => {
        const enriched = makeEnrichedDaemon({ health: 'unreachable' });
        const { container } = renderCard(enriched);
        const indicator = container.querySelector('[aria-label="Health: unreachable"]');
        expect(indicator?.className).toMatch(/healthUnreachable/i);
    });

    it('Given health = "unreachable", then accessible label contains "unreachable"', () => {
        const enriched = makeEnrichedDaemon({ health: 'unreachable' });
        renderCard(enriched);
        expect(screen.getByLabelText('Health: unreachable')).toBeInTheDocument();
    });

    it('Given a card for port 3942, when the card is clicked, then navigation to "/project/3942" occurs', async () => {
        const user = userEvent.setup();
        const enriched = makeEnrichedDaemon({ daemon: makeDaemonInfo({ port: 3942 }) });

        renderCard(enriched);

        const card = screen.getByRole('button', { name: /open project/i });
        await user.click(card);

        expect(mockNavigate).toHaveBeenCalledWith('/project/3942');
    });

    it('Given a registered project without a running daemon, then the card is not clickable and shows offline state', () => {
        const enriched = makeEnrichedDaemon({
            project: makeProjectInfo({ status: 'registered', daemon: null }),
            daemon: null,
            discovery: null,
            health: 'registered',
        });

        renderCard(enriched);

        expect(screen.getByLabelText('Health: registered')).toBeInTheDocument();
        expect(screen.getByText('Offline')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /open project/i })).not.toBeInTheDocument();
    });
});
