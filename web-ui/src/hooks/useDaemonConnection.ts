/**
 * useDaemonConnection — resolves a DaemonApiClient and DaemonSseClient for a
 * specific project ID by looking it up in the gateway project list.
 *
 * Returns null for both clients while the gateway list is being fetched, or
 * when the project does not correspond to a known registered project.
 */

import { useState, useEffect, useRef } from 'react';
import { fetchProjects } from '../api/gateway';
import { DaemonApiClient } from '../api/client';
import { DaemonSseClient } from '../api/sse';
import type { GatewayProjectInfo } from '../api/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DaemonConnection {
    /** Typed REST client for the daemon at the given port */
    apiClient: DaemonApiClient | null;
    /** SSE client connected to the daemon at the given port */
    sseClient: DaemonSseClient | null;
    /** True while the gateway lookup is in progress */
    loading: boolean;
    /** Set when the gateway fetch fails or the port is not found */
    error: Error | null;
    /** Matching project entry from gateway registry, if found */
    daemonInfo: GatewayProjectInfo | null;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const DAEMON_LIST_CACHE_TTL_MS = 30_000;
let daemonListCache: { data: GatewayProjectInfo[]; expiresAt: number } | null = null;
let daemonListInFlight: Promise<GatewayProjectInfo[]> | null = null;

async function getDaemonsCached(): Promise<GatewayProjectInfo[]> {
    const now = Date.now();
    if (daemonListCache !== null && daemonListCache.expiresAt > now) {
        return daemonListCache.data;
    }
    if (daemonListInFlight !== null) {
        return daemonListInFlight;
    }
    daemonListInFlight = fetchProjects()
        .then((data) => {
            daemonListCache = { data, expiresAt: Date.now() + DAEMON_LIST_CACHE_TTL_MS };
            return data;
        })
        .finally(() => {
            daemonListInFlight = null;
        });
    return daemonListInFlight;
}

export function __resetDaemonConnectionCacheForTests(): void {
    daemonListCache = null;
    daemonListInFlight = null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Resolves the token for `projectId` from the gateway, then constructs a
 * DaemonApiClient and DaemonSseClient.  The SSE client is NOT auto-connected
 * here — callers are responsible for calling sseClient.connect() and
 * sseClient.disconnect() themselves (typically via useSessions).
 */
export function useDaemonConnection(projectId: string | undefined): DaemonConnection {
    const [apiClient, setApiClient] = useState<DaemonApiClient | null>(null);
    const [sseClient, setSseClient] = useState<DaemonSseClient | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [daemonInfo, setDaemonInfo] = useState<GatewayProjectInfo | null>(null);

    // Keep refs so cleanup does not need to re-run when state changes
    const sseClientRef = useRef<DaemonSseClient | null>(null);

    useEffect(() => {
        if (projectId === undefined) {
            setLoading(false);
            setError(null);
            setApiClient(null);
            setSseClient(null);
            setDaemonInfo(null);
            return;
        }

        let cancelled = false;

        async function resolve() {
            setLoading(true);
            setError(null);

            try {
                const projects = await getDaemonsCached();
                if (cancelled) return;

                const project = projects.find((entry) => entry.projectId === projectId);
                if (!project) {
                    setError(new Error(`Unknown project: ${projectId}`));
                    setApiClient(null);
                    setSseClient(null);
                    setDaemonInfo(null);
                    return;
                }

                const daemon = project.daemon;
                if (!daemon) {
                    setError(new Error(`Global daemon is not running for project ${project.projectName}`));
                    setApiClient(null);
                    setSseClient(null);
                    setDaemonInfo(project);
                    return;
                }

                const baseUrl = `http://127.0.0.1:${daemon.port}`;

                const client = new DaemonApiClient({ baseUrl, token: daemon.token, projectId });
                const sse = new DaemonSseClient({ baseUrl, token: daemon.token, projectId });

                if (cancelled) return;

                // Disconnect any previous SSE client
                sseClientRef.current?.disconnect();
                sseClientRef.current = sse;

                setApiClient(client);
                setSseClient(sse);
                setDaemonInfo(project);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
                setApiClient(null);
                setSseClient(null);
                setDaemonInfo(null);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        void resolve();

        return () => {
            cancelled = true;
            sseClientRef.current?.disconnect();
        };
    }, [projectId]);

    // Disconnect SSE on unmount
    useEffect(() => {
        return () => {
            sseClientRef.current?.disconnect();
            sseClientRef.current = null;
        };
    }, []);

    return { apiClient, sseClient, loading, error, daemonInfo };
}
