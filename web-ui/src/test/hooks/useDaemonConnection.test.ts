import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDaemonConnection } from '../../hooks/useDaemonConnection';
import type { DaemonInfo } from '../../api/types';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../api/gateway', () => ({
    fetchDaemons: vi.fn(),
}));

vi.mock('../../api/client', () => ({
    DaemonApiClient: function DaemonApiClient(opts: { baseUrl: string; token: string }) {
        return { _baseUrl: opts.baseUrl, _token: opts.token };
    },
}));

vi.mock('../../api/sse', () => ({
    DaemonSseClient: function DaemonSseClient(opts: { baseUrl: string; token: string }) {
        return {
            _baseUrl: opts.baseUrl,
            _token: opts.token,
            connect: vi.fn(),
            disconnect: vi.fn(),
            setCallbacks: vi.fn(),
        };
    },
}));

import { fetchDaemons } from '../../api/gateway';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDaemonConnection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('Given a port that matches a known daemon, when the hook runs, then it returns a non-null apiClient', async () => {
        vi.mocked(fetchDaemons).mockResolvedValue([makeDaemonInfo({ port: 3942 })]);

        const { result } = renderHook(() => useDaemonConnection(3942));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.apiClient).not.toBeNull();
    });

    it('Given a port that matches a known daemon, when the hook runs, then it returns a non-null sseClient', async () => {
        vi.mocked(fetchDaemons).mockResolvedValue([makeDaemonInfo({ port: 3942 })]);

        const { result } = renderHook(() => useDaemonConnection(3942));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.sseClient).not.toBeNull();
    });

    it('Given a port that does not match any daemon, when the hook runs, then apiClient and sseClient are null', async () => {
        vi.mocked(fetchDaemons).mockResolvedValue([makeDaemonInfo({ port: 3942 })]);

        const { result } = renderHook(() => useDaemonConnection(9999));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.apiClient).toBeNull();
        expect(result.current.sseClient).toBeNull();
    });
});
