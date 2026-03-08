import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkflows } from '../../hooks/useWorkflows';
import type { DaemonApiClient } from '../../api/client';
import type { WorkflowInfo } from '../../api/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const builtinWorkflow: WorkflowInfo = {
    name: 'basic-feature',
    description: 'A basic feature workflow',
    isBuiltin: true,
    steps: [
        { id: 'plan', type: 'step', description: 'Plan the feature' },
        { id: 'implement', type: 'step', description: 'Implement the feature' },
    ],
};

const customWorkflow: WorkflowInfo = {
    name: 'my-custom-flow',
    description: 'Custom workflow',
    isBuiltin: false,
    steps: [{ id: 'build', type: 'step' }],
};

function makeApiClient(overrides: Partial<DaemonApiClient> = {}): DaemonApiClient {
    return {
        listWorkflows: vi.fn().mockResolvedValue({ workflows: [builtinWorkflow, customWorkflow] }),
        ...overrides,
    } as unknown as DaemonApiClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWorkflows', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Given a valid apiClient, when mounted, then listWorkflows is called', async () => {
        const apiClient = makeApiClient();

        renderHook(() => useWorkflows(apiClient));

        await waitFor(() => {
            expect(apiClient.listWorkflows).toHaveBeenCalled();
        });
    });

    it('Given a successful response, then workflows array is populated', async () => {
        const apiClient = makeApiClient();

        const { result } = renderHook(() => useWorkflows(apiClient));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.workflows).toHaveLength(2);
        expect(result.current.workflows[0].name).toBe('basic-feature');
        expect(result.current.error).toBeNull();
    });

    it('Given loading is in progress, then loading is true during fetch', async () => {
        let resolve!: (v: { workflows: WorkflowInfo[] }) => void;
        const promise = new Promise<{ workflows: WorkflowInfo[] }>((res) => { resolve = res; });

        const apiClient = {
            listWorkflows: vi.fn().mockReturnValue(promise),
        } as unknown as DaemonApiClient;

        const { result } = renderHook(() => useWorkflows(apiClient));

        expect(result.current.loading).toBe(true);

        act(() => {
            resolve({ workflows: [builtinWorkflow] });
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
    });

    it('Given the API fails, then error is set and workflows is empty', async () => {
        const apiClient = {
            listWorkflows: vi.fn().mockRejectedValue(new Error('Network error')),
        } as unknown as DaemonApiClient;

        const { result } = renderHook(() => useWorkflows(apiClient));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toBe('Network error');
        expect(result.current.workflows).toEqual([]);
    });

    it('Given apiClient is null, then workflows is empty and loading is false', () => {
        const { result } = renderHook(() => useWorkflows(null));

        expect(result.current.loading).toBe(false);
        expect(result.current.workflows).toEqual([]);
        expect(result.current.error).toBeNull();
    });

    it('Given hook is mounted, when refresh() is called, then the API is called again', async () => {
        const apiClient = makeApiClient();

        const { result } = renderHook(() => useWorkflows(apiClient));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const prevCallCount = vi.mocked(apiClient.listWorkflows).mock.calls.length;

        act(() => {
            result.current.refresh();
        });

        await waitFor(() => {
            expect(vi.mocked(apiClient.listWorkflows).mock.calls.length).toBeGreaterThan(prevCallCount);
        });
    });

    it('Given includeBuiltin option changes to false, then API is called with new options', async () => {
        const apiClient = makeApiClient();

        const { rerender } = renderHook(
            ({ opts }) => useWorkflows(apiClient, opts),
            { initialProps: { opts: { includeBuiltin: true, includeCustom: true } } }
        );

        await waitFor(() => {
            expect(vi.mocked(apiClient.listWorkflows)).toHaveBeenCalledWith({
                includeBuiltin: true,
                includeCustom: true,
            });
        });

        rerender({ opts: { includeBuiltin: false, includeCustom: true } });

        await waitFor(() => {
            expect(vi.mocked(apiClient.listWorkflows)).toHaveBeenCalledWith({
                includeBuiltin: false,
                includeCustom: true,
            });
        });
    });
});
