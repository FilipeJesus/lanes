import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDaemonConnection, __resetDaemonConnectionCacheForTests } from '../../hooks/useDaemonConnection';
import type { DaemonInfo, GatewayProjectInfo } from '../../api/types';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../api/gateway', () => ({
    fetchProjects: vi.fn(),
}));

vi.mock('../../api/client', () => ({
    DaemonApiClient: function DaemonApiClient(opts: { baseUrl: string; token: string; projectId?: string }) {
        return { _baseUrl: opts.baseUrl, _token: opts.token, _projectId: opts.projectId };
    },
}));

vi.mock('../../api/sse', () => ({
    DaemonSseClient: function DaemonSseClient(opts: { baseUrl: string; token: string; projectId?: string }) {
        return {
            _baseUrl: opts.baseUrl,
            _token: opts.token,
            _projectId: opts.projectId,
            connect: vi.fn(),
            disconnect: vi.fn(),
            setCallbacks: vi.fn(),
        };
    },
}));

import { fetchProjects } from '../../api/gateway';

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

function makeProjectInfo(overrides: Partial<GatewayProjectInfo> = {}): GatewayProjectInfo {
    const projectId = overrides.projectId ?? 'project-123';
    return {
        projectId,
        workspaceRoot: '/projects/my-app',
        projectName: 'my-app',
        registeredAt: new Date().toISOString(),
        status: 'running',
        daemon: makeDaemonInfo({ projectId }),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDaemonConnection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        __resetDaemonConnectionCacheForTests();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('Given a project ID that matches a known project, when the hook runs, then it returns a non-null apiClient', async () => {
        vi.mocked(fetchProjects).mockResolvedValue([makeProjectInfo()]);

        const { result } = renderHook(() => useDaemonConnection('project-123'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.apiClient).not.toBeNull();
    });

    it('Given a project ID that matches a known project, when the hook runs, then it returns a non-null sseClient', async () => {
        vi.mocked(fetchProjects).mockResolvedValue([makeProjectInfo()]);

        const { result } = renderHook(() => useDaemonConnection('project-123'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.sseClient).not.toBeNull();
    });

    it('Given a project ID that does not match any project, when the hook runs, then apiClient and sseClient are null', async () => {
        vi.mocked(fetchProjects).mockResolvedValue([makeProjectInfo()]);

        const { result } = renderHook(() => useDaemonConnection('missing-project'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.apiClient).toBeNull();
        expect(result.current.sseClient).toBeNull();
    });

    it('Given no project ID provided, when the hook runs, then no error is set and fetchProjects is not called', async () => {
        const { result } = renderHook(() => useDaemonConnection(undefined));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBeNull();
        expect(vi.mocked(fetchProjects)).not.toHaveBeenCalled();
    });

    it('Given a matching project, when the hook resolves, then daemonInfo is set', async () => {
        vi.mocked(fetchProjects).mockResolvedValue([
            makeProjectInfo({ projectName: 'api-service', daemon: makeDaemonInfo({ projectName: 'api-service' }) }),
        ]);

        const { result } = renderHook(() => useDaemonConnection('project-123'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.daemonInfo?.projectName).toBe('api-service');
    });

    it('Given two hook mounts for the same project ID, when the second mount occurs within cache TTL, then fetchProjects is called once', async () => {
        vi.mocked(fetchProjects).mockResolvedValue([makeProjectInfo()]);

        const first = renderHook(() => useDaemonConnection('project-123'));
        await waitFor(() => {
            expect(first.result.current.loading).toBe(false);
        });
        first.unmount();

        const second = renderHook(() => useDaemonConnection('project-123'));
        await waitFor(() => {
            expect(second.result.current.loading).toBe(false);
        });
        second.unmount();

        expect(vi.mocked(fetchProjects)).toHaveBeenCalledTimes(1);
    });
});
