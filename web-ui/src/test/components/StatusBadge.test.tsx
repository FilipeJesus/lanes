import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../../components/StatusBadge';
import type { AgentStatusState } from '../../api/types';

describe('StatusBadge', () => {
    it('Given status="working", then badge has class that indicates working state', () => {
        const { container } = render(<StatusBadge status="working" />);
        const badge = container.querySelector('span');
        expect(badge?.className).toMatch(/working/i);
    });

    it('Given status="waiting_for_user", then badge has class for waiting state', () => {
        const { container } = render(<StatusBadge status="waiting_for_user" />);
        const badge = container.querySelector('span');
        expect(badge?.className).toMatch(/waiting/i);
    });

    it('Given status="active", then badge has class for active state', () => {
        const { container } = render(<StatusBadge status="active" />);
        const badge = container.querySelector('span');
        expect(badge?.className).toMatch(/active/i);
    });

    it('Given status="idle", then badge has class for idle state', () => {
        const { container } = render(<StatusBadge status="idle" />);
        const badge = container.querySelector('span');
        expect(badge?.className).toMatch(/idle/i);
    });

    it('Given status="error", then badge has class for error state', () => {
        const { container } = render(<StatusBadge status="error" />);
        const badge = container.querySelector('span');
        expect(badge?.className).toMatch(/error/i);
    });

    const statuses: AgentStatusState[] = ['working', 'waiting_for_user', 'active', 'idle', 'error'];

    it.each(statuses)('Given status="%s", badge renders with accessible aria-label', (status) => {
        render(<StatusBadge status={status} />);
        expect(screen.getByLabelText(`Status: ${status}`)).toBeInTheDocument();
    });
});
