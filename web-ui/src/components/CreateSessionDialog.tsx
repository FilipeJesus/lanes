/**
 * CreateSessionDialog — modal form for creating a new Lanes session.
 *
 * Mirrors the VS Code create-session experience with prompt improvement,
 * attachment upload, and bypass-permission controls.
 */

import { useState, useEffect, useId, useRef, useCallback } from 'react';
import type { DaemonApiClient } from '../api/client';
import type {
    AgentInfo,
    WorkflowInfo,
    CreateSessionRequest,
    BranchInfo,
    ImproveSessionPromptRequest,
    SessionAttachment,
    SessionAttachmentUploadFile,
} from '../api/types';
import styles from '../styles/CreateSessionDialog.module.css';

const MAX_ATTACHMENTS = 20;

function getSourceKey(file: File): string {
    return `${file.name}:${file.size}:${file.lastModified}`;
}

function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
        reader.onload = () => {
            const result = reader.result;
            if (!(result instanceof ArrayBuffer)) {
                reject(new Error('Failed to read file'));
                return;
            }
            const bytes = new Uint8Array(result);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 1) {
                binary += String.fromCharCode(bytes[i]);
            }
            resolve(btoa(binary));
        };
        reader.readAsArrayBuffer(file);
    });
}

export interface CreateSessionDialogProps {
    isOpen: boolean;
    apiClient: DaemonApiClient;
    onClose: () => void;
    onCreate: (params: CreateSessionRequest) => Promise<void>;
    onImprovePrompt?: (params: ImproveSessionPromptRequest) => Promise<string>;
    onUploadAttachments?: (files: SessionAttachmentUploadFile[]) => Promise<SessionAttachment[]>;
}

export function CreateSessionDialog({
    isOpen,
    apiClient,
    onClose,
    onCreate,
    onImprovePrompt,
    onUploadAttachments,
}: CreateSessionDialogProps) {
    const [name, setName] = useState('');
    const [agent, setAgent] = useState('');
    const [workflow, setWorkflow] = useState('');
    const [branch, setBranch] = useState('');
    const [prompt, setPrompt] = useState('');
    const [attachments, setAttachments] = useState<SessionAttachment[]>([]);
    const [bypassPermissions, setBypassPermissions] = useState(false);

    const [agents, setAgents] = useState<AgentInfo[]>([]);
    const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
    const [branches, setBranches] = useState<BranchInfo[]>([]);

    const [nameError, setNameError] = useState('');
    const [submitError, setSubmitError] = useState('');
    const [isPending, setIsPending] = useState(false);
    const [isImprovingPrompt, setIsImprovingPrompt] = useState(false);
    const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);

    const nameInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const titleId = useId();

    const selectedAgent = agents.find((entry) => entry.name === agent) ?? null;
    const canBypassPermissions = selectedAgent?.permissionModes.some((mode) => mode.id === 'bypassPermissions') ?? false;

    const loadData = useCallback(async () => {
        try {
            const [agentsRes, workflowsRes, branchesRes] = await Promise.allSettled([
                apiClient.listAgents(),
                apiClient.listWorkflows(),
                apiClient.getGitBranches(),
            ]);

            if (agentsRes.status === 'fulfilled') {
                setAgents(agentsRes.value.agents);
                if (agentsRes.value.agents.length > 0) {
                    setAgent(agentsRes.value.agents[0].name);
                }
            }

            if (workflowsRes.status === 'fulfilled') {
                setWorkflows(workflowsRes.value.workflows);
            }

            if (branchesRes.status === 'fulfilled') {
                setBranches(branchesRes.value.branches);
            }
        } catch {
            // Non-fatal: dialog still works with empty lists.
        }
    }, [apiClient]);

    useEffect(() => {
        if (!isOpen) return;

        setName('');
        setWorkflow('');
        setBranch('');
        setPrompt('');
        setAttachments([]);
        setBypassPermissions(false);
        setNameError('');
        setSubmitError('');
        setIsPending(false);
        setIsImprovingPrompt(false);
        setIsUploadingAttachments(false);

        void loadData();
        setTimeout(() => nameInputRef.current?.focus(), 50);
    }, [isOpen, loadData]);

    useEffect(() => {
        if (!canBypassPermissions && bypassPermissions) {
            setBypassPermissions(false);
        }
    }, [bypassPermissions, canBypassPermissions]);

    useEffect(() => {
        if (!isOpen) return;

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                onClose();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    function validateName(value: string): string {
        if (!value.trim()) return 'Session name is required';
        if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
            return 'Only letters, numbers, hyphens, and underscores are allowed';
        }
        return '';
    }

    function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
        const value = e.target.value;
        setName(value);
        if (nameError) {
            setNameError(validateName(value));
        }
    }

    async function handleImprovePrompt() {
        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt) {
            setSubmitError('Please enter some text in the prompt field before using prompt improvement.');
            return;
        }

        setIsImprovingPrompt(true);
        setSubmitError('');
        try {
            const improve = onImprovePrompt
                ?? (async (params: ImproveSessionPromptRequest) => {
                    const response = await apiClient.improveSessionPrompt(params);
                    return response.improvedPrompt;
                });
            const improvedPrompt = await improve({ prompt: trimmedPrompt, agent });
            setPrompt(improvedPrompt);
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsImprovingPrompt(false);
        }
    }

    async function handleAttachmentInputChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        if (files.length === 0) {
            return;
        }

        const remainingSlots = MAX_ATTACHMENTS - attachments.length;
        const candidates = files.slice(0, remainingSlots);
        if (files.length > remainingSlots) {
            setSubmitError(`You can only attach ${remainingSlots} more file${remainingSlots === 1 ? '' : 's'}.`);
        } else {
            setSubmitError('');
        }

        const existingKeys = new Set(attachments.map((entry) => entry.sourceKey ?? entry.path));
        const uploadFiles = candidates.filter((file) => !existingKeys.has(getSourceKey(file)));
        if (uploadFiles.length === 0) {
            e.target.value = '';
            return;
        }

        setIsUploadingAttachments(true);
        try {
            const payload = await Promise.all(
                uploadFiles.map(async (file) => ({
                    name: file.name,
                    data: await readFileAsBase64(file),
                    size: file.size,
                    type: file.type,
                    lastModified: file.lastModified,
                    sourceKey: getSourceKey(file),
                }))
            );
            const upload = onUploadAttachments
                ?? (async (filesToUpload: SessionAttachmentUploadFile[]) => {
                    const response = await apiClient.uploadSessionAttachments({ files: filesToUpload });
                    return response.files;
                });
            const uploaded = await upload(payload);
            setAttachments((current) => [...current, ...uploaded]);
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsUploadingAttachments(false);
            e.target.value = '';
        }
    }

    function handleRemoveAttachment(pathToRemove: string) {
        setAttachments((current) => current.filter((entry) => entry.path !== pathToRemove));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        const err = validateName(name);
        if (err) {
            setNameError(err);
            nameInputRef.current?.focus();
            return;
        }

        const params: CreateSessionRequest = {
            name: name.trim(),
            prompt: prompt.trim() || undefined,
            permissionMode: bypassPermissions ? 'bypassPermissions' : 'acceptEdits',
        };
        if (agent) params.agent = agent;
        if (workflow) params.workflow = workflow;
        if (branch) params.branch = branch;
        if (attachments.length > 0) {
            params.attachments = attachments.map((entry) => entry.path);
        }

        setIsPending(true);
        setSubmitError('');

        try {
            await onCreate(params);
            onClose();
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsPending(false);
        }
    }

    function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
        if (e.target === e.currentTarget) {
            onClose();
        }
    }

    if (!isOpen) return null;

    return (
        <div
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={handleOverlayClick}
        >
            <div className={styles.dialog}>
                <div className={styles.dialogHeader}>
                    <h2 id={titleId} className={styles.title}>
                        Create Session
                    </h2>
                    <button
                        type="button"
                        className={styles.closeButton}
                        onClick={onClose}
                        aria-label="Close dialog"
                    >
                        &#x2715;
                    </button>
                </div>

                {submitError && (
                    <div className={styles.errorBanner} role="alert">
                        {submitError}
                    </div>
                )}

                <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
                    <div className={styles.fieldGroup}>
                        <label htmlFor="session-name" className={styles.label}>
                            Session name <span className={styles.required}>*</span>
                        </label>
                        <input
                            ref={nameInputRef}
                            id="session-name"
                            type="text"
                            className={`${styles.input} ${nameError ? styles.inputError : ''}`}
                            value={name}
                            onChange={handleNameChange}
                            placeholder="e.g. feat-login"
                            autoComplete="off"
                            disabled={isPending}
                        />
                        {nameError ? (
                            <span className={styles.errorText} role="alert">
                                {nameError}
                            </span>
                        ) : (
                            <span className={styles.hint}>
                                Letters, numbers, hyphens, and underscores only
                            </span>
                        )}
                    </div>

                    <div className={styles.fieldGroup}>
                        <label htmlFor="session-agent" className={styles.label}>
                            Agent
                        </label>
                        <select
                            id="session-agent"
                            className={styles.select}
                            value={agent}
                            onChange={(e) => setAgent(e.target.value)}
                            disabled={isPending || agents.length === 0}
                        >
                            {agents.length === 0 && <option value="">Loading agents&hellip;</option>}
                            {agents.map((entry) => (
                                <option key={entry.name} value={entry.name}>
                                    {entry.displayName}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.fieldGroup}>
                        <div className={styles.labelRow}>
                            <label htmlFor="session-prompt" className={styles.label}>
                                Starting Prompt <span className={styles.hint}>(optional)</span>
                            </label>
                            <button
                                type="button"
                                className={styles.secondaryInlineButton}
                                onClick={() => void handleImprovePrompt()}
                                disabled={isPending || isImprovingPrompt}
                                aria-label="Improve prompt with AI"
                            >
                                {isImprovingPrompt ? 'Improving…' : 'Improve prompt with AI'}
                            </button>
                        </div>
                        <textarea
                            id="session-prompt"
                            className={styles.textarea}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Add an initial prompt for the agent"
                            rows={5}
                            disabled={isPending}
                        />
                    </div>

                    <div className={styles.fieldGroup}>
                        <div className={styles.labelRow}>
                            <span className={styles.label}>Attachments</span>
                            <button
                                type="button"
                                className={styles.secondaryInlineButton}
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isPending || isUploadingAttachments || attachments.length >= MAX_ATTACHMENTS}
                            >
                                {isUploadingAttachments ? 'Uploading…' : 'Add files'}
                            </button>
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className={styles.hiddenInput}
                            onChange={(e) => void handleAttachmentInputChange(e)}
                            disabled={isPending || isUploadingAttachments}
                        />
                        {attachments.length === 0 ? (
                            <span className={styles.hint}>
                                Upload files to include their paths in the starting prompt.
                            </span>
                        ) : (
                            <div className={styles.attachmentList}>
                                {attachments.map((entry) => (
                                    <div key={entry.path} className={styles.attachmentChip}>
                                        <span className={styles.attachmentName}>{entry.name}</span>
                                        <button
                                            type="button"
                                            className={styles.attachmentRemove}
                                            onClick={() => handleRemoveAttachment(entry.path)}
                                            aria-label={`Remove ${entry.name}`}
                                            disabled={isPending}
                                        >
                                            &#x2715;
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className={styles.fieldGroup}>
                        <label htmlFor="session-workflow" className={styles.label}>
                            Workflow <span className={styles.hint}>(optional)</span>
                        </label>
                        <select
                            id="session-workflow"
                            className={styles.select}
                            value={workflow}
                            onChange={(e) => setWorkflow(e.target.value)}
                            disabled={isPending}
                        >
                            <option value="">None</option>
                            {workflows.map((entry) => (
                                <option key={entry.name} value={entry.name}>
                                    {entry.name}
                                    {entry.description ? ` — ${entry.description}` : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.fieldGroup}>
                        <label htmlFor="session-branch" className={styles.label}>
                            Branch <span className={styles.hint}>(optional)</span>
                        </label>
                        <select
                            id="session-branch"
                            className={styles.select}
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            disabled={isPending}
                        >
                            <option value="">Default (new branch from HEAD)</option>
                            {branches.map((entry) => (
                                <option key={entry.name} value={entry.name}>
                                    {entry.isRemote ? `remote: ${entry.name}` : entry.name}
                                    {entry.isCurrent ? ' (current)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.permissionRow}>
                        <div>
                            <div className={styles.label}>Bypass permissions</div>
                            <div className={styles.hint}>
                                {canBypassPermissions
                                    ? 'Run the selected agent with its bypass permission mode.'
                                    : 'The selected agent does not expose a bypass permission mode.'}
                            </div>
                        </div>
                        <button
                            type="button"
                            className={`${styles.bypassButton} ${bypassPermissions ? styles.bypassButtonActive : ''}`}
                            onClick={() => setBypassPermissions((current) => !current)}
                            disabled={isPending || !canBypassPermissions}
                            aria-pressed={bypassPermissions}
                            aria-label="Toggle bypass permissions"
                        >
                            {bypassPermissions ? 'Enabled' : 'Off'}
                        </button>
                    </div>

                    <div className={styles.actions}>
                        <button
                            type="button"
                            className={styles.cancelButton}
                            onClick={onClose}
                            disabled={isPending}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className={styles.submitButton}
                            disabled={isPending || isImprovingPrompt || isUploadingAttachments}
                        >
                            {isPending ? 'Creating…' : 'Create Session'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
