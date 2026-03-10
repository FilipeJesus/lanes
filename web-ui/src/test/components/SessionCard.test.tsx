import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SessionCard } from '../../components/SessionCard';
import type { SessionInfo } from '../../api/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
    return {
        name: 'feat-login',
        worktreePath: '/projects/app/.worktrees/feat-login',
        branch: 'feat/login',
        data: { sessionId: 'feat-login', agentName: 'claude' },
        status: { status: 'idle' },
        workflowStatus: { active: false },
        isPinned: false,
        ...overrides,
    };
}

function renderCard(
    session: SessionInfo,
    handlers: {
        onPin?: (name: string) => void;
        onUnpin?: (name: string) => void;
        onDelete?: (name: string) => void;
        onEnableNotifications?: (name: string) => void;
        onDisableNotifications?: (name: string) => void;
    } = {}
) {
    return render(
        <MemoryRouter>
            <SessionCard
                session={session}
                projectId="project-123"
                onPin={handlers.onPin ?? vi.fn()}
                onUnpin={handlers.onUnpin ?? vi.fn()}
                onDelete={handlers.onDelete ?? vi.fn()}
                onEnableNotifications={handlers.onEnableNotifications ?? vi.fn()}
                onDisableNotifications={handlers.onDisableNotifications ?? vi.fn()}
            />
        </MemoryRouter>
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionCard', () => {
    beforeEach(() => {
        mockNavigate.mockClear();
    });

    it('The session name and branch are rendered', () => {
        renderCard(makeSession({ name: 'feat-login', branch: 'feat/login' }));
        expect(screen.getByText('feat-login')).toBeInTheDocument();
        expect(screen.getByText('feat/login')).toBeInTheDocument();
    });

    it('Given a session with isPinned=false, then a pin button is visible', () => {
        renderCard(makeSession({ isPinned: false }));
        const pinButton = screen.getByLabelText(/^pin session/i);
        expect(pinButton).toBeInTheDocument();
    });

    it('Given a session with isPinned=true, then an unpin button is visible', () => {
        renderCard(makeSession({ isPinned: true }));
        const unpinButton = screen.getByLabelText(/^unpin session/i);
        expect(unpinButton).toBeInTheDocument();
    });

    it('Given a session with notifications disabled, then an enable notifications button is visible', () => {
        renderCard(makeSession({ notificationsEnabled: false }));
        expect(screen.getByLabelText(/^enable notifications for session/i)).toBeInTheDocument();
    });

    it('When user clicks delete, then onDelete callback is fired with the session name', async () => {
        const onDelete = vi.fn();
        const user = userEvent.setup();

        renderCard(makeSession({ name: 'feat-login' }), { onDelete });

        const deleteButton = screen.getByLabelText(/delete session feat-login/i);
        await user.click(deleteButton);

        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledWith('feat-login');
    });

    it('When user clicks pin on an unpinned session, then onPin callback is fired with the session name', async () => {
        const onPin = vi.fn();
        const user = userEvent.setup();

        renderCard(makeSession({ name: 'feat-login', isPinned: false }), { onPin });

        const pinButton = screen.getByLabelText(/^pin session feat-login/i);
        await user.click(pinButton);

        expect(onPin).toHaveBeenCalledTimes(1);
        expect(onPin).toHaveBeenCalledWith('feat-login');
    });

    it('When user clicks unpin on a pinned session, then onUnpin callback is fired with the session name', async () => {
        const onUnpin = vi.fn();
        const user = userEvent.setup();

        renderCard(makeSession({ name: 'feat-login', isPinned: true }), { onUnpin });

        const unpinButton = screen.getByLabelText(/^unpin session feat-login/i);
        await user.click(unpinButton);

        expect(onUnpin).toHaveBeenCalledTimes(1);
        expect(onUnpin).toHaveBeenCalledWith('feat-login');
    });

    it('When user clicks enable notifications, then onEnableNotifications callback is fired with the session name', async () => {
        const onEnableNotifications = vi.fn();
        const user = userEvent.setup();

        renderCard(
            makeSession({ name: 'feat-login', notificationsEnabled: false }),
            { onEnableNotifications }
        );

        await user.click(screen.getByLabelText(/^enable notifications for session feat-login/i));

        expect(onEnableNotifications).toHaveBeenCalledTimes(1);
        expect(onEnableNotifications).toHaveBeenCalledWith('feat-login');
    });
});
