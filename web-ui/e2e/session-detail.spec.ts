import {
    test,
    expect,
    MockApi,
    makeSessionInfo,
    makeWorktreeInfo,
    makeWorkflowState,
    makeDiffFilesResult,
    makeDiffResult,
    makeInsightsResponse,
} from './fixtures/base';

test.describe('Session Detail', () => {
    const PROJECT_ID = 'project-my-app';
    const SESSION_NAME = 'test-session';

    function setupSessionDetail(
        mockApi: MockApi,
        sessionOverrides: Partial<ReturnType<typeof makeSessionInfo>> = {},
    ) {
        const session = makeSessionInfo({ name: SESSION_NAME, ...sessionOverrides });
        mockApi.withDefaultDaemon([session]);
        mockApi.withDaemonEndpoints(mockApi.defaultPort, {
            [`/api/v1/projects/${PROJECT_ID}/sessions/test-session/worktree`]: makeWorktreeInfo({ branch: 'test-session', commit: 'abc1234567890def' }),
            [`/api/v1/projects/${PROJECT_ID}/sessions/test-session/workflow`]: makeWorkflowState(),
            [`/api/v1/projects/${PROJECT_ID}/sessions/test-session/diff/files`]: makeDiffFilesResult(),
            [`/api/v1/projects/${PROJECT_ID}/sessions/test-session/diff`]: makeDiffResult(),
            [`/api/v1/projects/${PROJECT_ID}/sessions/test-session/insights`]: makeInsightsResponse(),
        });
    }

    test('shows session status card', async ({ page, mockApi }) => {
        setupSessionDetail(mockApi, { status: { status: 'working' } });
        await mockApi.install();

        await page.goto(`/project/${PROJECT_ID}/session/${SESSION_NAME}`);
        await expect(page.getByRole('heading', { name: SESSION_NAME })).toBeVisible();
        await expect(page.getByText('Working').first()).toBeVisible();
    });

    test('shows idle for null status', async ({ page, mockApi }) => {
        setupSessionDetail(mockApi, { status: null, workflowStatus: null });
        await mockApi.install();

        await page.goto(`/project/${PROJECT_ID}/session/${SESSION_NAME}`);
        await expect(page.getByRole('heading', { name: SESSION_NAME })).toBeVisible();
        await expect(page.getByText('Idle').first()).toBeVisible();
    });

    test('shows worktree info card', async ({ page, mockApi }) => {
        setupSessionDetail(mockApi);
        await mockApi.install();

        await page.goto(`/project/${PROJECT_ID}/session/${SESSION_NAME}`);
        // Worktree card heading
        await expect(page.getByRole('heading', { name: 'Worktree' })).toBeVisible();
        // Branch is displayed (from session fallback)
        await expect(page.getByRole('heading', { name: 'Worktree' }).locator('..').getByText(SESSION_NAME).first()).toBeVisible();
    });

    test('shows "No active workflow" when workflow is inactive', async ({ page, mockApi }) => {
        setupSessionDetail(mockApi);
        await mockApi.install();

        await page.goto(`/project/${PROJECT_ID}/session/${SESSION_NAME}`);
        await expect(page.getByText(/no active workflow/i)).toBeVisible();
    });

    test('changes tab shows file list and diff viewer', async ({ page, mockApi }) => {
        setupSessionDetail(mockApi);
        mockApi.withDaemonEndpoints(mockApi.defaultPort, {
            [`/api/v1/projects/${PROJECT_ID}/sessions/test-session/diff/files`]: makeDiffFilesResult([
                { path: 'src/index.ts', status: 'M' },
                { path: 'src/utils.ts', status: 'A' },
            ]),
            [`/api/v1/projects/${PROJECT_ID}/sessions/test-session/diff`]: makeDiffResult(
                '--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,3 +1,4 @@\n import { foo } from "./utils";\n+import { bar } from "./bar";\n',
            ),
        });
        await mockApi.install();

        await page.goto(`/project/${PROJECT_ID}/session/${SESSION_NAME}`);

        // File list shows file names
        await expect(page.getByRole('button', { name: /view diff for src\/index\.ts/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /view diff for src\/utils\.ts/i })).toBeVisible();
    });

    test('switching to insights tab shows insights panel', async ({ page, mockApi }) => {
        setupSessionDetail(mockApi);
        mockApi.withDaemonEndpoints(mockApi.defaultPort, {
            [`/api/v1/projects/${PROJECT_ID}/sessions/test-session/insights`]: makeInsightsResponse({
                insights: 'Session modified 5 files.',
            }),
        });
        await mockApi.install();

        await page.goto(`/project/${PROJECT_ID}/session/${SESSION_NAME}`);

        // Click Insights tab
        await page.getByRole('tab', { name: /insights/i }).click();
        await expect(page.getByText('Session modified 5 files.')).toBeVisible();
    });

    test('breadcrumb navigation works', async ({ page, mockApi }) => {
        setupSessionDetail(mockApi);
        await mockApi.install();

        await page.goto(`/project/${PROJECT_ID}/session/${SESSION_NAME}`);

        // Click project breadcrumb
        const projectLink = page.getByRole('link', { name: 'my-app' });
        await expect(projectLink).toBeVisible();
        await projectLink.click();
        await expect(page).toHaveURL(new RegExp(`/project/${PROJECT_ID}$`));
    });
});
