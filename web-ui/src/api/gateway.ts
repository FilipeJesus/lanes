/**
 * Gateway API client
 *
 * Wraps the gateway server endpoints served at /api/gateway/*.
 * In development, Vite proxies /api/gateway/* to http://localhost:3847.
 * In production, these are served directly by the gateway server.
 */

import type { DaemonInfo, GatewayProjectInfo } from './types';

/**
 * Fetch the list of all currently running Lanes daemons from the gateway server.
 * Returns an array of DaemonInfo objects, each containing the daemon's port,
 * token, workspace root, and project name.
 *
 * The gateway automatically filters out stale (dead) daemon entries.
 */
export async function fetchDaemons(): Promise<DaemonInfo[]> {
    const res = await fetch('/api/gateway/daemons');
    if (!res.ok) {
        throw new Error(`Failed to fetch daemons: HTTP ${res.status}`);
    }
    return res.json() as Promise<DaemonInfo[]>;
}

/**
 * Fetch the list of projects known to the machine-wide gateway, including
 * whether each project currently has a running daemon attached.
 */
export async function fetchProjects(): Promise<GatewayProjectInfo[]> {
    const res = await fetch('/api/gateway/projects');
    if (!res.ok) {
        throw new Error(`Failed to fetch projects: HTTP ${res.status}`);
    }
    return res.json() as Promise<GatewayProjectInfo[]>;
}
