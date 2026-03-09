import { test, expect, makeDaemonInfo, makeHealthResponse, makeDiscoveryInfo } from './fixtures/base';

test.describe('Dashboard', () => {
    test('shows project cards for running daemons', async ({ page, mockApi }) => {
        const daemon1 = makeDaemonInfo({ port: 9100, projectName: 'my-app' });
        const daemon2 = makeDaemonInfo({ port: 9200, projectName: 'my-api', workspaceRoot: '/home/user/projects/my-api' });

        mockApi.withDaemons([daemon1, daemon2]);
        mockApi.withDaemonEndpoints(9100, {
            '/api/v1/health': makeHealthResponse(),
            '/api/v1/discovery': makeDiscoveryInfo({ projectName: 'my-app', port: 9100, sessionCount: 3 }),
        });
        mockApi.withDaemonEndpoints(9200, {
            '/api/v1/health': makeHealthResponse(),
            '/api/v1/discovery': makeDiscoveryInfo({ projectName: 'my-api', port: 9200, sessionCount: 1 }),
        });
        await mockApi.install();

        await page.goto('/');
        await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
        // Use role-based locators to avoid matching git remote URLs
        await expect(page.getByRole('button', { name: /open project my-app/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /open project my-api/i })).toBeVisible();
    });

    test('shows empty state when no daemons are running', async ({ page, mockApi }) => {
        mockApi.withDaemons([]);
        await mockApi.install();

        await page.goto('/');
        await expect(page.getByText(/no.*running/i)).toBeVisible();
    });

    test('clicking a project card navigates to project detail', async ({ page, mockApi }) => {
        mockApi.withDefaultDaemon();
        mockApi.withDaemonEndpoints(9100, {
            '/api/v1/health': makeHealthResponse(),
            '/api/v1/discovery': makeDiscoveryInfo({ projectName: 'my-app', port: 9100 }),
        });
        await mockApi.install();

        await page.goto('/');
        await page.getByRole('button', { name: /open project my-app/i }).click();
        await expect(page).toHaveURL(/\/project\/9100/);
    });
});
