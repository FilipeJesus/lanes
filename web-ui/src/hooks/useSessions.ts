/**
 * useSessions — manages the session list for a daemon with real-time SSE updates.
 *
 * Fetches the initial session list via the REST API, then subscribes to the
 * daemon SSE stream to keep state current without polling.
 */

import { useState, useEffect, useCallback } from 'react';
import type { DaemonApiClient } from '../api/client';
import type { DaemonSseClient, SseCallbacks } from '../api/sse';
import type { SessionInfo, AgentSessionStatus, CreateSessionRequest } from '../api/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseSessionsResult {
    sessions: SessionInfo[];
    loading: boolean;
    error: Error | null;
    refresh: () => void;
    createSession: (params: CreateSessionRequest) => Promise<void>;
    deleteSession: (name: string) => Promise<void>;
    pinSession: (name: string) => Promise<void>;
    unpinSession: (name: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSessions(
    apiClient: DaemonApiClient | null,
    sseClient: DaemonSseClient | null
): UseSessionsResult {
    const [sessions, setSessions] = useState<SessionInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [refreshCounter, setRefreshCounter] = useState(0);

    const refresh = useCallback(() => {
        setRefreshCounter((c) => c + 1);
    }, []);

    // ---------------------------------------------------------------------------
    // Initial fetch
    // ---------------------------------------------------------------------------

    useEffect(() => {
        if (!apiClient) {
            setSessions([]);
            setLoading(false);
            return;
        }

        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);

            try {
                const res = await apiClient!.listSessions();
                if (cancelled) return;
                setSessions(res.sessions);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
                setSessions([]);
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
    }, [apiClient, refreshCounter]);

    // ---------------------------------------------------------------------------
    // SSE subscription
    // ---------------------------------------------------------------------------

    useEffect(() => {
        if (!sseClient) return;

        const callbacks: SseCallbacks = {
            onSessionStatusChanged: ({ sessionName, status }) => {
                setSessions((prev) =>
                    prev.map((s) =>
                        s.name === sessionName
                            ? { ...s, status: status as AgentSessionStatus }
                            : s
                    )
                );
            },

            onSessionCreated: ({ sessionName, worktreePath }) => {
                // Only add if not already present
                setSessions((prev) => {
                    if (prev.some((s) => s.name === sessionName)) return prev;

                    const newSession: SessionInfo = {
                        name: sessionName,
                        worktreePath,
                        branch: '',
                        data: { sessionId: sessionName },
                        status: { status: 'idle' },
                        workflowStatus: { active: false },
                        isPinned: false,
                    };
                    return [...prev, newSession];
                });
            },

            onSessionDeleted: ({ sessionName }) => {
                setSessions((prev) => prev.filter((s) => s.name !== sessionName));
            },
        };

        sseClient.setCallbacks(callbacks);
        sseClient.connect();

        return () => {
            sseClient.disconnect();
        };
    }, [sseClient]);

    // ---------------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------------

    const createSession = useCallback(
        async (params: CreateSessionRequest) => {
            if (!apiClient) throw new Error('No API client available');
            await apiClient.createSession(params);
            // SSE will fire session_created — but also refresh to get full data
            refresh();
        },
        [apiClient, refresh]
    );

    const deleteSession = useCallback(
        async (name: string) => {
            if (!apiClient) throw new Error('No API client available');
            await apiClient.deleteSession(name);
            // Optimistic removal; SSE will also fire session_deleted
            setSessions((prev) => prev.filter((s) => s.name !== name));
        },
        [apiClient]
    );

    const pinSession = useCallback(
        async (name: string) => {
            if (!apiClient) throw new Error('No API client available');
            const updated = await apiClient.pinSession(name);
            setSessions((prev) =>
                prev.map((s) => (s.name === name ? { ...s, isPinned: updated.isPinned } : s))
            );
        },
        [apiClient]
    );

    const unpinSession = useCallback(
        async (name: string) => {
            if (!apiClient) throw new Error('No API client available');
            const updated = await apiClient.unpinSession(name);
            setSessions((prev) =>
                prev.map((s) => (s.name === name ? { ...s, isPinned: updated.isPinned } : s))
            );
        },
        [apiClient]
    );

    return {
        sessions,
        loading,
        error,
        refresh,
        createSession,
        deleteSession,
        pinSession,
        unpinSession,
    };
}
