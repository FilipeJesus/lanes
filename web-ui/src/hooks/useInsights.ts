/**
 * useInsights — fetches session insights (and optionally deeper analysis).
 *
 * Call `refresh(includeAnalysis)` to trigger a re-fetch with the desired depth.
 */

import { useState, useEffect, useCallback } from 'react';
import type { DaemonApiClient } from '../api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseInsightsResult {
    /** Human-readable insights text */
    insights: string;
    /** Optional deeper analysis text */
    analysis: string | undefined;
    /** True while the network request is in flight */
    loading: boolean;
    /** Set when the request fails */
    error: Error | null;
    /** Re-fetch. Pass true to request the deeper analysis. */
    refresh: (includeAnalysis?: boolean) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInsights(
    apiClient: DaemonApiClient | null,
    sessionName: string | undefined
): UseInsightsResult {
    const [insights, setInsights] = useState<string>('');
    const [analysis, setAnalysis] = useState<string | undefined>(undefined);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    // refreshKey carries both a counter and the includeAnalysis flag
    const [refreshKey, setRefreshKey] = useState<{ counter: number; includeAnalysis: boolean }>({
        counter: 0,
        includeAnalysis: false,
    });

    const refresh = useCallback((includeAnalysis?: boolean) => {
        setRefreshKey((prev) => ({
            counter: prev.counter + 1,
            includeAnalysis: includeAnalysis ?? false,
        }));
    }, []);

    useEffect(() => {
        if (!apiClient || !sessionName) {
            setInsights('');
            setAnalysis(undefined);
            setLoading(false);
            return;
        }

        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);

            try {
                const res = await apiClient!.getSessionInsights(
                    sessionName!,
                    refreshKey.includeAnalysis
                );
                if (cancelled) return;
                setInsights(res.insights);
                setAnalysis(res.analysis);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
                setInsights('');
                setAnalysis(undefined);
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
    }, [apiClient, sessionName, refreshKey]);

    return { insights, analysis, loading, error, refresh };
}
