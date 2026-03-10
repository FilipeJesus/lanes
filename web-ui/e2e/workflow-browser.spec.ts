import { test, expect, makeWorkflowInfo } from './fixtures/base';

test.describe('Workflow Browser', () => {
    const PROJECT_ID = 'project-my-app';

    test('shows workflow template list', async ({ page, mockApi }) => {
        const workflows = [
            makeWorkflowInfo({ name: 'feature-dev', description: 'Standard feature workflow', isBuiltin: true }),
            makeWorkflowInfo({ name: 'bug-fix', description: 'Bug fix workflow', isBuiltin: true }),
            makeWorkflowInfo({ name: 'custom-deploy', description: 'Custom deploy pipeline', isBuiltin: false }),
        ];
        mockApi.withDefaultDaemon();
        mockApi.withDaemonEndpoints(mockApi.defaultPort, {
            [`/api/v1/projects/${PROJECT_ID}/workflows`]: { workflows },
        });
        await mockApi.install();

        await page.goto(`/project/${PROJECT_ID}/workflows`);
        await expect(page.getByText('feature-dev')).toBeVisible();
        await expect(page.getByText('bug-fix')).toBeVisible();
        await expect(page.getByText('custom-deploy')).toBeVisible();
    });

    test('search filters workflow list', async ({ page, mockApi }) => {
        const workflows = [
            makeWorkflowInfo({ name: 'feature-dev', description: 'Standard feature workflow' }),
            makeWorkflowInfo({ name: 'bug-fix', description: 'Bug fix workflow' }),
        ];
        mockApi.withDefaultDaemon();
        mockApi.withDaemonEndpoints(mockApi.defaultPort, {
            [`/api/v1/projects/${PROJECT_ID}/workflows`]: { workflows },
        });
        await mockApi.install();

        await page.goto(`/project/${PROJECT_ID}/workflows`);
        await expect(page.getByText('feature-dev')).toBeVisible();
        await expect(page.getByText('bug-fix')).toBeVisible();

        // Type search term
        await page.getByRole('searchbox').fill('bug');
        await expect(page.getByText('bug-fix')).toBeVisible();
        await expect(page.getByText('feature-dev')).not.toBeVisible();
    });

    test('clicking workflow shows detail panel', async ({ page, mockApi }) => {
        const workflows = [
            makeWorkflowInfo({
                name: 'feature-dev',
                description: 'Full feature development',
                steps: [
                    { id: 'plan', type: 'step', description: 'Plan implementation' },
                    { id: 'implement', type: 'step', description: 'Write code' },
                    { id: 'test', type: 'step', description: 'Write tests' },
                ],
            }),
        ];
        mockApi.withDefaultDaemon();
        mockApi.withDaemonEndpoints(mockApi.defaultPort, {
            [`/api/v1/projects/${PROJECT_ID}/workflows`]: { workflows },
        });
        await mockApi.install();

        await page.goto(`/project/${PROJECT_ID}/workflows`);
        await page.getByText('feature-dev').click();

        // Detail panel should show step info
        await expect(page.getByText('Plan implementation')).toBeVisible();
        await expect(page.getByText('Write code')).toBeVisible();
        await expect(page.getByText('Write tests')).toBeVisible();
    });

    test('shows empty state when no workflows', async ({ page, mockApi }) => {
        mockApi.withDefaultDaemon();
        mockApi.withDaemonEndpoints(mockApi.defaultPort, {
            [`/api/v1/projects/${PROJECT_ID}/workflows`]: { workflows: [] },
        });
        await mockApi.install();

        await page.goto(`/project/${PROJECT_ID}/workflows`);
        await expect(page.getByText(/no workflow/i)).toBeVisible();
    });
});
