/**
 * CreateSessionDialog — modal form for creating a new Lanes session.
 *
 * Fetches the agent list and workflow list from the daemon API on open.
 * Validates that a session name is provided before calling onCreate.
 */

import { useState, useEffect, useId, useRef, useCallback } from 'react';
import type { DaemonApiClient } from '../api/client';
import type { AgentInfo, WorkflowInfo, CreateSessionRequest, BranchInfo } from '../api/types';
import styles from '../styles/CreateSessionDialog.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CreateSessionDialogProps {
    isOpen: boolean;
    apiClient: DaemonApiClient;
    onClose: () => void;
    onCreate: (params: CreateSessionRequest) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateSessionDialog({
    isOpen,
    apiClient,
    onClose,
    onCreate,
}: CreateSessionDialogProps) {
    // Form fields
    const [name, setName] = useState('');
    const [agent, setAgent] = useState('');
    const [workflow, setWorkflow] = useState('');
    const [branch, setBranch] = useState('');

    // Async data
    const [agents, setAgents] = useState<AgentInfo[]>([]);
    const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
    const [branches, setBranches] = useState<BranchInfo[]>([]);

    // UI state
    const [nameError, setNameError] = useState('');
    const [submitError, setSubmitError] = useState('');
    const [isPending, setIsPending] = useState(false);

    const nameInputRef = useRef<HTMLInputElement>(null);
    const titleId = useId();

    // ---------------------------------------------------------------------------
    // Data loading
    // ---------------------------------------------------------------------------

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
            // Non-fatal: dialog still works with empty lists
        }
    }, [apiClient]);

    useEffect(() => {
        if (!isOpen) return;

        // Reset form state on open
        setName('');
        setWorkflow('');
        setBranch('');
        setNameError('');
        setSubmitError('');
        setIsPending(false);

        void loadData();

        // Auto-focus the name field
        setTimeout(() => nameInputRef.current?.focus(), 50);
    }, [isOpen, loadData]);

    // Close on Escape key
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

    // ---------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------

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
        };
        if (agent) params.agent = agent;
        if (workflow) params.workflow = workflow;
        if (branch) params.branch = branch;

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
                    {/* Session name */}
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

                    {/* Agent selection */}
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
                            {agents.length === 0 && (
                                <option value="">Loading agents&hellip;</option>
                            )}
                            {agents.map((a) => (
                                <option key={a.name} value={a.name}>
                                    {a.displayName}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Workflow selection */}
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
                            {workflows.map((w) => (
                                <option key={w.name} value={w.name}>
                                    {w.name}
                                    {w.description ? ` — ${w.description}` : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Branch selection */}
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
                            {branches.map((b) => (
                                <option key={b.name} value={b.name}>
                                    {b.isRemote ? `remote: ${b.name}` : b.name}
                                    {b.isCurrent ? ' (current)' : ''}
                                </option>
                            ))}
                        </select>
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
                            disabled={isPending}
                        >
                            {isPending ? 'Creating\u2026' : 'Create Session'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
