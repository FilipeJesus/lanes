import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkflowBrowser } from '../../pages/WorkflowBrowser';
import type { DaemonApiClient } from '../../api/client';
import type { WorkflowInfo } from '../../api/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseDaemonConnection = vi.fn();
vi.mock('../../hooks/useDaemonConnection', () => ({
    useDaemonConnection: () => mockUseDaemonConnection(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const builtinWorkflow: WorkflowInfo = {
    name: 'basic-feature',
    description: 'A basic feature workflow',
    isBuiltin: true,
    steps: [
        { id: 'plan', type: 'step', description: 'Plan the feature' },
        { id: 'implement', type: 'step', description: 'Implement the feature' },
    ],
};

const customWorkflow: WorkflowInfo = {
    name: 'my-custom-flow',
    description: 'Custom workflow',
    isBuiltin: false,
    steps: [{ id: 'build', type: 'step' }],
};

function makeApiClient(workflows: WorkflowInfo[] = [builtinWorkflow, customWorkflow]): DaemonApiClient {
    return {
        listWorkflows: vi.fn().mockResolvedValue({ workflows }),
    } as unknown as DaemonApiClient;
}

function makeConnectedDaemonConnection(apiClient: DaemonApiClient) {
    return {
        apiClient,
        sseClient: null,
        daemonInfo: {
            projectName: 'my-app',
            workspaceRoot: '/projects/my-app',
            registeredAt: new Date().toISOString(),
        },
        loading: false,
        error: null,
        projectState: 'connected',
        refresh: vi.fn(),
    };
}

function renderWithProject(projectId: string = 'project-123') {
    return render(
        <MemoryRouter initialEntries={[`/project/${projectId}/workflows`]}>
            <Routes>
                <Route path="/project/:projectId/workflows" element={<WorkflowBrowser />} />
            </Routes>
        </MemoryRouter>
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowBrowser', () => {
    beforeEach(() => {
        mockUseDaemonConnection.mockClear();
    });

    it('Given a project param and workflows returned from API, then workflow cards are rendered', async () => {
        const apiClient = makeApiClient();
        mockUseDaemonConnection.mockReturnValue(makeConnectedDaemonConnection(apiClient));

        renderWithProject('project-123');

        await waitFor(() => {
            expect(screen.getByTestId('workflow-card-basic-feature')).toBeInTheDocument();
            expect(screen.getByTestId('workflow-card-my-custom-flow')).toBeInTheDocument();
        });
    });

    it('Given workflow cards rendered, then their names are visible', async () => {
        const apiClient = makeApiClient();
        mockUseDaemonConnection.mockReturnValue(makeConnectedDaemonConnection(apiClient));

        renderWithProject('project-123');

        await waitFor(() => {
            expect(screen.getByText('basic-feature')).toBeInTheDocument();
            expect(screen.getByText('my-custom-flow')).toBeInTheDocument();
        });
    });

    it('Given a builtin workflow, then the builtin badge is shown on its card', async () => {
        const apiClient = makeApiClient([builtinWorkflow]);
        mockUseDaemonConnection.mockReturnValue(makeConnectedDaemonConnection(apiClient));

        renderWithProject('project-123');

        await waitFor(() => {
            // There should be a builtin badge somewhere (inside the card)
            expect(screen.getByText('builtin')).toBeInTheDocument();
        });
    });

    it('Given a workflow card is clicked, then its detail panel is shown', async () => {
        const apiClient = makeApiClient();
        mockUseDaemonConnection.mockReturnValue(makeConnectedDaemonConnection(apiClient));

        renderWithProject('project-123');

        await waitFor(() => {
            expect(screen.getByTestId('workflow-card-basic-feature')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByTestId('workflow-card-basic-feature'));

        await waitFor(() => {
            // WorkflowDetail should be rendered with the workflow name
            expect(screen.getByTestId('workflow-detail')).toBeInTheDocument();
        });
    });

    it('Given loading state, then a loading indicator is shown', () => {
        mockUseDaemonConnection.mockReturnValue({
            apiClient: null,
            sseClient: null,
            daemonInfo: null,
            loading: true,
            error: null,
            projectState: 'missing',
            refresh: vi.fn(),
        });

        renderWithProject('project-123');

        expect(screen.getByRole('status', { name: /loading workflows/i })).toBeInTheDocument();
    });

    it('Given an error from the daemon connection, then an error message is shown', () => {
        mockUseDaemonConnection.mockReturnValue({
            apiClient: null,
            sseClient: null,
            daemonInfo: null,
            loading: false,
            error: new Error('Connection refused'),
            projectState: 'missing',
            refresh: vi.fn(),
        });

        renderWithProject('project-123');

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });

    it('Given a search query entered, then only matching workflows are shown', async () => {
        const apiClient = makeApiClient();
        mockUseDaemonConnection.mockReturnValue(makeConnectedDaemonConnection(apiClient));

        renderWithProject('project-123');

        await waitFor(() => {
            expect(screen.getByTestId('workflow-card-basic-feature')).toBeInTheDocument();
        });

        const searchInput = screen.getByRole('searchbox', { name: /search workflows/i });
        fireEvent.change(searchInput, { target: { value: 'custom' } });

        await waitFor(() => {
            expect(screen.queryByTestId('workflow-card-basic-feature')).not.toBeInTheDocument();
            expect(screen.getByTestId('workflow-card-my-custom-flow')).toBeInTheDocument();
        });
    });

    it('Given clicking a selected workflow card again, then the detail panel is closed', async () => {
        const apiClient = makeApiClient();
        mockUseDaemonConnection.mockReturnValue(makeConnectedDaemonConnection(apiClient));

        renderWithProject('project-123');

        await waitFor(() => {
            expect(screen.getByTestId('workflow-card-basic-feature')).toBeInTheDocument();
        });

        // Select workflow
        fireEvent.click(screen.getByTestId('workflow-card-basic-feature'));

        await waitFor(() => {
            expect(screen.getByTestId('workflow-detail')).toBeInTheDocument();
        });

        // Deselect workflow
        fireEvent.click(screen.getByTestId('workflow-card-basic-feature'));

        await waitFor(() => {
            expect(screen.queryByTestId('workflow-detail')).not.toBeInTheDocument();
        });
    });

    it('Given a registered project without a running daemon, then onboarding guidance is shown', () => {
        mockUseDaemonConnection.mockReturnValue({
            apiClient: null,
            sseClient: null,
            daemonInfo: {
                projectName: 'my-app',
                workspaceRoot: '/projects/my-app',
                registeredAt: new Date().toISOString(),
            },
            loading: false,
            error: null,
            projectState: 'offline',
            refresh: vi.fn(),
        });

        renderWithProject('project-123');

        expect(screen.getByText(/daemon is offline/i)).toBeInTheDocument();
        expect(screen.queryByText(/failed to load workflows/i)).not.toBeInTheDocument();
    });
});
