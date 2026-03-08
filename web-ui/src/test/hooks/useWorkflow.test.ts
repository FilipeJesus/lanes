import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorkflow } from '../../hooks/useWorkflow';
import type { DaemonApiClient } from '../../api/client';
import type { WorkflowState } from '../../api/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflowState(overrides: Partial<WorkflowState> = {}): WorkflowState {
    return {
        workflowName: 'basic-feature',
        currentStep: 'implement',
        completedSteps: ['plan'],
        outputs: {},
        artefacts: [],
        tasks: [],
        ...overrides,
    };
}

function makeApiClient(overrides: Partial<DaemonApiClient> = {}): DaemonApiClient {
    return {
        getSessionWorkflow: vi.fn().mockResolvedValue(makeWorkflowState()),
        ...overrides,
    } as unknown as DaemonApiClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWorkflow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Given a valid apiClient and sessionName, when mounted, then getSessionWorkflow is called', async () => {
        const apiClient = makeApiClient();

        renderHook(() => useWorkflow(apiClient, 'my-session'));

        await waitFor(() => {
            expect(apiClient.getSessionWorkflow).toHaveBeenCalledWith('my-session');
        });
    });

    it('Given a successful response, then workflowState is populated in state', async () => {
        const state = makeWorkflowState({ currentStep: 'test', completedSteps: ['plan', 'implement'] });
        const apiClient = makeApiClient({
            getSessionWorkflow: vi.fn().mockResolvedValue(state),
        });

        const { result } = renderHook(() => useWorkflow(apiClient, 'my-session'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.workflowState).toEqual(state);
        expect(result.current.error).toBeNull();
    });

    it('Given loading is in progress, then loading is true during fetch', async () => {
        let resolve!: (v: WorkflowState) => void;
        const promise = new Promise<WorkflowState>((res) => { resolve = res; });

        const apiClient = {
            getSessionWorkflow: vi.fn().mockReturnValue(promise),
        } as unknown as DaemonApiClient;

        const { result } = renderHook(() => useWorkflow(apiClient, 'my-session'));

        expect(result.current.loading).toBe(true);

        act(() => {
            resolve(makeWorkflowState());
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
    });

    it('Given the API fails, then error is set and workflowState is null', async () => {
        const apiClient = {
            getSessionWorkflow: vi.fn().mockRejectedValue(new Error('Server error')),
        } as unknown as DaemonApiClient;

        const { result } = renderHook(() => useWorkflow(apiClient, 'my-session'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBeInstanceOf(Error);
        expect(result.current.error?.message).toBe('Server error');
        expect(result.current.workflowState).toBeNull();
    });

    it('Given apiClient is null, then workflowState is null and loading is false', () => {
        const { result } = renderHook(() => useWorkflow(null, 'my-session'));

        expect(result.current.loading).toBe(false);
        expect(result.current.workflowState).toBeNull();
        expect(result.current.error).toBeNull();
    });

    it('Given sessionName is undefined, then workflowState is null and loading is false', () => {
        const apiClient = makeApiClient();

        const { result } = renderHook(() => useWorkflow(apiClient, undefined));

        expect(result.current.loading).toBe(false);
        expect(result.current.workflowState).toBeNull();
    });

    it('Given hook is mounted, when refresh() is called, then the API is called again', async () => {
        const apiClient = makeApiClient();

        const { result } = renderHook(() => useWorkflow(apiClient, 'my-session'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const prevCallCount = vi.mocked(apiClient.getSessionWorkflow).mock.calls.length;

        act(() => {
            result.current.refresh();
        });

        await waitFor(() => {
            expect(vi.mocked(apiClient.getSessionWorkflow).mock.calls.length).toBeGreaterThan(prevCallCount);
        });
    });
});
