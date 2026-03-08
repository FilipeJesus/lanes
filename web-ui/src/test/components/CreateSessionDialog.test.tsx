import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateSessionDialog } from '../../components/CreateSessionDialog';
import type { DaemonApiClient } from '../../api/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApiClient(): DaemonApiClient {
    return {
        listAgents: vi.fn().mockResolvedValue({
            agents: [
                {
                    name: 'claude',
                    displayName: 'Claude Code',
                    cliCommand: 'claude',
                    sessionFileExtension: '.claude-session',
                    statusFileExtension: '.claude-status',
                    permissionModes: ['default', 'strict'],
                },
            ],
        }),
        listWorkflows: vi.fn().mockResolvedValue({
            workflows: [{ name: 'basic-feature', description: 'A basic feature workflow' }],
        }),
        getGitBranches: vi.fn().mockResolvedValue({
            branches: [{ name: 'main', isRemote: false, isCurrent: true }],
        }),
    } as unknown as DaemonApiClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CreateSessionDialog', () => {
    let apiClient: DaemonApiClient;

    beforeEach(() => {
        apiClient = makeApiClient();
    });

    it('Given isOpen=true, then the dialog is visible with a name input, agent select, and workflow select', async () => {
        render(
            <CreateSessionDialog
                isOpen={true}
                apiClient={apiClient}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        );

        expect(screen.getByRole('dialog')).toBeInTheDocument();

        // Name input
        expect(screen.getByLabelText(/session name/i)).toBeInTheDocument();

        // Agent select
        expect(screen.getByLabelText(/agent/i)).toBeInTheDocument();

        // Workflow select
        expect(screen.getByLabelText(/workflow/i)).toBeInTheDocument();
    });

    it('Given an empty session name, when user submits, then onCreate is NOT called and a validation error is shown', async () => {
        const onCreate = vi.fn();
        const user = userEvent.setup();

        render(
            <CreateSessionDialog
                isOpen={true}
                apiClient={apiClient}
                onClose={vi.fn()}
                onCreate={onCreate}
            />
        );

        // Wait for dialog to be ready
        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        // Submit without filling in the name
        const submitButton = screen.getByRole('button', { name: /create session/i });
        await user.click(submitButton);

        expect(onCreate).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('Given a valid session name and agent selection, when user submits, then onCreate is called with the correct params', async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        const onClose = vi.fn();
        const user = userEvent.setup();

        render(
            <CreateSessionDialog
                isOpen={true}
                apiClient={apiClient}
                onClose={onClose}
                onCreate={onCreate}
            />
        );

        // Wait for agents to load
        await waitFor(() => {
            expect(screen.queryByText(/loading agents/i)).not.toBeInTheDocument();
        });

        const nameInput = screen.getByLabelText(/session name/i);
        await user.type(nameInput, 'my-new-session');

        const submitButton = screen.getByRole('button', { name: /create session/i });
        await user.click(submitButton);

        await waitFor(() => {
            expect(onCreate).toHaveBeenCalledTimes(1);
        });

        const callArgs = onCreate.mock.calls[0][0];
        expect(callArgs.name).toBe('my-new-session');
    });

    it('When user clicks cancel, then onClose is called', async () => {
        const onClose = vi.fn();
        const user = userEvent.setup();

        render(
            <CreateSessionDialog
                isOpen={true}
                apiClient={apiClient}
                onClose={onClose}
                onCreate={vi.fn()}
            />
        );

        const cancelButton = screen.getByRole('button', { name: /cancel/i });
        await user.click(cancelButton);

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
