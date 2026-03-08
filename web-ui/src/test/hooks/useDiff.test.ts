import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDiff } from '../../hooks/useDiff';
import type { DaemonApiClient } from '../../api/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApiClient(overrides: Partial<DaemonApiClient> = {}): DaemonApiClient {
    return {
        getSessionDiffFiles: vi.fn().mockResolvedValue({ files: ['src/a.ts', 'src/b.ts'], sessionName: 'my-session' }),
        getSessionDiff: vi.fn().mockResolvedValue({ diff: 'diff --git a/src/a.ts b/src/a.ts\n', sessionName: 'my-session' }),
        ...overrides,
    } as unknown as DaemonApiClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDiff', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Given a valid apiClient and sessionName, when the hook mounts, then it calls getSessionDiffFiles and getSessionDiff', async () => {
        const apiClient = makeApiClient();

        renderHook(() => useDiff(apiClient, 'my-session', false));

        await waitFor(() => {
            expect(apiClient.getSessionDiffFiles).toHaveBeenCalledWith('my-session', false);
            expect(apiClient.getSessionDiff).toHaveBeenCalledWith('my-session', false);
        });
    });

    it('Given successful API responses, then files and diff are populated in state', async () => {
        const apiClient = makeApiClient();

        const { result } = renderHook(() => useDiff(apiClient, 'my-session', false));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.files).toEqual(['src/a.ts', 'src/b.ts']);
        expect(result.current.diff).toBe('diff --git a/src/a.ts b/src/a.ts\n');
        expect(result.current.error).toBeNull();
    });

    it('Given loading is in progress, then loading is true during fetch', async () => {
        let resolveFiles!: (v: unknown) => void;
        const filesPromise = new Promise((res) => { resolveFiles = res; });

        const apiClient = {
            getSessionDiffFiles: vi.fn().mockReturnValue(filesPromise),
            getSessionDiff: vi.fn().mockResolvedValue({ diff: '', sessionName: 'my-session' }),
        } as unknown as DaemonApiClient;

        const { result } = renderHook(() => useDiff(apiClient, 'my-session', false));

        // Initially loading should be true (or become true)
        expect(result.current.loading).toBe(true);

        // Resolve to complete
        act(() => {
            resolveFiles({ files: [], sessionName: 'my-session' });
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
    });

    it('Given API call fails, then error is set and files/diff are cleared', async () => {
        const apiClient = {
            getSessionDiffFiles: vi.fn().mockRejectedValue(new Error('Network error')),
            getSessionDiff: vi.fn().mockRejectedValue(new Error('Network error')),
        } as unknown as DaemonApiClient;

        const { result } = renderHook(() => useDiff(apiClient, 'my-session', false));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toBe('Network error');
        expect(result.current.files).toEqual([]);
        expect(result.current.diff).toBe('');
    });

    it('Given includeUncommitted changes from false to true, then the hook re-fetches with the new flag', async () => {
        const apiClient = makeApiClient();

        const { rerender } = renderHook(
            ({ includeUncommitted }) => useDiff(apiClient, 'my-session', includeUncommitted),
            { initialProps: { includeUncommitted: false } }
        );

        await waitFor(() => {
            expect(vi.mocked(apiClient.getSessionDiffFiles)).toHaveBeenCalledWith('my-session', false);
        });

        const prevCallCount = vi.mocked(apiClient.getSessionDiff).mock.calls.length;

        rerender({ includeUncommitted: true });

        await waitFor(() => {
            expect(vi.mocked(apiClient.getSessionDiffFiles)).toHaveBeenCalledWith('my-session', true);
            expect(vi.mocked(apiClient.getSessionDiff)).toHaveBeenCalledWith('my-session', true);
            expect(vi.mocked(apiClient.getSessionDiff).mock.calls.length).toBeGreaterThan(prevCallCount);
        });
    });

    it('Given hook is mounted, when refresh() is called, then the API is called again', async () => {
        const apiClient = makeApiClient();

        const { result } = renderHook(() => useDiff(apiClient, 'my-session', false));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const prevCallCount = vi.mocked(apiClient.getSessionDiff).mock.calls.length;

        act(() => {
            result.current.refresh();
        });

        await waitFor(() => {
            expect(vi.mocked(apiClient.getSessionDiff).mock.calls.length).toBeGreaterThan(prevCallCount);
        });
    });

    it('Given apiClient is null, then files and diff remain empty and loading is false', () => {
        const { result } = renderHook(() => useDiff(null, 'my-session', false));

        expect(result.current.loading).toBe(false);
        expect(result.current.files).toEqual([]);
        expect(result.current.diff).toBe('');
    });
});
