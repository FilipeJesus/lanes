/**
 * useDaemons — custom hook for discovering registered projects and enriching
 * running ones with daemon discovery/health data.
 *
 * Fetches the project list from the gateway on mount and on a periodic interval.
 * For projects with a live daemon, calls getDiscovery() and getHealth() to
 * determine runtime details. Health is polled every 30 seconds; the project
 * list is refreshed every 60 seconds.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchProjects } from '../api/gateway';
import { DaemonApiClient } from '../api/client';
import type { DaemonInfo, DiscoveryInfo, GatewayProjectInfo, HealthResponse } from '../api/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthState = 'healthy' | 'degraded' | 'unreachable' | 'registered';

export interface EnrichedDaemon {
    /** Base project info from the gateway registry */
    project: GatewayProjectInfo;
    /** Running daemon info, if available */
    daemon: DaemonInfo | null;
    /** Discovery info fetched from the daemon's /api/v1/discovery endpoint */
    discovery: DiscoveryInfo | null;
    /** Current health state */
    health: HealthState;
    /** Raw health response, if available */
    healthResponse: HealthResponse | null;
}

export interface UseDaemonsResult {
    daemons: EnrichedDaemon[];
    loading: boolean;
    error: Error | null;
    refresh: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAEMON_LIST_REFRESH_INTERVAL_MS = 60_000;
const HEALTH_POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildClient(daemon: DaemonInfo): DaemonApiClient {
    return new DaemonApiClient({
        baseUrl: `http://127.0.0.1:${daemon.port}`,
        token: daemon.token,
    });
}

async function enrichDaemon(project: GatewayProjectInfo): Promise<EnrichedDaemon> {
    const daemon = project.daemon;

    if (!daemon) {
        return {
            project,
            daemon: null,
            discovery: null,
            health: 'registered',
            healthResponse: null,
        };
    }

    const client = buildClient(daemon);

    let discovery: DiscoveryInfo | null = null;
    let health: HealthState = 'unreachable';
    let healthResponse: HealthResponse | null = null;

    try {
        // Fetch discovery and health in parallel
        const [discoveryResult, healthResult] = await Promise.allSettled([
            client.getDiscovery(),
            client.getHealth(),
        ]);

        if (discoveryResult.status === 'fulfilled') {
            discovery = discoveryResult.value;
        }

        if (healthResult.status === 'fulfilled') {
            healthResponse = healthResult.value;
            health = healthResult.value.status === 'ok' ? 'healthy' : 'degraded';
        } else if (discoveryResult.status === 'fulfilled') {
            // Discovery succeeded but health failed — daemon is degraded
            health = 'degraded';
        }
        // If both fail, health remains 'unreachable'
    } catch {
        // Unexpected error — daemon is unreachable
        health = 'unreachable';
    }

    return { project, daemon, discovery, health, healthResponse };
}

async function pollHealth(enriched: EnrichedDaemon): Promise<EnrichedDaemon> {
    if (!enriched.daemon) {
        return enriched;
    }

    const client = buildClient(enriched.daemon);

    try {
        const healthResponse = await client.getHealth();
        const health: HealthState = healthResponse.status === 'ok' ? 'healthy' : 'degraded';
        return { ...enriched, health, healthResponse };
    } catch {
        return { ...enriched, health: 'unreachable', healthResponse: null };
    }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDaemons(): UseDaemonsResult {
    const [daemons, setDaemons] = useState<EnrichedDaemon[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [refreshCounter, setRefreshCounter] = useState(0);

    // Keep a ref to the current daemons so the health poller can read them
    // without causing stale closure issues
    const daemonsRef = useRef<EnrichedDaemon[]>([]);
    daemonsRef.current = daemons;

    const refresh = useCallback(() => {
        setRefreshCounter((c) => c + 1);
    }, []);

    // Primary effect: fetch + enrich the daemon list
    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);

            try {
                const rawProjects = await fetchProjects();
                if (cancelled) return;

                const enriched = await Promise.all(rawProjects.map(enrichDaemon));
                if (cancelled) return;

                setDaemons(enriched);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
                setDaemons([]);
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
    // refreshCounter triggers a manual refresh; the auto-interval also bumps it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshCounter]);

    // Auto-refresh daemon list on interval
    useEffect(() => {
        const id = setInterval(() => {
            setRefreshCounter((c) => c + 1);
        }, DAEMON_LIST_REFRESH_INTERVAL_MS);

        return () => clearInterval(id);
    }, []);

    // Health polling effect: polls health for each daemon independently
    useEffect(() => {
        if (daemons.length === 0) return;

        const id = setInterval(async () => {
            const current = daemonsRef.current;
            if (current.length === 0) return;

            const updated = await Promise.all(current.map(pollHealth));
            setDaemons(updated);
        }, HEALTH_POLL_INTERVAL_MS);

        return () => clearInterval(id);
    // Only re-register the interval when the daemon list identity changes
    // (i.e., when daemons are added or removed, not on each health update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [daemons.length]);

    return { daemons, loading, error, refresh };
}
