/**
 * useDiff — fetches the changed file list and unified diff text for a session.
 *
 * Re-fetches automatically when `includeUncommitted` or `baseBranch` changes.
 * Call `refresh()` to manually trigger a re-fetch without changing the flags.
 */

import { useState, useEffect, useCallback } from 'react';
import type { DaemonApiClient } from '../api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseDiffResult {
    /** List of changed file paths */
    files: string[];
    /** Full unified diff text */
    diff: string;
    /** True while either network request is in flight */
    loading: boolean;
    /** Set when either request fails */
    error: Error | null;
    /** Manually re-fetch */
    refresh: () => void;
    /** The base branch resolved by the API (may differ from the requested branch) */
    resolvedBaseBranch: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDiff(
    apiClient: DaemonApiClient | null,
    sessionName: string | undefined,
    includeUncommitted: boolean,
    baseBranch: string = ''
): UseDiffResult {
    const [files, setFiles] = useState<string[]>([]);
    const [diff, setDiff] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [refreshCounter, setRefreshCounter] = useState(0);
    const [resolvedBaseBranch, setResolvedBaseBranch] = useState<string>('');

    const refresh = useCallback(() => {
        setRefreshCounter((c) => c + 1);
    }, []);

    useEffect(() => {
        if (!apiClient || !sessionName) {
            setFiles([]);
            setDiff('');
            setLoading(false);
            setResolvedBaseBranch('');
            return;
        }

        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);

            // Pass baseBranch only when non-empty
            const branchParam = baseBranch.trim() || undefined;

            try {
                const [filesRes, diffRes] = await Promise.all([
                    apiClient!.getSessionDiffFiles(sessionName!, includeUncommitted, branchParam),
                    apiClient!.getSessionDiff(sessionName!, includeUncommitted, branchParam),
                ]);

                if (cancelled) return;
                setFiles(filesRes.files.map((f) => typeof f === 'string' ? f : f.path));
                setDiff(diffRes.diff);
                setResolvedBaseBranch(diffRes.baseBranch ?? filesRes.baseBranch ?? '');
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
                setFiles([]);
                setDiff('');
                setResolvedBaseBranch('');
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
    }, [apiClient, sessionName, includeUncommitted, baseBranch, refreshCounter]);

    return { files, diff, loading, error, refresh, resolvedBaseBranch };
}
