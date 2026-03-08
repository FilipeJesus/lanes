/**
 * useWorkflows — fetches available workflow templates from the daemon.
 *
 * Supports filtering by builtin/custom. Call `refresh()` to manually
 * trigger a re-fetch.
 */

import { useState, useEffect, useCallback } from 'react';
import type { DaemonApiClient } from '../api/client';
import type { WorkflowInfo } from '../api/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseWorkflowsOptions {
    includeBuiltin?: boolean;
    includeCustom?: boolean;
}

export interface UseWorkflowsResult {
    /** List of available workflow templates */
    workflows: WorkflowInfo[];
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

export function useWorkflows(
    apiClient: DaemonApiClient | null,
    options?: UseWorkflowsOptions
): UseWorkflowsResult {
    const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [refreshCounter, setRefreshCounter] = useState(0);

    const includeBuiltin = options?.includeBuiltin;
    const includeCustom = options?.includeCustom;

    const refresh = useCallback(() => {
        setRefreshCounter((c) => c + 1);
    }, []);

    useEffect(() => {
        if (!apiClient) {
            setWorkflows([]);
            setLoading(false);
            return;
        }

        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);

            try {
                const res = await apiClient!.listWorkflows({
                    includeBuiltin,
                    includeCustom,
                });
                if (cancelled) return;
                setWorkflows(res.workflows);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
                setWorkflows([]);
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
    }, [apiClient, includeBuiltin, includeCustom, refreshCounter]);

    return { workflows, loading, error, refresh };
}
