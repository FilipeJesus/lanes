/**
 * ConfirmDialog — reusable modal confirmation dialog.
 *
 * Renders a title + message with Cancel and Confirm (destructive) buttons.
 * The dialog is removed from the DOM when isOpen is false.
 */

import { useEffect, useId, useRef } from 'react';
import styles from '../styles/ConfirmDialog.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConfirmDialogProps {
    isOpen: boolean;
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    /** While true the action buttons are disabled (e.g. during async delete) */
    isPending?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfirmDialog({
    isOpen,
    title = 'Confirm',
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
    isPending = false,
}: ConfirmDialogProps) {
    const cancelRef = useRef<HTMLButtonElement>(null);
    const titleId = useId();

    // Auto-focus the cancel button when dialog opens (safe default for destructive actions)
    useEffect(() => {
        if (isOpen) {
            cancelRef.current?.focus();
        }
    }, [isOpen]);

    // Close on Escape key
    useEffect(() => {
        if (!isOpen) return;

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                onCancel();
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onCancel]);

    if (!isOpen) return null;

    function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
        if (e.target === e.currentTarget) {
            onCancel();
        }
    }

    return (
        <div
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={handleOverlayClick}
        >
            <div className={styles.dialog}>
                <h2 id={titleId} className={styles.title}>
                    {title}
                </h2>
                <p className={styles.message}>{message}</p>
                <div className={styles.actions}>
                    <button
                        ref={cancelRef}
                        type="button"
                        className={styles.cancelButton}
                        onClick={onCancel}
                        disabled={isPending}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className={styles.confirmButton}
                        onClick={onConfirm}
                        disabled={isPending}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
