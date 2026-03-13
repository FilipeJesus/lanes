import { Link } from 'react-router-dom';
import type { ProjectConnectionState as ConnectionState } from '../hooks/useDaemonConnection';
import styles from '../styles/ProjectConnectionState.module.css';

interface ProjectConnectionStateProps {
    state: Extract<ConnectionState, 'offline' | 'missing'>;
    projectId?: string;
    projectName: string;
    workspaceRoot?: string;
    registeredAt?: string;
    onRefresh?: () => void;
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatCommand(workspaceRoot: string | undefined, command: string): string {
    if (!workspaceRoot) {
        return command;
    }

    return `cd ${shellQuote(workspaceRoot)} && ${command}`;
}

function formatRegisteredAt(registeredAt: string | undefined): string | null {
    if (!registeredAt) {
        return null;
    }

    const parsed = new Date(registeredAt);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}

export function ProjectConnectionState({
    state,
    projectId,
    projectName,
    workspaceRoot,
    registeredAt,
    onRefresh,
}: ProjectConnectionStateProps) {
    const isOffline = state === 'offline';
    const formattedRegisteredAt = formatRegisteredAt(registeredAt);
    const startCommand = formatCommand(workspaceRoot, 'lanes daemon start');
    const registerCommand = formatCommand(workspaceRoot, 'lanes daemon register .');
    const unregisterCommand = workspaceRoot
        ? `lanes daemon unregister ${shellQuote(workspaceRoot)}`
        : 'lanes daemon unregister /absolute/path/to/repo';
    const stepOneTitle = isOffline ? 'Launch the project daemon' : 'Re-register the project';
    const stepOneDescription = isOffline
        ? 'Run this inside the project root so Lanes can attach the daemon to the correct repo.'
        : 'Run this from the repo root to restore the machine-wide project entry before reconnecting.';
    const stepOneCommand = isOffline ? startCommand : registerCommand;
    const stepTwoTitle = isOffline ? 'Reconnect this page' : 'Reconnect after registration';
    const stepTwoDescription = isOffline
        ? 'Once the daemon is running, refresh the connection here to load sessions, workflows, and settings.'
        : 'Once the project is registered again, refresh this page or return to the dashboard to confirm it is available.';
    const recoveryDescription = workspaceRoot
        ? 'Re-register the repo if it moved, or remove the stale machine-wide entry if you no longer need it.'
        : 'Re-register from the repo root, or replace /absolute/path/to/repo below with the stale workspace path to remove it.';

    return (
        <section className={styles.panel} aria-label="Project connection guide">
            <div className={styles.hero}>
                <span className={styles.eyebrow}>
                    {isOffline ? 'Start And Connect' : 'Recover Registration'}
                </span>
                <h2 className={styles.title}>
                    {isOffline ? 'This project is registered, but its daemon is offline.' : 'This project link is no longer connected.'}
                </h2>
                <p className={styles.description}>
                    {isOffline
                        ? 'Start the daemon from the project root, then reconnect this page. If the repo moved or was removed, use the recovery commands below.'
                        : 'Re-register the repo from its root or remove the stale entry if this workspace no longer exists on this machine.'}
                </p>

                <div className={styles.facts}>
                    <div className={styles.fact}>
                        <span className={styles.factLabel}>Project</span>
                        <span className={styles.factValue}>{projectName}</span>
                    </div>
                    {workspaceRoot && (
                        <div className={styles.fact}>
                            <span className={styles.factLabel}>Workspace</span>
                            <code className={styles.factCode}>{workspaceRoot}</code>
                        </div>
                    )}
                    {formattedRegisteredAt && (
                        <div className={styles.fact}>
                            <span className={styles.factLabel}>Registered</span>
                            <span className={styles.factValue}>{formattedRegisteredAt}</span>
                        </div>
                    )}
                </div>
            </div>

            <div className={styles.cardGrid}>
                <article className={styles.card}>
                    <span className={styles.cardStep}>{isOffline ? '1. Start' : '1. Restore'}</span>
                    <h3 className={styles.cardTitle}>{stepOneTitle}</h3>
                    <p className={styles.cardDescription}>{stepOneDescription}</p>
                    <code className={styles.command}>{stepOneCommand}</code>
                </article>

                <article className={styles.card}>
                    <span className={styles.cardStep}>2. Connect</span>
                    <h3 className={styles.cardTitle}>{stepTwoTitle}</h3>
                    <p className={styles.cardDescription}>{stepTwoDescription}</p>
                    {onRefresh ? (
                        <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={onRefresh}
                        >
                            Refresh Connection
                        </button>
                    ) : (
                        <span className={styles.helperText}>Use the refresh control after the daemon starts.</span>
                    )}
                </article>

                <article className={styles.card}>
                    <span className={styles.cardStep}>3. Recover</span>
                    <h3 className={styles.cardTitle}>Repair stale registration</h3>
                    <p className={styles.cardDescription}>{recoveryDescription}</p>
                    <code className={styles.command}>{registerCommand}</code>
                    <code className={styles.command}>{unregisterCommand}</code>
                </article>
            </div>

            {projectId && (
                <div className={styles.footer}>
                    <Link to={`/project/${projectId}`} className={styles.secondaryLink}>
                        Back to project
                    </Link>
                    <Link to="/" className={styles.secondaryLink}>
                        Back to projects
                    </Link>
                </div>
            )}
        </section>
    );
}
