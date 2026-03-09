/**
 * Extended Playwright test fixture with API route mocking helpers.
 *
 * Intercepts fetch() calls at the browser level via page.route(), returning
 * canned responses. No real gateway or daemon server needed.
 */

import { test as base, type Page, type Route } from '@playwright/test';
import {
    makeDaemonInfo,
    makeHealthResponse,
    makeDiscoveryInfo,
    makeSessionListResponse,
    makeDiffFilesResult,
    makeDiffResult,
    makeWorktreeInfo,
    makeWorkflowState,
    makeInsightsResponse,
    makeAgentInfo,
    makeGitBranchesResponse,
    type DaemonInfo,
    type SessionInfo,
    type WorkflowInfo,
} from './test-data';

// ---------------------------------------------------------------------------
// MockApi helper class
// ---------------------------------------------------------------------------

export class MockApi {
    private daemons: DaemonInfo[] = [];
    private daemonEndpoints = new Map<number, Record<string, unknown>>();
    private interceptedRequests: { method: string; url: string }[] = [];

    constructor(private readonly page: Page) {}

    /** Configure the gateway to return these daemons. */
    withDaemons(daemons: DaemonInfo[]): this {
        this.daemons = daemons;
        return this;
    }

    /** Configure a single default daemon with one session. */
    withDefaultDaemon(sessions: SessionInfo[] = []): this {
        const daemon = makeDaemonInfo();
        this.daemons = [daemon];
        this.withDaemonEndpoints(daemon.port, {
            '/api/v1/health': makeHealthResponse(),
            '/api/v1/discovery': makeDiscoveryInfo({ port: daemon.port }),
            '/api/v1/sessions': makeSessionListResponse(sessions),
            '/api/v1/agents': { agents: [makeAgentInfo()] },
            '/api/v1/git/branches': makeGitBranchesResponse(),
            '/api/v1/workflows': { workflows: [] },
            '/api/v1/config': { config: {} },
            '/api/v1/terminals': { terminals: [] },
        });
        return this;
    }

    /** Register canned responses for a daemon's endpoints (keyed by path). */
    withDaemonEndpoints(port: number, endpoints: Record<string, unknown>): this {
        const existing = this.daemonEndpoints.get(port) ?? {};
        this.daemonEndpoints.set(port, { ...existing, ...endpoints });
        return this;
    }

    /** Install all route interceptors. Call this before navigating. */
    async install(): Promise<void> {
        // Gateway: /api/gateway/daemons
        await this.page.route('**/api/gateway/daemons', (route) => {
            this.recordRequest(route);
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(this.daemons),
            });
        });

        // Daemon endpoints: intercept by URL pattern
        for (const [port, endpoints] of this.daemonEndpoints.entries()) {
            for (const [path, response] of Object.entries(endpoints)) {
                // Match requests to this daemon's port + path
                await this.page.route(
                    (url) => this.matchDaemonRoute(url, port, path),
                    (route) => {
                        this.recordRequest(route);
                        return route.fulfill({
                            status: 200,
                            contentType: 'application/json',
                            body: JSON.stringify(response),
                        });
                    },
                );
            }
        }

        // SSE events endpoint: return an empty stream that stays open briefly
        for (const [port] of this.daemonEndpoints.entries()) {
            await this.page.route(
                (url) => this.matchDaemonRoute(url, port, '/api/v1/events'),
                (route) => {
                    this.recordRequest(route);
                    return route.fulfill({
                        status: 200,
                        contentType: 'text/event-stream',
                        headers: {
                            'Cache-Control': 'no-cache',
                            Connection: 'keep-alive',
                        },
                        body: ':ok\n\n',
                    });
                },
            );
        }
    }

    /** Register a handler for a specific daemon endpoint with custom logic. */
    async route(
        port: number,
        path: string,
        handler: (route: Route) => Promise<void> | void,
    ): Promise<void> {
        await this.page.route(
            (url) => this.matchDaemonRoute(url, port, path),
            (route) => {
                this.recordRequest(route);
                return handler(route);
            },
        );
    }

    /** Update a canned response for a specific daemon endpoint after install. */
    updateResponse(port: number, path: string, response: unknown): void {
        const endpoints = this.daemonEndpoints.get(port) ?? {};
        endpoints[path] = response;
        this.daemonEndpoints.set(port, endpoints);
    }

    /** Get recorded requests for assertions. */
    getRequests(): { method: string; url: string }[] {
        return [...this.interceptedRequests];
    }

    /** Get the default daemon port (first daemon). */
    get defaultPort(): number {
        return this.daemons[0]?.port ?? 9100;
    }

    // -------------------------------------------------------------------------

    private matchDaemonRoute(url: URL, port: number, path: string): boolean {
        if (url.port !== String(port)) return false;
        // Match the path exactly, or as a prefix for parameterized routes
        if (url.pathname === path) return true;
        // Handle parameterized paths like /api/v1/sessions/:name/...
        if (path.includes(':')) {
            const pattern = path.replace(/:[^/]+/g, '[^/]+');
            return new RegExp(`^${pattern}$`).test(url.pathname);
        }
        return false;
    }

    private recordRequest(route: Route): void {
        const request = route.request();
        this.interceptedRequests.push({
            method: request.method(),
            url: request.url(),
        });
    }
}

// ---------------------------------------------------------------------------
// Extended test fixture
// ---------------------------------------------------------------------------

export const test = base.extend<{ mockApi: MockApi }>({
    mockApi: async ({ page }, use) => {
        const mock = new MockApi(page);
        await use(mock);
    },
});

export { expect } from '@playwright/test';

// Re-export test data factories for convenience
export {
    makeDaemonInfo,
    makeHealthResponse,
    makeDiscoveryInfo,
    makeSessionInfo,
    makeSessionListResponse,
    makeDiffFilesResult,
    makeDiffResult,
    makeWorktreeInfo,
    makeWorkflowState,
    makeInsightsResponse,
    makeAgentInfo,
    makeWorkflowInfo,
    makeGitBranchesResponse,
} from './test-data';
