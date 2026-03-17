/**
 * ProjectCard — displays a summary card for a registered Lanes project.
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

function getConnectionMeta(health: HealthState, daemon: EnrichedDaemon['daemon']): { label: string; value: string } {
    if (!daemon) {
        return {
            label: 'Status',
            value: health === 'registered' ? 'Offline' : 'Unavailable',
        };
    }

    if (daemon.source === 'remote') {
        return {
            label: 'Daemon',
            value: daemon.baseUrl ?? 'Remote',
        };
    }

    return {
        label: 'Port',
        value: daemon.port !== null ? String(daemon.port) : 'Unknown',
    };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectCard({ enrichedDaemon }: ProjectCardProps) {
    const { project, daemon, discovery, health } = enrichedDaemon;
    const navigate = useNavigate();
    const isClickable = daemon !== null;

    const projectName = discovery?.projectName ?? daemon?.projectName ?? project.projectName;
    const secondaryLabel = discovery?.gitRemote ?? project.workspaceRoot;
    const sessionCount = discovery?.sessionCount ?? 0;
    const uptime = daemon?.startedAt ? formatUptime(uptimeSeconds(daemon.startedAt)) : daemon ? 'Unknown' : 'Not running';
    const connectionMeta = getConnectionMeta(health, daemon);
    const statusLabel = daemon ? (daemon.source === 'remote' ? 'Remote daemon' : 'Live daemon') : 'Ready to start';
    const statusDescription = daemon
        ? daemon.source === 'remote'
            ? 'Open this project to manage sessions through the registered remote daemon.'
            : 'Open this project to manage sessions.'
        : 'Open setup, run lanes daemon start, then refresh the project.';

    function handleClick() {
        if (!isClickable) {
            return;
        }
        void navigate(`/project/${project.projectId}`);
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (!isClickable) {
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
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onClick={isClickable ? handleClick : undefined}
            onKeyDown={isClickable ? handleKeyDown : undefined}
            aria-label={isClickable ? `Open project ${projectName}` : undefined}
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

            {secondaryLabel && (
                <p className={styles.gitRemote} title={secondaryLabel}>
                    {secondaryLabel}
                </p>
            )}

            <div className={styles.actionBanner}>
                <span className={styles.actionTitle}>{statusLabel}</span>
                <span className={styles.actionDescription}>{statusDescription}</span>
            </div>

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
                    <span className={styles.metaLabel}>{connectionMeta.label}</span>
                    <span className={styles.metaValue}>{connectionMeta.value}</span>
                </span>
            </div>
        </div>
    );
}
