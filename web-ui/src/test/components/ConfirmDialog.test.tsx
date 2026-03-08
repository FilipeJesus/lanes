import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '../../components/ConfirmDialog';

describe('ConfirmDialog', () => {
    it('Given isOpen=true, then dialog is visible with provided message', () => {
        render(
            <ConfirmDialog
                isOpen={true}
                message="Are you sure you want to delete this?"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Are you sure you want to delete this?')).toBeInTheDocument();
    });

    it('Given isOpen=false, then dialog is not rendered', () => {
        render(
            <ConfirmDialog
                isOpen={false}
                message="Are you sure?"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('When user clicks the confirm button, then onConfirm callback is called', async () => {
        const onConfirm = vi.fn();
        const user = userEvent.setup();

        render(
            <ConfirmDialog
                isOpen={true}
                message="Are you sure?"
                onConfirm={onConfirm}
                onCancel={vi.fn()}
            />
        );

        await user.click(screen.getByRole('button', { name: /confirm/i }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('When user clicks the cancel button, then onCancel callback is called', async () => {
        const onCancel = vi.fn();
        const user = userEvent.setup();

        render(
            <ConfirmDialog
                isOpen={true}
                message="Are you sure?"
                onConfirm={vi.fn()}
                onCancel={onCancel}
            />
        );

        await user.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('Given custom confirmLabel and cancelLabel, then those labels are rendered', () => {
        render(
            <ConfirmDialog
                isOpen={true}
                message="Delete it?"
                confirmLabel="Delete"
                cancelLabel="Go back"
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
    });
});
