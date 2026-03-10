/**
 * Extended Playwright test fixture with API route mocking helpers.
 *
 * Intercepts fetch() calls at the browser level via page.route(), returning
 * canned responses. No real gateway or daemon server needed.
 */

import { test as base, type Page, type Route } from '@playwright/test';
import {
    makeDaemonInfo,
    makeProjectInfo,
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
    type GatewayProjectInfo,
    type SessionInfo,
    type WorkflowInfo,
} from './test-data';

// ---------------------------------------------------------------------------
// MockApi helper class
// ---------------------------------------------------------------------------

export class MockApi {
    private projects: GatewayProjectInfo[] = [];
    private daemonEndpoints = new Map<number, Record<string, unknown>>();
    private interceptedRequests: { method: string; url: string }[] = [];

    constructor(private readonly page: Page) {}

    /** Configure the gateway to return these projects. */
    withProjects(projects: GatewayProjectInfo[]): this {
        this.projects = projects;
        return this;
    }

    /** Backward-compatible helper that wraps daemons as running projects. */
    withDaemons(daemons: DaemonInfo[]): this {
        this.projects = daemons.map((daemon) =>
            makeProjectInfo({
                projectId: daemon.projectId,
                projectName: daemon.projectName,
                workspaceRoot: daemon.workspaceRoot,
                daemon,
            }),
        );
        return this;
    }

    /** Configure a single default daemon with one session. */
    withDefaultDaemon(sessions: SessionInfo[] = []): this {
        const daemon = makeDaemonInfo();
        this.projects = [
            makeProjectInfo({
                projectId: daemon.projectId,
                projectName: daemon.projectName,
                workspaceRoot: daemon.workspaceRoot,
                daemon,
            }),
        ];
        const projectPath = `/api/v1/projects/${encodeURIComponent(daemon.projectId)}`;
        this.withDaemonEndpoints(daemon.port, {
            '/api/v1/health': makeHealthResponse(),
            [`${projectPath}/discovery`]: makeDiscoveryInfo({ projectId: daemon.projectId, projectName: daemon.projectName, workspaceRoot: daemon.workspaceRoot, port: daemon.port }),
            [`${projectPath}/sessions`]: makeSessionListResponse(sessions),
            [`${projectPath}/agents`]: { agents: [makeAgentInfo()] },
            [`${projectPath}/git/branches`]: makeGitBranchesResponse(),
            [`${projectPath}/workflows`]: { workflows: [] },
            [`${projectPath}/config`]: { config: {} },
            [`${projectPath}/terminals`]: { terminals: [] },
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
        await this.page.route('**/api/gateway/projects', (route) => {
            this.recordRequest(route);
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(this.projects),
            });
        });

        // Compatibility for any legacy callers still hitting the old endpoint.
        await this.page.route('**/api/gateway/daemons', (route) => {
            this.recordRequest(route);
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(this.projects.map((project) => project.daemon).filter(Boolean)),
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
        return this.projects[0]?.daemon?.port ?? 9100;
    }

    /** Get the default project id (first project). */
    get defaultProjectId(): string {
        return this.projects[0]?.projectId ?? 'project-my-app';
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
    makeProjectInfo,
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
