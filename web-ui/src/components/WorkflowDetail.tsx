/**
 * WorkflowDetail — shows full details for a single workflow template.
 *
 * Displays the workflow name, description, path, builtin flag, and a list
 * of all step definitions with their types and descriptions.
 */

import type { WorkflowInfo } from '../api/types';
import { getWorkflowTypeBadgeClass } from '../utils/workflowTypeBadge';
import styles from '../styles/WorkflowDetail.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WorkflowDetailProps {
    workflow: WorkflowInfo;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkflowDetail({ workflow }: WorkflowDetailProps) {
    return (
        <div className={styles.root} data-testid="workflow-detail">
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.titleRow}>
                    <h2 className={styles.workflowName}>{workflow.name}</h2>
                    {workflow.isBuiltin && (
                        <span className={styles.builtinBadge} aria-label="Built-in workflow">
                            builtin
                        </span>
                    )}
                </div>

                {workflow.description && (
                    <p className={styles.description}>{workflow.description}</p>
                )}
            </div>

            {/* Metadata */}
            {workflow.path && (
                <div className={styles.meta}>
                    <div className={styles.metaRow}>
                        <span className={styles.metaLabel}>Path</span>
                        <span className={styles.metaValue} title={workflow.path}>
                            {workflow.path}
                        </span>
                    </div>
                </div>
            )}

            {/* Steps */}
            <div className={styles.stepsSection}>
                <h3 className={styles.sectionTitle}>
                    Steps
                    {workflow.steps && workflow.steps.length > 0 && (
                        <> ({workflow.steps.length})</>
                    )}
                </h3>

                {!workflow.steps || workflow.steps.length === 0 ? (
                    <p className={styles.noSteps}>No steps defined for this workflow.</p>
                ) : (
                    <ol className={styles.stepList} aria-label={`Steps in ${workflow.name}`}>
                        {workflow.steps.map((step, index) => (
                            <li
                                key={step.id}
                                className={styles.stepRow}
                                data-testid={`workflow-step-${step.id}`}
                            >
                                <div className={styles.stepRowHeader}>
                                    <span className={styles.stepIndex} aria-hidden="true">
                                        {index + 1}.
                                    </span>
                                    <span className={styles.stepId}>{step.id}</span>
                                    <span
                                        className={`${styles.typeBadge} ${getWorkflowTypeBadgeClass(step.type, styles)}`}
                                        title={`Step type: ${step.type}`}
                                    >
                                        {step.type}
                                    </span>
                                </div>

                                {step.description && (
                                    <p className={styles.stepDescription}>{step.description}</p>
                                )}
                            </li>
                        ))}
                    </ol>
                )}
            </div>
        </div>
    );
}
