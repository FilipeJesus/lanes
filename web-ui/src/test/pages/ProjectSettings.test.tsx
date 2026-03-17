import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProjectSettings } from '../../pages/ProjectSettings';

const mockUseDaemonConnection = vi.fn();

vi.mock('../../hooks/useDaemonConnection', () => ({
    useDaemonConnection: () => mockUseDaemonConnection(),
}));

function makeApiClient() {
    return {
        getAllConfig: vi.fn()
            .mockResolvedValueOnce({
                config: {
                    'lanes.defaultAgent': 'codex',
                    'lanes.worktreesFolder': '.worktrees',
                },
                scope: 'effective',
            })
            .mockResolvedValueOnce({
                config: {
                    'lanes.defaultAgent': 'claude',
                },
                scope: 'global',
            })
            .mockResolvedValueOnce({
                config: {
                    'lanes.defaultAgent': 'codex',
                },
                scope: 'local',
            }),
        setConfig: vi.fn().mockResolvedValue({ success: true }),
    };
}

function renderProjectSettings(projectId = 'project-123') {
    return render(
        <MemoryRouter initialEntries={[`/project/${projectId}/settings`]}>
            <Routes>
                <Route path="/project/:projectId/settings" element={<ProjectSettings />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('ProjectSettings', () => {
    beforeEach(() => {
        mockUseDaemonConnection.mockReset();
    });

    it('loads effective, global, and local config views on mount', async () => {
        const apiClient = makeApiClient();
        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            daemonInfo: {
                projectName: 'my-app',
                workspaceRoot: '/projects/my-app',
                registeredAt: new Date().toISOString(),
            },
            loading: false,
            error: null,
            projectState: 'connected',
            refresh: vi.fn(),
        });

        renderProjectSettings();

        await waitFor(() => {
            expect(apiClient.getAllConfig).toHaveBeenNthCalledWith(1, 'effective');
            expect(apiClient.getAllConfig).toHaveBeenNthCalledWith(2, 'global');
            expect(apiClient.getAllConfig).toHaveBeenNthCalledWith(3, 'local');
        });

        expect(screen.getByText(/edit daemon-wide defaults/i)).toBeInTheDocument();
        expect(screen.getAllByText(/default agent/i)[0]).toBeInTheDocument();
    });

    it('saves a global value through the scoped config API', async () => {
        const user = userEvent.setup();
        const apiClient = makeApiClient();
        apiClient.getAllConfig
            .mockResolvedValueOnce({
                config: {
                    'lanes.defaultAgent': 'codex',
                },
                scope: 'effective',
            })
            .mockResolvedValueOnce({
                config: {
                    'lanes.defaultAgent': 'claude',
                },
                scope: 'global',
            })
            .mockResolvedValueOnce({
                config: {},
                scope: 'local',
            });

        mockUseDaemonConnection.mockReturnValue({
            apiClient,
            daemonInfo: {
                projectName: 'my-app',
                workspaceRoot: '/projects/my-app',
                registeredAt: new Date().toISOString(),
            },
            loading: false,
            error: null,
            projectState: 'connected',
            refresh: vi.fn(),
        });

        renderProjectSettings();

        await screen.findByLabelText(/global default agent/i);

        await user.selectOptions(screen.getByLabelText(/global default agent/i), 'gemini');
        await user.click(screen.getAllByRole('button', { name: /save global/i })[0]);

        await waitFor(() => {
            expect(apiClient.setConfig).toHaveBeenCalledWith('lanes.defaultAgent', 'gemini', 'global');
        });
    });

    it('shows onboarding guidance when the project is registered but offline', () => {
        mockUseDaemonConnection.mockReturnValue({
            apiClient: null,
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

        renderProjectSettings();

        expect(screen.getByText(/daemon is offline/i)).toBeInTheDocument();
        expect(screen.queryByText(/failed to load settings/i)).not.toBeInTheDocument();
    });
});
