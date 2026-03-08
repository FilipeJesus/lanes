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
                        All active Lanes daemons discovered on this machine
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
                    <div className={styles.emptyStateTitle}>No projects running</div>
                    <p className={styles.emptyStateDescription}>
                        Start a Lanes daemon in your project directory to see it here.
                    </p>
                    <code className={styles.emptyStateCommand}>lanes start</code>
                </div>
            )}

            {!error && daemons.length > 0 && (
                <div className={styles.grid}>
                    {daemons.map((enriched) => (
                        <ProjectCard
                            key={enriched.daemon.port}
                            enrichedDaemon={enriched}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
