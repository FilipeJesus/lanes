import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepProgressTracker } from '../../components/StepProgressTracker';
import type { WorkflowStep } from '../../api/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
    return {
        id: 'my-step',
        type: 'step',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StepProgressTracker', () => {
    it('Given no steps, then an empty state message is rendered', () => {
        render(<StepProgressTracker steps={[]} />);
        expect(screen.getByText('No steps defined.')).toBeInTheDocument();
    });

    it('Given a completed step, then the step is rendered with completed state', () => {
        const steps = [makeStep({ id: 'plan', type: 'step' })];
        render(
            <StepProgressTracker
                steps={steps}
                completedSteps={['plan']}
                currentStep={undefined}
            />
        );

        const stepEl = screen.getByTestId('step-plan');
        expect(stepEl).toBeInTheDocument();
        expect(stepEl).toHaveAttribute('data-step-state', 'completed');
    });

    it('Given a current step, then that step has aria-current=step', () => {
        const steps = [
            makeStep({ id: 'plan', type: 'step' }),
            makeStep({ id: 'implement', type: 'step' }),
        ];
        render(
            <StepProgressTracker
                steps={steps}
                completedSteps={['plan']}
                currentStep="implement"
            />
        );

        const currentStepEl = screen.getByTestId('step-implement');
        expect(currentStepEl).toHaveAttribute('aria-current', 'step');
        expect(currentStepEl).toHaveAttribute('data-step-state', 'current');
    });

    it('Given pending steps, then they render with pending state', () => {
        const steps = [
            makeStep({ id: 'plan', type: 'step' }),
            makeStep({ id: 'implement', type: 'step' }),
            makeStep({ id: 'test', type: 'step' }),
        ];
        render(
            <StepProgressTracker
                steps={steps}
                completedSteps={['plan']}
                currentStep="implement"
            />
        );

        const pendingStep = screen.getByTestId('step-test');
        expect(pendingStep).toHaveAttribute('data-step-state', 'pending');
        expect(pendingStep).not.toHaveAttribute('aria-current');
    });

    it('Given a step with type "loop", then a "loop" type badge is shown', () => {
        const steps = [makeStep({ id: 'build-loop', type: 'loop', description: 'Build tasks' })];
        render(<StepProgressTracker steps={steps} />);

        // The type badge should show "loop"
        expect(screen.getByTitle('Step type: loop')).toBeInTheDocument();
    });

    it('Given a step with type "ralph", then a "ralph" type badge is shown', () => {
        const steps = [makeStep({ id: 'repeat-step', type: 'ralph' })];
        render(<StepProgressTracker steps={steps} />);

        expect(screen.getByTitle('Step type: ralph')).toBeInTheDocument();
    });

    it('Given a step with a description, then the description text is shown', () => {
        const steps = [makeStep({ id: 'plan', type: 'step', description: 'Plan the feature in detail' })];
        render(<StepProgressTracker steps={steps} />);

        expect(screen.getByText('Plan the feature in detail')).toBeInTheDocument();
    });

    it('Given multiple steps with one current, then "current" label is shown only for the current step', () => {
        const steps = [
            makeStep({ id: 'plan', type: 'step' }),
            makeStep({ id: 'implement', type: 'step' }),
        ];
        render(
            <StepProgressTracker
                steps={steps}
                completedSteps={['plan']}
                currentStep="implement"
            />
        );

        const currentLabels = screen.getAllByText('current');
        expect(currentLabels).toHaveLength(1);
    });

    it('Given an iteration count for a loop step, then the count is displayed', () => {
        const steps = [makeStep({ id: 'build', type: 'loop' })];
        render(
            <StepProgressTracker
                steps={steps}
                iterationCounts={{ build: { current: 3, total: 5 } }}
            />
        );

        expect(screen.getByText('3/5')).toBeInTheDocument();
    });

    it('Given steps list is rendered, then the list has aria-label "Workflow steps"', () => {
        const steps = [makeStep({ id: 'plan', type: 'step' })];
        render(<StepProgressTracker steps={steps} />);

        expect(screen.getByRole('list', { name: 'Workflow steps' })).toBeInTheDocument();
    });
});
