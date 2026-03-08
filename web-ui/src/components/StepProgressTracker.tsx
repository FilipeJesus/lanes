/**
 * StepProgressTracker — visual pipeline showing completed/current/pending steps
 * for a workflow.
 *
 * Steps are shown as a vertical list with colored dots connected by lines:
 * - Completed steps: green dot with checkmark
 * - Current step:    blue pulsing dot
 * - Pending steps:   grey outlined dot
 *
 * Loop and ralph step types show a type badge and optional iteration counter.
 */

import type { WorkflowStep } from '../api/types';
import styles from '../styles/StepProgressTracker.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StepProgressTrackerProps {
    /** All steps in the workflow (from WorkflowInfo.steps) */
    steps: WorkflowStep[];
    /** The ID of the currently executing step */
    currentStep?: string;
    /** IDs of steps that have been completed */
    completedSteps?: string[];
    /**
     * For loop/ralph steps: a map from step ID to iteration info.
     * E.g. { "build-loop": { current: 3, total: 5 } }
     */
    iterationCounts?: Record<string, { current: number; total: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StepState = 'completed' | 'current' | 'pending';

function getStepState(
    stepId: string,
    currentStep: string | undefined,
    completedSteps: string[]
): StepState {
    if (completedSteps.includes(stepId)) return 'completed';
    if (stepId === currentStep) return 'current';
    return 'pending';
}

function getTypeBadgeClass(type: string): string {
    switch (type.toLowerCase()) {
        case 'loop':
            return styles.typeBadgeLoop;
        case 'ralph':
            return styles.typeBadgeRalph;
        case 'step':
            return styles.typeBadgeStep;
        default:
            return styles.typeBadgeOther;
    }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StepDotProps {
    state: StepState;
}

function StepDot({ state }: StepDotProps) {
    const dotClass = [
        styles.dot,
        state === 'completed' ? styles.dotCompleted : '',
        state === 'current' ? styles.dotCurrent : '',
        state === 'pending' ? styles.dotPending : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div className={dotClass} aria-hidden="true">
            {state === 'completed' && '✓'}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StepProgressTracker({
    steps,
    currentStep,
    completedSteps = [],
    iterationCounts = {},
}: StepProgressTrackerProps) {
    if (steps.length === 0) {
        return <p className={styles.empty}>No steps defined.</p>;
    }

    return (
        <ol className={styles.root} aria-label="Workflow steps">
            {steps.map((step) => {
                const state = getStepState(step.id, currentStep, completedSteps);
                const iteration = iterationCounts[step.id];
                const isLoopType = step.type.toLowerCase() === 'loop' || step.type.toLowerCase() === 'ralph';

                const stepClass = [
                    styles.step,
                    state === 'completed' ? styles.completed : '',
                ]
                    .filter(Boolean)
                    .join(' ');

                const stepIdClass = [
                    styles.stepId,
                    state === 'current' ? styles.stepIdCurrent : '',
                    state === 'completed' ? styles.stepIdCompleted : '',
                ]
                    .filter(Boolean)
                    .join(' ');

                return (
                    <li
                        key={step.id}
                        className={stepClass}
                        aria-current={state === 'current' ? 'step' : undefined}
                        data-step-state={state}
                        data-testid={`step-${step.id}`}
                    >
                        <div className={styles.stepRow}>
                            <StepDot state={state} />

                            <div className={styles.stepContent}>
                                <div className={styles.stepHeader}>
                                    <span className={stepIdClass}>{step.id}</span>

                                    <span
                                        className={`${styles.typeBadge} ${getTypeBadgeClass(step.type)}`}
                                        title={`Step type: ${step.type}`}
                                    >
                                        {step.type}
                                    </span>

                                    {isLoopType && iteration && (
                                        <span className={styles.iterationCounter}>
                                            {iteration.current}/{iteration.total}
                                        </span>
                                    )}

                                    {state === 'current' && (
                                        <span className={styles.currentLabel}>current</span>
                                    )}
                                </div>

                                {step.description && (
                                    <p className={styles.stepDescription}>{step.description}</p>
                                )}
                            </div>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
