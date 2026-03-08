import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkflowTaskList } from '../../components/WorkflowTaskList';
import type { TaskStatus } from '../../components/WorkflowTaskList';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowTaskList', () => {
    it('Given an empty tasks array, then an empty state message is shown', () => {
        render(<WorkflowTaskList tasks={[]} />);
        expect(screen.getByText('No tasks.')).toBeInTheDocument();
    });

    it('Given tasks provided, then each task is rendered in the list', () => {
        const tasks = ['Write unit tests', 'Update documentation', 'Create PR'];
        render(<WorkflowTaskList tasks={tasks} />);

        expect(screen.getByText('Write unit tests')).toBeInTheDocument();
        expect(screen.getByText('Update documentation')).toBeInTheDocument();
        expect(screen.getByText('Create PR')).toBeInTheDocument();
    });

    it('Given a title prop, then the title is rendered above the list', () => {
        render(<WorkflowTaskList tasks={['Task A']} title="Build Tasks" />);
        expect(screen.getByText('Build Tasks')).toBeInTheDocument();
    });

    it('Given no title prop, then no title element is rendered', () => {
        render(<WorkflowTaskList tasks={['Task A']} />);
        // The tasks list has aria-label of "Workflow tasks" when no title
        expect(screen.getByRole('list', { name: 'Workflow tasks' })).toBeInTheDocument();
    });

    it('Given a task with status "done", then a "Done" aria-label is on the status indicator', () => {
        render(
            <WorkflowTaskList
                tasks={['My task']}
                taskStatuses={{ 'My task': 'done' as TaskStatus }}
            />
        );

        expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument();
    });

    it('Given a task with status "in_progress", then "In progress" aria-label is on indicator', () => {
        render(
            <WorkflowTaskList
                tasks={['Active task']}
                taskStatuses={{ 'Active task': 'in_progress' as TaskStatus }}
            />
        );

        expect(screen.getByRole('img', { name: 'In progress' })).toBeInTheDocument();
    });

    it('Given a task with status "failed", then "Failed" aria-label is on the indicator', () => {
        render(
            <WorkflowTaskList
                tasks={['Broken task']}
                taskStatuses={{ 'Broken task': 'failed' as TaskStatus }}
            />
        );

        expect(screen.getByRole('img', { name: 'Failed' })).toBeInTheDocument();
    });

    it('Given tasks without explicit statuses, then all default to "Pending" indicators', () => {
        render(<WorkflowTaskList tasks={['Task 1', 'Task 2']} />);

        const pendingIndicators = screen.getAllByRole('img', { name: 'Pending' });
        expect(pendingIndicators).toHaveLength(2);
    });

    it('Given three tasks, then the list contains three items', () => {
        render(<WorkflowTaskList tasks={['A', 'B', 'C']} />);

        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(3);
    });
});
