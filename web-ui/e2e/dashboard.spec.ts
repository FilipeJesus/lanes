import { test, expect, makeDaemonInfo, makeProjectInfo, makeHealthResponse, makeDiscoveryInfo } from './fixtures/base';

test.describe('Dashboard', () => {
    test('shows project cards for running daemons', async ({ page, mockApi }) => {
        const daemon1 = makeDaemonInfo({ projectId: 'project-my-app', port: 9100, projectName: 'my-app' });
        const daemon2 = makeDaemonInfo({
            projectId: 'project-my-api',
            port: 9200,
            projectName: 'my-api',
            workspaceRoot: '/home/user/projects/my-api',
        });

        mockApi.withProjects([
            makeProjectInfo({ projectId: daemon1.projectId, projectName: daemon1.projectName, workspaceRoot: daemon1.workspaceRoot, daemon: daemon1 }),
            makeProjectInfo({ projectId: daemon2.projectId, projectName: daemon2.projectName, workspaceRoot: daemon2.workspaceRoot, daemon: daemon2 }),
        ]);
        mockApi.withDaemonEndpoints(9100, {
            '/api/v1/health': makeHealthResponse(),
            '/api/v1/projects/project-my-app/discovery': makeDiscoveryInfo({ projectId: 'project-my-app', projectName: 'my-app', port: 9100, sessionCount: 3 }),
        });
        mockApi.withDaemonEndpoints(9200, {
            '/api/v1/health': makeHealthResponse(),
            '/api/v1/projects/project-my-api/discovery': makeDiscoveryInfo({ projectId: 'project-my-api', projectName: 'my-api', workspaceRoot: '/home/user/projects/my-api', port: 9200, sessionCount: 1 }),
        });
        await mockApi.install();

        await page.goto('/');
        await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
        // Use role-based locators to avoid matching git remote URLs
        await expect(page.getByRole('button', { name: /open project my-app/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /open project my-api/i })).toBeVisible();
    });

    test('shows empty state when no daemons are running', async ({ page, mockApi }) => {
        mockApi.withProjects([]);
        await mockApi.install();

        await page.goto('/');
        await expect(page.getByText(/no projects registered/i)).toBeVisible();
    });

    test('clicking a project card navigates to project detail', async ({ page, mockApi }) => {
        mockApi.withDefaultDaemon();
        mockApi.withDaemonEndpoints(9100, {
            '/api/v1/health': makeHealthResponse(),
            '/api/v1/projects/project-my-app/discovery': makeDiscoveryInfo({ projectId: 'project-my-app', projectName: 'my-app', port: 9100 }),
        });
        await mockApi.install();

        await page.goto('/');
        await page.getByRole('button', { name: /open project my-app/i }).click();
        await expect(page).toHaveURL(/\/project\/project-my-app$/);
    });

    test('registered offline projects route to actionable setup guidance', async ({ page, mockApi }) => {
        mockApi.withProjects([
            makeProjectInfo({
                projectId: 'project-offline-app',
                projectName: 'offline-app',
                workspaceRoot: '/home/user/projects/offline-app',
                daemon: null,
            }),
        ]);
        await mockApi.install();

        await page.goto('/');
        await expect(page.getByRole('button', { name: /open project offline-app/i })).toBeVisible();
        await expect(page.getByText(/ready to start/i)).toBeVisible();

        await page.getByRole('button', { name: /open project offline-app/i }).click();

        await expect(page).toHaveURL(/\/project\/project-offline-app$/);
        await expect(page.getByText(/daemon is offline/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /refresh connection/i })).toBeVisible();
    });
});
