/**
 * Workflow Browser page — browse and inspect available workflow templates.
 *
 * Route: /project/:port/workflows
 * Uses the :port param to connect to the right daemon and fetch its workflows.
 *
 * Features:
 * - Lists all available workflow templates (builtin + custom)
 * - Search/filter by name
 * - Toggle: builtin / custom / all
 * - Click a workflow card to show its detail in a panel on the right
 */

import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDaemonConnection } from '../hooks/useDaemonConnection';
import { useWorkflows } from '../hooks/useWorkflows';
import { WorkflowDetail } from '../components/WorkflowDetail';
import type { WorkflowInfo } from '../api/types';
import styles from '../styles/WorkflowBrowser.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterMode = 'all' | 'builtin' | 'custom';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkflowBrowser() {
    const { port } = useParams<{ port?: string }>();
    const portNum = port ? parseInt(port, 10) : undefined;

    const { apiClient, daemonInfo, loading: connectionLoading, error: connectionError } =
        useDaemonConnection(portNum);

    const [filterMode, setFilterMode] = useState<FilterMode>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowInfo | null>(null);

    const workflowOptions = useMemo(() => {
        if (filterMode === 'all') return {};
        if (filterMode === 'builtin') return { includeBuiltin: true, includeCustom: false };
        return { includeBuiltin: false, includeCustom: true };
    }, [filterMode]);

    const {
        workflows,
        loading: workflowsLoading,
        error: workflowsError,
        refresh,
    } = useWorkflows(apiClient, workflowOptions);

    // Filter by search query
    const filteredWorkflows = useMemo(() => {
        if (!searchQuery.trim()) return workflows;
        const q = searchQuery.toLowerCase();
        return workflows.filter(
            (w) =>
                w.name.toLowerCase().includes(q) ||
                (w.description?.toLowerCase().includes(q) ?? false)
        );
    }, [workflows, searchQuery]);

    const isLoading = connectionLoading || workflowsLoading;
    const error = connectionError ?? workflowsError;

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    return (
        <div className={styles.page}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    {port && (
                        <nav aria-label="Breadcrumb">
                            <Link to={`/project/${port}`} className={`${styles.secondaryButton} ${styles.backLink}`}>
                                &larr; Back to project
                            </Link>
                        </nav>
                    )}
                    <h1 className={styles.title}>Workflows</h1>
                    {port && (
                        <span className={styles.subtitle}>
                            {daemonInfo?.projectName ?? `Port ${port}`}
                        </span>
                    )}
                </div>

                <div className={styles.toolbar}>
                    <input
                        type="search"
                        className={styles.searchInput}
                        placeholder="Search workflows&hellip;"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        aria-label="Search workflows"
                    />

                    <div className={styles.filterGroup} role="group" aria-label="Filter workflows">
                        {(['all', 'builtin', 'custom'] as FilterMode[]).map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                className={`${styles.filterButton} ${filterMode === mode ? styles.filterButtonActive : ''}`}
                                onClick={() => setFilterMode(mode)}
                                aria-pressed={filterMode === mode}
                            >
                                {mode.charAt(0).toUpperCase() + mode.slice(1)}
                            </button>
                        ))}
                    </div>

                    <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => refresh()}
                        disabled={isLoading}
                        aria-label="Refresh workflow list"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {/* No port selected */}
            {!port && (
                <div className={styles.infoBanner} role="status">
                    <div className={styles.infoBannerTitle}>Select a project first</div>
                    Navigate to a project from the Dashboard to browse its workflows, or visit{' '}
                    <Link to="/">the Dashboard</Link>.
                </div>
            )}

            {/* Loading */}
            {isLoading && !error && (
                <div className={styles.loadingContainer} role="status" aria-label="Loading workflows">
                    <div className={styles.spinner} aria-hidden="true" />
                    <span>Loading workflows&hellip;</span>
                </div>
            )}

            {/* Error */}
            {!isLoading && error && (
                <div className={styles.errorBanner} role="alert">
                    <div className={styles.errorTitle}>Failed to load workflows</div>
                    <div className={styles.errorMessage}>{error.message}</div>
                </div>
            )}

            {/* Content */}
            {port && !isLoading && !error && (
                <div className={styles.contentLayout}>
                    {/* Left panel: workflow list */}
                    <div className={styles.listPanel}>
                        <div className={styles.listPanelTitle}>
                            Templates
                            {filteredWorkflows.length > 0 && (
                                <span className={styles.workflowCount}>
                                    {filteredWorkflows.length}
                                </span>
                            )}
                        </div>

                        {filteredWorkflows.length === 0 ? (
                            <p className={styles.emptyState}>
                                {searchQuery ? 'No workflows match your search.' : 'No workflows available.'}
                            </p>
                        ) : (
                            filteredWorkflows.map((workflow) => {
                                const isActive = selectedWorkflow?.name === workflow.name;
                                return (
                                    <button
                                        key={workflow.name}
                                        type="button"
                                        className={`${styles.workflowCard} ${isActive ? styles.workflowCardActive : ''}`}
                                        onClick={() =>
                                            setSelectedWorkflow(isActive ? null : workflow)
                                        }
                                        aria-pressed={isActive}
                                        data-testid={`workflow-card-${workflow.name}`}
                                    >
                                        <div className={styles.cardHeader}>
                                            <span className={styles.cardName}>{workflow.name}</span>
                                            {workflow.isBuiltin && (
                                                <span className={styles.builtinBadge}>builtin</span>
                                            )}
                                        </div>

                                        {workflow.description && (
                                            <span className={styles.cardDescription}>
                                                {workflow.description}
                                            </span>
                                        )}

                                        {workflow.steps && (
                                            <span className={styles.cardStepCount}>
                                                {workflow.steps.length} step
                                                {workflow.steps.length !== 1 ? 's' : ''}
                                            </span>
                                        )}
                                    </button>
                                );
                            })
                        )}
                    </div>

                    {/* Right panel: workflow detail */}
                    <div className={styles.detailPanel} data-testid="detail-panel">
                        {selectedWorkflow ? (
                            <WorkflowDetail workflow={selectedWorkflow} />
                        ) : (
                            <p className={styles.detailEmpty}>
                                Select a workflow to view its details.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
