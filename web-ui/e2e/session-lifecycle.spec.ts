import { test, expect, makeSessionInfo, makeAgentInfo, makeGitBranchesResponse } from './fixtures/base';

test.describe('Session Lifecycle', () => {
    test('create session dialog opens and closes', async ({ page, mockApi }) => {
        mockApi.withDefaultDaemon([]);
        await mockApi.install();

        await page.goto(`/project/${mockApi.defaultProjectId}`);
        // Use first() since empty state and header both have "Create Session" button
        await page.getByRole('button', { name: /create session/i }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();

        // Close with Cancel
        await page.getByRole('button', { name: /cancel/i }).click();
        await expect(page.getByRole('dialog')).not.toBeVisible();
    });

    test('create session dialog populates selects from API', async ({ page, mockApi }) => {
        mockApi.withDefaultDaemon([]);
        mockApi.withDaemonEndpoints(mockApi.defaultPort, {
            [`/api/v1/projects/${mockApi.defaultProjectId}/agents`]: {
                agents: [
                    makeAgentInfo({ name: 'claude', displayName: 'Claude Code' }),
                    makeAgentInfo({ name: 'codex', displayName: 'Codex CLI' }),
                ],
            },
            [`/api/v1/projects/${mockApi.defaultProjectId}/git/branches`]: makeGitBranchesResponse([
                { name: 'main', isRemote: false },
                { name: 'develop', isRemote: false },
            ]),
        });
        await mockApi.install();

        await page.goto(`/project/${mockApi.defaultProjectId}`);
        await page.getByRole('button', { name: /create session/i }).first().click();

        // Agent select should have options
        const agentSelect = page.locator('select').filter({ hasText: /claude/i });
        await expect(agentSelect).toBeVisible();
    });

    test('delete session shows confirmation and removes on confirm', async ({ page, mockApi }) => {
        const session = makeSessionInfo({ name: 'to-delete' });
        mockApi.withDefaultDaemon([session]);
        await mockApi.route(mockApi.defaultPort, `/api/v1/projects/${mockApi.defaultProjectId}/sessions/to-delete`, (route) => {
            if (route.request().method() === 'DELETE') {
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
            }
            return route.continue();
        });
        await mockApi.install();

        await page.goto(`/project/${mockApi.defaultProjectId}`);
        await expect(page.getByRole('button', { name: /open session to-delete/i })).toBeVisible();

        // Click delete button
        await page.getByRole('button', { name: /delete session to-delete/i }).click();

        // Confirmation dialog should appear
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByText(/are you sure/i)).toBeVisible();

        // Confirm deletion
        await page.getByRole('button', { name: /^delete$/i }).click();

        // Session should be removed (optimistic removal)
        await expect(page.getByRole('button', { name: /open session to-delete/i })).not.toBeVisible();
    });

    test('delete session cancel keeps session', async ({ page, mockApi }) => {
        const session = makeSessionInfo({ name: 'keep-me' });
        mockApi.withDefaultDaemon([session]);
        await mockApi.install();

        await page.goto(`/project/${mockApi.defaultProjectId}`);
        await page.getByRole('button', { name: /delete session keep-me/i }).click();
        await expect(page.getByRole('dialog')).toBeVisible();

        await page.getByRole('button', { name: /cancel/i }).click();
        await expect(page.getByRole('dialog')).not.toBeVisible();
        await expect(page.getByRole('button', { name: /open session keep-me/i })).toBeVisible();
    });

    test('pin toggle updates session state', async ({ page, mockApi }) => {
        const session = makeSessionInfo({ name: 'pin-me', isPinned: false });
        mockApi.withDefaultDaemon([session]);
        await mockApi.route(mockApi.defaultPort, `/api/v1/projects/${mockApi.defaultProjectId}/sessions/pin-me/pin`, (route) => {
            if (route.request().method() === 'POST') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ ...session, isPinned: true }),
                });
            }
            return route.continue();
        });
        await mockApi.install();

        await page.goto(`/project/${mockApi.defaultProjectId}`);
        await page.getByRole('button', { name: /pin session pin-me/i }).click();
        await expect(page.getByText('Pinned')).toBeVisible();
    });
});
