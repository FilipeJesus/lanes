/**
 * ProjectCard — displays a summary card for a single running Lanes daemon.
 *
 * Shows the project name, git remote, session count, uptime, and a colour-coded
 * health indicator. Clicking the card navigates to the project detail view.
 */

import { useNavigate } from 'react-router-dom';
import type { EnrichedDaemon, HealthState } from '../hooks/useDaemons';
import { formatUptime } from '../utils/formatUptime';
import styles from '../styles/ProjectCard.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProjectCardProps {
    enrichedDaemon: EnrichedDaemon;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function healthClassName(health: HealthState): string {
    switch (health) {
        case 'healthy':
            return styles.healthHealthy;
        case 'degraded':
            return styles.healthDegraded;
        case 'unreachable':
            return styles.healthUnreachable;
        case 'registered':
            return styles.healthDegraded;
    }
}

function uptimeSeconds(startedAt: string): number {
    const startMs = new Date(startedAt).getTime();
    if (Number.isNaN(startMs)) return 0;
    return Math.max(0, (Date.now() - startMs) / 1000);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectCard({ enrichedDaemon }: ProjectCardProps) {
    const { project, daemon, discovery, health } = enrichedDaemon;
    const navigate = useNavigate();

    const projectName = discovery?.projectName ?? daemon?.projectName ?? project.projectName;
    const gitRemote = discovery?.gitRemote ?? null;
    const sessionCount = discovery?.sessionCount ?? 0;
    const uptime = daemon ? formatUptime(uptimeSeconds(daemon.startedAt)) : 'Not running';
    const portLabel = daemon ? String(daemon.port) : 'Offline';
    const isRunning = daemon !== null;

    function handleClick() {
        if (!daemon) {
            return;
        }
        void navigate(`/project/${project.projectId}`);
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (!daemon) {
            return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void navigate(`/project/${project.projectId}`);
        }
    }

    return (
        <div
            className={styles.card}
            role={isRunning ? 'button' : 'article'}
            tabIndex={isRunning ? 0 : undefined}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            aria-label={isRunning ? `Open project ${projectName}` : `Registered project ${projectName}`}
        >
            <div className={styles.cardHeader}>
                <h2 className={styles.projectName}>{projectName}</h2>
                <div
                    className={`${styles.healthIndicator} ${healthClassName(health)}`}
                    role="img"
                    aria-label={`Health: ${health}`}
                    title={health}
                />
            </div>

            {gitRemote && (
                <p className={styles.gitRemote} title={gitRemote}>
                    {gitRemote}
                </p>
            )}

            <div className={styles.cardMeta}>
                <span className={styles.metaItem}>
                    <span className={styles.metaLabel}>Sessions</span>
                    <span className={styles.metaValue}>{sessionCount}</span>
                </span>
                <span className={styles.metaItem}>
                    <span className={styles.metaLabel}>Uptime</span>
                    <span className={styles.metaValue}>{uptime}</span>
                </span>
                <span className={styles.metaItem}>
                    <span className={styles.metaLabel}>Port</span>
                    <span className={styles.metaValue}>{portLabel}</span>
                </span>
            </div>
        </div>
    );
}
