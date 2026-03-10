import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDaemons } from '../../hooks/useDaemons';
import type { DaemonInfo, DiscoveryInfo, GatewayProjectInfo, HealthResponse } from '../../api/types';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../api/gateway', () => ({
    fetchProjects: vi.fn(),
}));

// Shared methods object so the mock constructor closure captures stable references
const mockClientMethods = {
    getDiscovery: vi.fn<() => Promise<DiscoveryInfo>>(),
    getHealth: vi.fn<() => Promise<HealthResponse>>(),
};

vi.mock('../../api/client', () => ({
    // Use a named function so TypeScript sees it as a constructor
    DaemonApiClient: function DaemonApiClientMock() {
        return mockClientMethods;
    },
}));

import { fetchProjects } from '../../api/gateway';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDaemonInfo(overrides: Partial<DaemonInfo> = {}): DaemonInfo {
    return {
        workspaceRoot: '/projects/my-app',
        port: 3942,
        pid: 1234,
        token: 'test-token',
        startedAt: new Date().toISOString(),
        projectName: 'my-app',
        ...overrides,
    };
}

function makeProjectInfo(overrides: Partial<GatewayProjectInfo> = {}): GatewayProjectInfo {
    return {
        projectId: 'project-123',
        workspaceRoot: '/projects/my-app',
        projectName: 'my-app',
        registeredAt: new Date().toISOString(),
        status: 'running',
        daemon: makeDaemonInfo(),
        ...overrides,
    };
}

function makeDiscovery(overrides: Partial<DiscoveryInfo> = {}): DiscoveryInfo {
    return {
        projectId: 'project-123',
        projectName: 'my-app',
        gitRemote: 'github.com/org/my-app',
        sessionCount: 2,
        uptime: 1000,
        workspaceRoot: '/projects/my-app',
        port: 3942,
        apiVersion: '1',
        ...overrides,
    };
}

function makeHealth(status: string = 'ok'): HealthResponse {
    return { status, version: '1.0.0' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDaemons', () => {
    let mockFetchProjects: ReturnType<typeof vi.mocked<typeof fetchProjects>>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockFetchProjects = vi.mocked(fetchProjects);
        mockClientMethods.getDiscovery.mockResolvedValue(makeDiscovery());
        mockClientMethods.getHealth.mockResolvedValue(makeHealth());
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('Given the hook is mounted, when rendered, then fetchProjects is called once', async () => {
        mockFetchProjects.mockResolvedValue([makeProjectInfo()]);

        const { result } = renderHook(() => useDaemons());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(mockFetchProjects).toHaveBeenCalledTimes(1);
    });

    it('Given fetchProjects resolves, then daemons state is populated', async () => {
        const daemon = makeDaemonInfo();
        mockFetchProjects.mockResolvedValue([makeProjectInfo({ daemon })]);

        const { result } = renderHook(() => useDaemons());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.daemons).toHaveLength(1);
        expect(result.current.daemons[0].daemon).toEqual(daemon);
    });

    it('Given fetchProjects resolves, then loading transitions from true to false', async () => {
        mockFetchProjects.mockResolvedValue([makeProjectInfo()]);

        const { result } = renderHook(() => useDaemons());

        // Initially loading
        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
    });

    it('Given fetchProjects returns 2 running projects, when hook loads, then DaemonApiClient.getDiscovery is called twice', async () => {
        const daemon1 = makeDaemonInfo({ port: 3942 });
        const daemon2 = makeDaemonInfo({ port: 3943 });
        mockFetchProjects.mockResolvedValue([
            makeProjectInfo({ daemon: daemon1 }),
            makeProjectInfo({ workspaceRoot: '/projects/my-api', projectName: 'my-api', daemon: daemon2 }),
        ]);

        const { result } = renderHook(() => useDaemons());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(mockClientMethods.getDiscovery).toHaveBeenCalledTimes(2);
    });

    it('Given getDiscovery resolves for a daemon, then the returned daemon object includes projectName, gitRemote, sessionCount', async () => {
        const daemon = makeDaemonInfo();
        const discovery = makeDiscovery({
            projectName: 'my-app',
            gitRemote: 'github.com/org/my-app',
            sessionCount: 3,
        });
        mockFetchProjects.mockResolvedValue([makeProjectInfo({ daemon })]);
        mockClientMethods.getDiscovery.mockResolvedValue(discovery);

        const { result } = renderHook(() => useDaemons());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const enriched = result.current.daemons[0];
        expect(enriched.discovery?.projectName).toBe('my-app');
        expect(enriched.discovery?.gitRemote).toBe('github.com/org/my-app');
        expect(enriched.discovery?.sessionCount).toBe(3);
    });

    it('Given getDiscovery throws for a daemon, then that daemon has health state "unreachable"', async () => {
        const daemon = makeDaemonInfo();
        mockFetchProjects.mockResolvedValue([makeProjectInfo({ daemon })]);
        mockClientMethods.getDiscovery.mockRejectedValue(new Error('ECONNREFUSED'));
        mockClientMethods.getHealth.mockRejectedValue(new Error('ECONNREFUSED'));

        const { result } = renderHook(() => useDaemons());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.daemons[0].health).toBe('unreachable');
    });

    it('Given getDiscovery throws for one daemon, the other daemons are still returned successfully', async () => {
        const daemon1 = makeDaemonInfo({ port: 3942 });
        const daemon2 = makeDaemonInfo({ port: 3943 });
        mockFetchProjects.mockResolvedValue([
            makeProjectInfo({ daemon: daemon1 }),
            makeProjectInfo({ workspaceRoot: '/projects/my-api', projectName: 'my-api', daemon: daemon2 }),
        ]);

        // First call fails (daemon1's getDiscovery), second succeeds (daemon2's getDiscovery)
        let callCount = 0;
        mockClientMethods.getDiscovery.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.reject(new Error('ECONNREFUSED'));
            }
            return Promise.resolve(makeDiscovery());
        });
        mockClientMethods.getHealth.mockImplementation(() => {
            if (callCount <= 1) {
                return Promise.reject(new Error('ECONNREFUSED'));
            }
            return Promise.resolve(makeHealth());
        });

        const { result } = renderHook(() => useDaemons());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.daemons).toHaveLength(2);
    });

    it('Given fetchProjects throws, then error is set in state', async () => {
        mockFetchProjects.mockRejectedValue(new Error('Network failure'));

        const { result } = renderHook(() => useDaemons());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toBe('Network failure');
    });

    it('Given fetchProjects throws, then loading is false', async () => {
        mockFetchProjects.mockRejectedValue(new Error('Network failure'));

        const { result } = renderHook(() => useDaemons());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.loading).toBe(false);
    });

    it('Given fetchProjects throws, then daemons array is empty', async () => {
        mockFetchProjects.mockRejectedValue(new Error('Network failure'));

        const { result } = renderHook(() => useDaemons());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.daemons).toHaveLength(0);
    });

    it('Given the hook is mounted, when refresh() is called, then fetchProjects is called a second time', async () => {
        mockFetchProjects.mockResolvedValue([makeProjectInfo()]);

        const { result } = renderHook(() => useDaemons());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(mockFetchProjects).toHaveBeenCalledTimes(1);

        act(() => {
            result.current.refresh();
        });

        await waitFor(() => {
            expect(mockFetchProjects).toHaveBeenCalledTimes(2);
        });
    });

    it('Given a registered project without a daemon, then it is returned with health state "registered" and no daemon client calls', async () => {
        mockFetchProjects.mockResolvedValue([
            makeProjectInfo({ status: 'registered', daemon: null }),
        ]);

        const { result } = renderHook(() => useDaemons());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.daemons[0].health).toBe('registered');
        expect(result.current.daemons[0].daemon).toBeNull();
        expect(mockClientMethods.getDiscovery).not.toHaveBeenCalled();
        expect(mockClientMethods.getHealth).not.toHaveBeenCalled();
    });
});
