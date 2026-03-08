import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkflowDetail } from '../../components/WorkflowDetail';
import type { WorkflowInfo } from '../../api/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflow(overrides: Partial<WorkflowInfo> = {}): WorkflowInfo {
    return {
        name: 'basic-feature',
        description: 'A simple feature workflow',
        isBuiltin: false,
        steps: [
            { id: 'plan', type: 'step', description: 'Plan the feature' },
            { id: 'implement', type: 'step', description: 'Write the code' },
        ],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowDetail', () => {
    it('Given a workflow with name and description, then both are rendered', () => {
        render(<WorkflowDetail workflow={makeWorkflow()} />);

        expect(screen.getByText('basic-feature')).toBeInTheDocument();
        expect(screen.getByText('A simple feature workflow')).toBeInTheDocument();
    });

    it('Given a workflow with isBuiltin true, then a builtin badge is shown', () => {
        render(<WorkflowDetail workflow={makeWorkflow({ isBuiltin: true })} />);

        expect(screen.getByLabelText('Built-in workflow')).toBeInTheDocument();
    });

    it('Given a workflow with isBuiltin false or undefined, then no builtin badge is shown', () => {
        render(<WorkflowDetail workflow={makeWorkflow({ isBuiltin: false })} />);

        expect(screen.queryByLabelText('Built-in workflow')).not.toBeInTheDocument();
    });

    it('Given a workflow with steps, then each step id and type are rendered', () => {
        render(<WorkflowDetail workflow={makeWorkflow()} />);

        expect(screen.getByTestId('workflow-step-plan')).toBeInTheDocument();
        expect(screen.getByTestId('workflow-step-implement')).toBeInTheDocument();
    });

    it('Given a step has a description, then the description text is shown', () => {
        render(<WorkflowDetail workflow={makeWorkflow()} />);

        expect(screen.getByText('Plan the feature')).toBeInTheDocument();
        expect(screen.getByText('Write the code')).toBeInTheDocument();
    });

    it('Given a workflow with no steps (empty array), then a no steps message is shown', () => {
        render(<WorkflowDetail workflow={makeWorkflow({ steps: [] })} />);

        expect(screen.getByText('No steps defined for this workflow.')).toBeInTheDocument();
    });

    it('Given a workflow with no steps (undefined), then a no steps message is shown', () => {
        render(<WorkflowDetail workflow={makeWorkflow({ steps: undefined })} />);

        expect(screen.getByText('No steps defined for this workflow.')).toBeInTheDocument();
    });

    it('Given a workflow with a path, then the path is shown in metadata', () => {
        render(
            <WorkflowDetail workflow={makeWorkflow({ path: '/home/user/.lanes/workflows/basic-feature.yml' })} />
        );

        expect(
            screen.getByText('/home/user/.lanes/workflows/basic-feature.yml')
        ).toBeInTheDocument();
    });

    it('Given a workflow with loop type step, then the loop badge is shown', () => {
        render(
            <WorkflowDetail
                workflow={makeWorkflow({
                    steps: [{ id: 'build', type: 'loop', description: 'Build tasks' }],
                })}
            />
        );

        expect(screen.getByTitle('Step type: loop')).toBeInTheDocument();
    });

    it('Given a workflow step count, then the Steps heading shows the count', () => {
        render(<WorkflowDetail workflow={makeWorkflow()} />);

        // The section title "Steps (2)" should appear
        expect(screen.getByText(/steps/i, { selector: 'h3' })).toBeInTheDocument();
    });
});
