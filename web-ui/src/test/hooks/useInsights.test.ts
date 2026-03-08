import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useInsights } from '../../hooks/useInsights';
import type { DaemonApiClient } from '../../api/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApiClient(overrides: Partial<DaemonApiClient> = {}): DaemonApiClient {
    return {
        getSessionInsights: vi.fn().mockResolvedValue({
            insights: 'Session completed 3 tasks.',
            analysis: undefined,
            sessionName: 'my-session',
        }),
        ...overrides,
    } as unknown as DaemonApiClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useInsights', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Given a valid apiClient and sessionName, when mounted, then getSessionInsights is called', async () => {
        const apiClient = makeApiClient();

        renderHook(() => useInsights(apiClient, 'my-session'));

        await waitFor(() => {
            expect(apiClient.getSessionInsights).toHaveBeenCalledWith('my-session', false);
        });
    });

    it('Given a successful response, then insights and analysis are set in state', async () => {
        const apiClient = makeApiClient({
            getSessionInsights: vi.fn().mockResolvedValue({
                insights: 'Session completed 3 tasks.',
                analysis: 'Detailed analysis here.',
                sessionName: 'my-session',
            }),
        });

        const { result } = renderHook(() => useInsights(apiClient, 'my-session'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.insights).toBe('Session completed 3 tasks.');
        expect(result.current.analysis).toBe('Detailed analysis here.');
        expect(result.current.error).toBeNull();
    });

    it('Given loading is in progress, then loading is true during fetch', async () => {
        let resolve!: (v: unknown) => void;
        const promise = new Promise((res) => { resolve = res; });

        const apiClient = {
            getSessionInsights: vi.fn().mockReturnValue(promise),
        } as unknown as DaemonApiClient;

        const { result } = renderHook(() => useInsights(apiClient, 'my-session'));

        expect(result.current.loading).toBe(true);

        act(() => {
            resolve({ insights: '', analysis: undefined, sessionName: 'my-session' });
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
    });

    it('Given API fails, then error is set and insights/analysis are cleared', async () => {
        const apiClient = {
            getSessionInsights: vi.fn().mockRejectedValue(new Error('Server error')),
        } as unknown as DaemonApiClient;

        const { result } = renderHook(() => useInsights(apiClient, 'my-session'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toBe('Server error');
        expect(result.current.insights).toBe('');
        expect(result.current.analysis).toBeUndefined();
    });

    it('Given hook is mounted, when refresh(true) is called, then getSessionInsights is called with includeAnalysis=true', async () => {
        const apiClient = makeApiClient({
            getSessionInsights: vi.fn()
                .mockResolvedValueOnce({ insights: 'first', analysis: undefined, sessionName: 'my-session' })
                .mockResolvedValueOnce({ insights: 'first', analysis: 'deep analysis', sessionName: 'my-session' }),
        });

        const { result } = renderHook(() => useInsights(apiClient, 'my-session'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        act(() => {
            result.current.refresh(true);
        });

        await waitFor(() => {
            expect(apiClient.getSessionInsights).toHaveBeenCalledWith('my-session', true);
            expect(result.current.analysis).toBe('deep analysis');
        });
    });

    it('Given refresh() called without arguments, then includeAnalysis defaults to false', async () => {
        const apiClient = makeApiClient();

        const { result } = renderHook(() => useInsights(apiClient, 'my-session'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        act(() => {
            result.current.refresh();
        });

        await waitFor(() => {
            // Called at least twice (initial + refresh), both with false
            const calls = vi.mocked(apiClient.getSessionInsights).mock.calls;
            expect(calls.length).toBeGreaterThanOrEqual(2);
            expect(calls[calls.length - 1][1]).toBe(false);
        });
    });

    it('Given apiClient is null, then insights remain empty and loading is false', () => {
        const { result } = renderHook(() => useInsights(null, 'my-session'));

        expect(result.current.loading).toBe(false);
        expect(result.current.insights).toBe('');
        expect(result.current.analysis).toBeUndefined();
    });
});
