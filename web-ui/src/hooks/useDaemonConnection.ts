/**
 * useDaemonConnection — resolves a DaemonApiClient and DaemonSseClient for a
 * specific daemon port by looking it up in the gateway daemon list.
 *
 * Returns null for both clients while the gateway list is being fetched, or
 * when the port does not correspond to a known daemon.
 */

import { useState, useEffect, useRef } from 'react';
import { fetchDaemons } from '../api/gateway';
import { DaemonApiClient } from '../api/client';
import { DaemonSseClient } from '../api/sse';
import type { DaemonInfo } from '../api/types';

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
    /** Matching daemon entry from gateway registry, if found */
    daemonInfo: DaemonInfo | null;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const DAEMON_LIST_CACHE_TTL_MS = 30_000;
let daemonListCache: { data: DaemonInfo[]; expiresAt: number } | null = null;
let daemonListInFlight: Promise<DaemonInfo[]> | null = null;

async function getDaemonsCached(): Promise<DaemonInfo[]> {
    const now = Date.now();
    if (daemonListCache !== null && daemonListCache.expiresAt > now) {
        return daemonListCache.data;
    }
    if (daemonListInFlight !== null) {
        return daemonListInFlight;
    }
    daemonListInFlight = fetchDaemons()
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
 * Resolves the token for `port` from the gateway, then constructs a
 * DaemonApiClient and DaemonSseClient.  The SSE client is NOT auto-connected
 * here — callers are responsible for calling sseClient.connect() and
 * sseClient.disconnect() themselves (typically via useSessions).
 */
export function useDaemonConnection(port: number | string | undefined): DaemonConnection {
    const [apiClient, setApiClient] = useState<DaemonApiClient | null>(null);
    const [sseClient, setSseClient] = useState<DaemonSseClient | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [daemonInfo, setDaemonInfo] = useState<DaemonInfo | null>(null);

    // Keep refs so cleanup does not need to re-run when state changes
    const sseClientRef = useRef<DaemonSseClient | null>(null);

    useEffect(() => {
        if (port === undefined) {
            setLoading(false);
            setError(null);
            setApiClient(null);
            setSseClient(null);
            setDaemonInfo(null);
            return;
        }

        const portNum = typeof port === 'string' ? parseInt(port, 10) : port;
        if (!Number.isFinite(portNum)) {
            setLoading(false);
            setError(new Error(`Invalid port: ${port}`));
            return;
        }

        let cancelled = false;

        async function resolve() {
            setLoading(true);
            setError(null);

            try {
                const daemons = await getDaemonsCached();
                if (cancelled) return;

                const daemon = daemons.find((d) => d.port === portNum);
                if (!daemon) {
                    setError(new Error(`No daemon running on port ${portNum}`));
                    setApiClient(null);
                    setSseClient(null);
                    setDaemonInfo(null);
                    return;
                }

                const baseUrl = `http://127.0.0.1:${daemon.port}`;

                const client = new DaemonApiClient({ baseUrl, token: daemon.token });
                const sse = new DaemonSseClient({ baseUrl, token: daemon.token });

                if (cancelled) return;

                // Disconnect any previous SSE client
                sseClientRef.current?.disconnect();
                sseClientRef.current = sse;

                setApiClient(client);
                setSseClient(sse);
                setDaemonInfo(daemon);
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
    }, [port]);

    // Disconnect SSE on unmount
    useEffect(() => {
        return () => {
            sseClientRef.current?.disconnect();
            sseClientRef.current = null;
        };
    }, []);

    return { apiClient, sseClient, loading, error, daemonInfo };
}
