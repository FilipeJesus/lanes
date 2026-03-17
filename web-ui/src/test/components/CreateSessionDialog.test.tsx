import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateSessionDialog } from '../../components/CreateSessionDialog';
import type { DaemonApiClient } from '../../api/client';

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
                    permissionModes: [
                        { id: 'acceptEdits', label: 'Accept Edits' },
                        { id: 'bypassPermissions', label: 'Bypass Permissions' },
                    ],
                },
                {
                    name: 'codex',
                    displayName: 'Codex',
                    cliCommand: 'codex',
                    sessionFileExtension: '.codex-session',
                    statusFileExtension: '.codex-status',
                    permissionModes: [
                        { id: 'acceptEdits', label: 'Accept Edits' },
                        { id: 'bypassPermissions', label: 'Bypass Permissions' },
                    ],
                },
            ],
        }),
        listWorkflows: vi.fn().mockResolvedValue({
            workflows: [{ name: 'basic-feature', description: 'A basic feature workflow' }],
        }),
        getAllConfig: vi.fn().mockResolvedValue({
            config: {
                'lanes.defaultAgent': 'codex',
            },
        }),
        getGitBranches: vi.fn().mockResolvedValue({
            branches: [{ name: 'main', isRemote: false, isCurrent: true }],
        }),
        improveSessionPrompt: vi.fn().mockResolvedValue({ improvedPrompt: 'Improved prompt' }),
        uploadSessionAttachments: vi.fn().mockResolvedValue({
            files: [{ name: 'notes.md', path: '/tmp/notes.md', size: 12, sourceKey: 'notes.md:12:1' }],
        }),
    } as unknown as DaemonApiClient;
}

describe('CreateSessionDialog', () => {
    let apiClient: DaemonApiClient;

    beforeEach(() => {
        apiClient = makeApiClient();
    });

    it('Given isOpen=true, then the dialog renders prompt, attachments, and bypass permission controls', async () => {
        render(
            <CreateSessionDialog
                isOpen={true}
                apiClient={apiClient}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        );

        await waitFor(() => {
            expect(screen.queryByText(/loading agents/i)).not.toBeInTheDocument();
        });

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByLabelText(/session name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/agent/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/starting prompt/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /improve prompt with ai/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /toggle bypass permissions/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /add files/i })).toBeInTheDocument();
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

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        await user.click(screen.getByRole('button', { name: /create session/i }));

        expect(onCreate).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('Given prompt improvement is requested, when the user clicks the button, then the improved prompt is written back to the textarea', async () => {
        const onImprovePrompt = vi.fn().mockResolvedValue('Sharper prompt');
        const user = userEvent.setup();

        render(
            <CreateSessionDialog
                isOpen={true}
                apiClient={apiClient}
                onClose={vi.fn()}
                onCreate={vi.fn()}
                onImprovePrompt={onImprovePrompt}
            />
        );

        await waitFor(() => {
            expect(screen.queryByText(/loading agents/i)).not.toBeInTheDocument();
        });

        const promptInput = screen.getByLabelText(/starting prompt/i);
        fireEvent.change(promptInput, { target: { value: 'Original prompt' } });
        await user.click(screen.getByRole('button', { name: /improve prompt with ai/i }));

        await waitFor(() => {
            expect(onImprovePrompt).toHaveBeenCalledWith({
                prompt: 'Original prompt',
                agent: 'codex',
            });
        });

        expect(screen.getByLabelText(/starting prompt/i)).toHaveValue('Sharper prompt');
    });

    it('Given the user uploads an attachment and enables bypass permissions, when the form submits, then onCreate receives prompt, attachment paths, and bypass permission mode', async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        const onUploadAttachments = vi.fn().mockResolvedValue([
            { name: 'notes.md', path: '/tmp/notes.md', size: 12, sourceKey: 'notes.md:12:1' },
        ]);
        const onClose = vi.fn();
        const user = userEvent.setup();

        render(
            <CreateSessionDialog
                isOpen={true}
                apiClient={apiClient}
                onClose={onClose}
                onCreate={onCreate}
                onUploadAttachments={onUploadAttachments}
            />
        );

        await waitFor(() => {
            expect(screen.queryByText(/loading agents/i)).not.toBeInTheDocument();
        });

        await user.type(screen.getByLabelText(/session name/i), 'my-new-session');
        await user.type(screen.getByLabelText(/starting prompt/i), 'Investigate the failing UI flow');

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(['hello world'], 'notes.md', { type: 'text/markdown' });
        await user.upload(fileInput, file);

        await waitFor(() => {
            expect(onUploadAttachments).toHaveBeenCalledTimes(1);
        });

        await user.click(screen.getByRole('button', { name: /toggle bypass permissions/i }));
        await user.click(screen.getByRole('button', { name: /create session/i }));

        await waitFor(() => {
            expect(onCreate).toHaveBeenCalledTimes(1);
        });

        expect(onCreate).toHaveBeenCalledWith({
            name: 'my-new-session',
            agent: 'codex',
            prompt: 'Investigate the failing UI flow',
            permissionMode: 'bypassPermissions',
            attachments: ['/tmp/notes.md'],
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.getByText('notes.md')).toBeInTheDocument();
    });

    it('Given a configured default agent, when the dialog loads, then that agent is selected', async () => {
        render(
            <CreateSessionDialog
                isOpen={true}
                apiClient={apiClient}
                onClose={vi.fn()}
                onCreate={vi.fn()}
            />
        );

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        expect(screen.getByLabelText(/agent/i)).toHaveValue('codex');
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

        await user.click(screen.getByRole('button', { name: /cancel/i }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
