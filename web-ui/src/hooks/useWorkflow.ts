/**
 * useWorkflow — fetches detailed workflow state for a session.
 *
 * Fetches via `getSessionWorkflow`. Call `refresh()` to manually trigger
 * a re-fetch.
 */

import { useState, useEffect, useCallback } from 'react';
import type { DaemonApiClient } from '../api/client';
import type { WorkflowState } from '../api/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseWorkflowResult {
    /** The workflow state object, or null if not available */
    workflowState: WorkflowState | null;
    /** True while the network request is in flight */
    loading: boolean;
    /** Set when the request fails */
    error: Error | null;
    /** Manually re-fetch */
    refresh: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWorkflow(
    apiClient: DaemonApiClient | null,
    sessionName: string | undefined
): UseWorkflowResult {
    const [workflowState, setWorkflowState] = useState<WorkflowState | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [refreshCounter, setRefreshCounter] = useState(0);

    const refresh = useCallback(() => {
        setRefreshCounter((c) => c + 1);
    }, []);

    useEffect(() => {
        if (!apiClient || !sessionName) {
            setWorkflowState(null);
            setLoading(false);
            return;
        }

        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);

            try {
                const res = await apiClient!.getSessionWorkflow(sessionName!);
                if (cancelled) return;
                setWorkflowState(res);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
                setWorkflowState(null);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        void load();

        return () => {
            cancelled = true;
        };
    }, [apiClient, sessionName, refreshCounter]);

    return { workflowState, loading, error, refresh };
}
