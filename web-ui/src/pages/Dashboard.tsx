/**
 * Dashboard page — shows all running projects (daemons) discovered via the gateway.
 *
 * Fetches the daemon list on mount, enriches each entry with discovery info and
 * health status, and renders a responsive grid of ProjectCards.
 */

import { useDaemons } from '../hooks/useDaemons';
import { ProjectCard } from '../components/ProjectCard';
import styles from '../styles/Dashboard.module.css';

export function Dashboard() {
    const { daemons, loading, error, refresh } = useDaemons();

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div>
                    <h1 className={styles.title}>Projects</h1>
                    <p className={styles.subtitle}>
                        Registered Lanes projects from local and remote daemons, with live connection status
                    </p>
                </div>
                <button
                    type="button"
                    className={styles.refreshButton}
                    onClick={refresh}
                    aria-label="Refresh project list"
                >
                    Refresh
                </button>
            </div>

            {loading && daemons.length === 0 && (
                <div className={styles.loadingContainer} role="status" aria-label="Loading projects">
                    <div className={styles.spinner} aria-hidden="true" />
                    <span>Discovering projects&hellip;</span>
                </div>
            )}

            {!loading && error && (
                <div className={styles.errorBanner} role="alert">
                    <div>
                        <div className={styles.errorTitle}>Failed to load projects</div>
                        <div className={styles.errorMessage}>{error.message}</div>
                    </div>
                </div>
            )}

            {!loading && !error && daemons.length === 0 && (
                <div className={styles.emptyState}>
                    <div className={styles.emptyStateTitle}>No projects registered</div>
                    <p className={styles.emptyStateDescription}>
                        Register a repo locally, or register a remote daemon to browse the projects it tracks.
                    </p>
                    <code className={styles.emptyStateCommand}>lanes daemon register .</code>
                </div>
            )}

            {!error && daemons.length > 0 && (
                <div className={styles.grid}>
                    {daemons.map((enriched) => (
                        <ProjectCard
                            key={enriched.project.projectId}
                            enrichedDaemon={enriched}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
