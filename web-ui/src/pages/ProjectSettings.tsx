import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDaemonConnection } from '../hooks/useDaemonConnection';
import styles from '../styles/ProjectSettings.module.css';

type InputType = 'string' | 'number' | 'boolean' | 'select';

interface SettingDefinition {
    key: string;
    label: string;
    description: string;
    type: InputType;
    defaultValue: string | number | boolean;
    options?: string[];
}

const SETTINGS: SettingDefinition[] = [
    {
        key: 'lanes.defaultAgent',
        label: 'Default agent',
        description: 'Agent used when a session does not specify one explicitly.',
        type: 'select',
        defaultValue: 'claude',
        options: ['claude', 'codex', 'cortex', 'gemini', 'opencode'],
    },
    {
        key: 'lanes.worktreesFolder',
        label: 'Worktrees folder',
        description: 'Relative folder used for generated worktrees.',
        type: 'string',
        defaultValue: '.worktrees',
    },
    {
        key: 'lanes.promptsFolder',
        label: 'Prompts folder',
        description: 'Folder used for saved prompts. Empty uses the built-in location.',
        type: 'string',
        defaultValue: '',
    },
    {
        key: 'lanes.baseBranch',
        label: 'Base branch',
        description: 'Default branch used for comparisons and reviews.',
        type: 'string',
        defaultValue: '',
    },
    {
        key: 'lanes.includeUncommittedChanges',
        label: 'Include uncommitted changes',
        description: 'Include working tree changes in generated diffs and reviews.',
        type: 'boolean',
        defaultValue: true,
    },
    {
        key: 'lanes.localSettingsPropagation',
        label: 'Local settings propagation',
        description: 'How local agent settings are copied into new worktrees.',
        type: 'select',
        defaultValue: 'copy',
        options: ['copy', 'symlink', 'disabled'],
    },
    {
        key: 'lanes.workflowsEnabled',
        label: 'Workflows enabled',
        description: 'Allow workflow-assisted sessions and workflow state tracking.',
        type: 'boolean',
        defaultValue: true,
    },
    {
        key: 'lanes.customWorkflowsFolder',
        label: 'Custom workflows folder',
        description: 'Relative folder scanned for custom workflow definitions.',
        type: 'string',
        defaultValue: '.lanes/workflows',
    },
    {
        key: 'lanes.chimeSound',
        label: 'Chime sound',
        description: 'Sound played for completion and attention events.',
        type: 'select',
        defaultValue: 'chime',
        options: ['chime', 'alarm', 'level-up', 'notification'],
    },
    {
        key: 'lanes.polling.quietThresholdMs',
        label: 'Quiet threshold (ms)',
        description: 'Polling delay used before sessions are considered quiet.',
        type: 'number',
        defaultValue: 3000,
    },
    {
        key: 'lanes.terminalMode',
        label: 'Terminal mode',
        description: 'Terminal backend used when opening agent sessions.',
        type: 'select',
        defaultValue: 'vscode',
        options: ['vscode', 'tmux'],
    },
];

type DraftMap = Record<string, string | number | boolean>;

function normalizeDraftValue(definition: SettingDefinition, value: unknown): string | number | boolean {
    if (value === undefined || value === null) {
        return definition.defaultValue;
    }
    if (definition.type === 'boolean') {
        return Boolean(value);
    }
    if (definition.type === 'number') {
        return typeof value === 'number' ? value : Number(value);
    }
    return String(value);
}

function parseDraftValue(definition: SettingDefinition, value: string | number | boolean): string | number | boolean {
    if (definition.type === 'boolean') {
        return Boolean(value);
    }
    if (definition.type === 'number') {
        return typeof value === 'number' ? value : Number(value);
    }
    return String(value);
}

function formatValue(value: unknown): string {
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (value === '') {
        return '(empty)';
    }
    if (value === undefined || value === null) {
        return '(unset)';
    }
    return String(value);
}

function renderInput(
    definition: SettingDefinition,
    value: string | number | boolean,
    inputId: string,
    ariaLabel: string,
    onChange: (value: string | number | boolean) => void,
) {
    if (definition.type === 'boolean') {
        return (
            <label className={styles.toggle}>
                <input
                    id={inputId}
                    type="checkbox"
                    aria-label={ariaLabel}
                    checked={Boolean(value)}
                    onChange={(event) => onChange(event.target.checked)}
                />
                <span>{Boolean(value) ? 'Enabled' : 'Disabled'}</span>
            </label>
        );
    }

    if (definition.type === 'select') {
        return (
            <select
                id={inputId}
                aria-label={ariaLabel}
                className={styles.input}
                value={String(value)}
                onChange={(event) => onChange(event.target.value)}
            >
                {definition.options?.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </select>
        );
    }

    return (
        <input
            id={inputId}
            aria-label={ariaLabel}
            className={styles.input}
            type={definition.type === 'number' ? 'number' : 'text'}
            value={definition.type === 'number' ? Number(value) : String(value)}
            onChange={(event) => onChange(definition.type === 'number' ? Number(event.target.value) : event.target.value)}
        />
    );
}

export function ProjectSettings() {
    const { projectId } = useParams<{ projectId: string }>();
    const { apiClient, daemonInfo, loading: connectionLoading, error: connectionError } =
        useDaemonConnection(projectId);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [effectiveConfig, setEffectiveConfig] = useState<Record<string, unknown>>({});
    const [globalConfig, setGlobalConfig] = useState<Record<string, unknown>>({});
    const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});
    const [globalDrafts, setGlobalDrafts] = useState<DraftMap>({});
    const [localDrafts, setLocalDrafts] = useState<DraftMap>({});
    const [pendingKey, setPendingKey] = useState<string | null>(null);

    const loadSettings = useCallback(async () => {
        if (!apiClient) {
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const [effectiveRes, globalRes, localRes] = await Promise.all([
                apiClient.getAllConfig('effective'),
                apiClient.getAllConfig('global'),
                apiClient.getAllConfig('local'),
            ]);

            setEffectiveConfig(effectiveRes.config);
            setGlobalConfig(globalRes.config);
            setLocalConfig(localRes.config);

            const nextGlobalDrafts: DraftMap = {};
            const nextLocalDrafts: DraftMap = {};
            for (const definition of SETTINGS) {
                nextGlobalDrafts[definition.key] = normalizeDraftValue(
                    definition,
                    globalRes.config[definition.key] ?? effectiveRes.config[definition.key] ?? definition.defaultValue,
                );
                nextLocalDrafts[definition.key] = normalizeDraftValue(
                    definition,
                    localRes.config[definition.key] ?? effectiveRes.config[definition.key] ?? definition.defaultValue,
                );
            }

            setGlobalDrafts(nextGlobalDrafts);
            setLocalDrafts(nextLocalDrafts);
        } catch (err) {
            setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            setLoading(false);
        }
    }, [apiClient]);

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

    const projectName = useMemo(
        () => daemonInfo?.projectName ?? projectId ?? 'project',
        [daemonInfo?.projectName, projectId],
    );

    const saveSetting = useCallback(async (definition: SettingDefinition, scope: 'global' | 'local') => {
        if (!apiClient) {
            return;
        }

        const sourceDrafts = scope === 'global' ? globalDrafts : localDrafts;
        const parsedValue = parseDraftValue(definition, sourceDrafts[definition.key]);
        setPendingKey(`${scope}:${definition.key}`);
        setError(null);
        setSuccessMessage(null);

        try {
            await apiClient.setConfig(definition.key, parsedValue, scope);
            await loadSettings();
            setSuccessMessage(`${definition.label} saved to ${scope} settings.`);
        } catch (err) {
            setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            setPendingKey(null);
        }
    }, [apiClient, globalDrafts, localDrafts, loadSettings]);

    const clearLocalOverride = useCallback(async (definition: SettingDefinition) => {
        if (!apiClient) {
            return;
        }

        const inheritedValue = globalConfig[definition.key] ?? definition.defaultValue;
        setPendingKey(`local:${definition.key}`);
        setError(null);
        setSuccessMessage(null);

        try {
            await apiClient.setConfig(definition.key, inheritedValue, 'local');
            await loadSettings();
            setSuccessMessage(`${definition.label} now inherits the global/default value.`);
        } catch (err) {
            setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            setPendingKey(null);
        }
    }, [apiClient, globalConfig, loadSettings]);

    const isLoading = connectionLoading || loading;
    const pageError = connectionError ?? error;

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <nav className={styles.breadcrumb} aria-label="Breadcrumb">
                        <Link to="/" className={styles.breadcrumbLink}>
                            Projects
                        </Link>
                        <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
                        {projectId ? (
                            <Link to={`/project/${projectId}`} className={styles.breadcrumbLink}>
                                {projectName}
                            </Link>
                        ) : (
                            <span>{projectName}</span>
                        )}
                        <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
                        <span>Settings</span>
                    </nav>
                    <h1 className={styles.title}>Settings</h1>
                    <p className={styles.subtitle}>
                        Edit the machine-wide defaults and this project&apos;s local overrides.
                    </p>
                </div>

                <div className={styles.headerActions}>
                    {projectId && (
                        <Link to={`/project/${projectId}`} className={styles.secondaryButton}>
                            Back to Sessions
                        </Link>
                    )}
                    <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => void loadSettings()}
                    >
                        Refresh
                    </button>
                </div>
            </div>

            <div className={styles.summaryGrid}>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>Global file</span>
                    <code className={styles.summaryValue}>~/.lanes/settings.yaml</code>
                </div>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>Project overrides</span>
                    <code className={styles.summaryValue}>.lanes/settings.yaml</code>
                </div>
                <div className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>Project</span>
                    <span className={styles.summaryValue}>{projectName}</span>
                </div>
            </div>

            {isLoading && (
                <div className={styles.loadingContainer} role="status" aria-label="Loading settings">
                    <div className={styles.spinner} aria-hidden="true" />
                    <span>Loading settings&hellip;</span>
                </div>
            )}

            {!isLoading && pageError && (
                <div className={styles.errorBanner} role="alert">
                    <div>
                        <div className={styles.errorTitle}>Failed to load settings</div>
                        <div className={styles.errorMessage}>{pageError.message}</div>
                    </div>
                </div>
            )}

            {!isLoading && !pageError && successMessage && (
                <div className={styles.successBanner} role="status">
                    {successMessage}
                </div>
            )}

            {!isLoading && !pageError && (
                <div className={styles.settingsList}>
                    {SETTINGS.map((definition) => {
                        const localOverrideActive = Object.prototype.hasOwnProperty.call(localConfig, definition.key);
                        const pendingGlobal = pendingKey === `global:${definition.key}`;
                        const pendingLocal = pendingKey === `local:${definition.key}`;

                        return (
                            <section key={definition.key} className={styles.settingCard}>
                                <div className={styles.settingHeader}>
                                    <div>
                                        <h2 className={styles.settingTitle}>{definition.label}</h2>
                                        <p className={styles.settingDescription}>{definition.description}</p>
                                    </div>
                                    <div className={styles.effectivePill}>
                                        <span className={styles.effectiveLabel}>Effective</span>
                                        <code className={styles.effectiveValue}>
                                            {formatValue(effectiveConfig[definition.key] ?? definition.defaultValue)}
                                        </code>
                                    </div>
                                </div>

                                <div className={styles.controlGrid}>
                                    <div className={styles.scopeCard}>
                                        <div className={styles.scopeHeader}>
                                            <div>
                                                <h3 className={styles.scopeTitle}>Global</h3>
                                                <p className={styles.scopeMeta}>Applies across all projects on this machine.</p>
                                            </div>
                                        </div>
                                        {renderInput(
                                            definition,
                                            globalDrafts[definition.key] ?? definition.defaultValue,
                                            `global-${definition.key}`,
                                            `Global ${definition.label}`,
                                            (value) => setGlobalDrafts((current) => ({ ...current, [definition.key]: value })),
                                        )}
                                        <div className={styles.scopeActions}>
                                            <button
                                                type="button"
                                                className={styles.primaryButton}
                                                disabled={pendingGlobal}
                                                onClick={() => void saveSetting(definition, 'global')}
                                            >
                                                {pendingGlobal ? 'Saving…' : 'Save global'}
                                            </button>
                                        </div>
                                    </div>

                                    <div className={styles.scopeCard}>
                                        <div className={styles.scopeHeader}>
                                            <div>
                                                <h3 className={styles.scopeTitle}>Local override</h3>
                                                <p className={styles.scopeMeta}>
                                                    {localOverrideActive ? 'Overrides the global value for this project.' : 'Currently inheriting the global/default value.'}
                                                </p>
                                            </div>
                                        </div>
                                        {renderInput(
                                            definition,
                                            localDrafts[definition.key] ?? effectiveConfig[definition.key] ?? definition.defaultValue,
                                            `local-${definition.key}`,
                                            `Local ${definition.label}`,
                                            (value) => setLocalDrafts((current) => ({ ...current, [definition.key]: value })),
                                        )}
                                        <div className={styles.scopeActions}>
                                            <button
                                                type="button"
                                                className={styles.primaryButton}
                                                disabled={pendingLocal}
                                                onClick={() => void saveSetting(definition, 'local')}
                                            >
                                                {pendingLocal ? 'Saving…' : 'Save override'}
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.secondaryButton}
                                                disabled={pendingLocal}
                                                onClick={() => void clearLocalOverride(definition)}
                                            >
                                                Reset override
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
