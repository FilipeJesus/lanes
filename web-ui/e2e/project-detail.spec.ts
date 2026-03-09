import { test, expect, makeSessionInfo } from './fixtures/base';

test.describe('Project Detail', () => {
    test('shows session list', async ({ page, mockApi }) => {
        const sessions = [
            makeSessionInfo({ name: 'feat-login', status: { status: 'working' } }),
            makeSessionInfo({ name: 'fix-bug-42', status: { status: 'idle' } }),
        ];
        mockApi.withDefaultDaemon(sessions);
        await mockApi.install();

        await page.goto(`/project/${mockApi.defaultPort}`);
        await expect(page.getByRole('button', { name: /open session feat-login/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /open session fix-bug-42/i })).toBeVisible();
        await expect(page.getByText('2 sessions')).toBeVisible();
    });

    test('shows empty state with no sessions', async ({ page, mockApi }) => {
        mockApi.withDefaultDaemon([]);
        await mockApi.install();

        await page.goto(`/project/${mockApi.defaultPort}`);
        await expect(page.getByText(/no sessions yet/i)).toBeVisible();
    });

    test('pinned sessions sort first', async ({ page, mockApi }) => {
        const sessions = [
            makeSessionInfo({ name: 'unpinned-first', isPinned: false }),
            makeSessionInfo({ name: 'pinned-session', isPinned: true }),
        ];
        mockApi.withDefaultDaemon(sessions);
        await mockApi.install();

        await page.goto(`/project/${mockApi.defaultPort}`);

        // Pinned should appear before unpinned in DOM order
        const cards = page.locator('[role="button"][aria-label^="Open session"]');
        await expect(cards).toHaveCount(2);
        await expect(cards.first()).toContainText('pinned-session');
        await expect(cards.last()).toContainText('unpinned-first');
    });

    test('sessions with null status render without crashing', async ({ page, mockApi }) => {
        const sessions = [
            makeSessionInfo({ name: 'no-agent', status: null, workflowStatus: null }),
        ];
        mockApi.withDefaultDaemon(sessions);
        await mockApi.install();

        await page.goto(`/project/${mockApi.defaultPort}`);
        await expect(page.getByRole('button', { name: /open session no-agent/i })).toBeVisible();
        // Should fall back to 'idle' status badge
        await expect(page.getByText('Idle')).toBeVisible();
    });

    test('breadcrumb navigates back to dashboard', async ({ page, mockApi }) => {
        mockApi.withDefaultDaemon();
        await mockApi.install();

        await page.goto(`/project/${mockApi.defaultPort}`);
        await page.getByRole('link', { name: 'Projects' }).click();
        await expect(page).toHaveURL('/');
    });
});
