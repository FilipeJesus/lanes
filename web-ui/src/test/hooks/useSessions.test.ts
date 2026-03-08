import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSessions } from '../../hooks/useSessions';
import type { DaemonApiClient } from '../../api/client';
import type { DaemonSseClient } from '../../api/sse';
import type { SessionInfo } from '../../api/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
    return {
        name: 'test-session',
        worktreePath: '/projects/my-app/.worktrees/test-session',
        branch: 'feat/test-session',
        data: { sessionId: 'test-session', agentName: 'claude' },
        status: { status: 'idle' },
        workflowStatus: { active: false },
        isPinned: false,
        ...overrides,
    };
}

function makeApiClient(sessions: SessionInfo[] = []): DaemonApiClient {
    return {
        listSessions: vi.fn().mockResolvedValue({ sessions }),
        createSession: vi.fn(),
        deleteSession: vi.fn(),
        pinSession: vi.fn(),
        unpinSession: vi.fn(),
    } as unknown as DaemonApiClient;
}

function makeSseClient(): { client: DaemonSseClient } {
    const client = {
        setCallbacks: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
    } as unknown as DaemonSseClient;

    return { client };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSessions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('initial load', () => {
        it('Given a daemon that returns sessions, when the hook mounts, then sessions array is populated', async () => {
            const sessions = [makeSession({ name: 'session-1' }), makeSession({ name: 'session-2' })];
            const apiClient = makeApiClient(sessions);

            const { result } = renderHook(() => useSessions(apiClient, null));

            await waitFor(() => {
                expect(result.current.loading).toBe(false);
            });

            expect(result.current.sessions).toHaveLength(2);
            expect(result.current.sessions[0].name).toBe('session-1');
            expect(result.current.sessions[1].name).toBe('session-2');
        });

        it('Given a daemon that returns sessions, when the hook mounts, then loading transitions from true to false', async () => {
            const sessions = [makeSession()];
            const apiClient = makeApiClient(sessions);

            const { result } = renderHook(() => useSessions(apiClient, null));

            // Wait for it to load
            await waitFor(() => {
                expect(result.current.loading).toBe(false);
            });

            expect(result.current.loading).toBe(false);
        });

        it('Given a daemon API error, when the hook mounts, then error is set and sessions is empty', async () => {
            const apiClient = {
                listSessions: vi.fn().mockRejectedValue(new Error('API Error')),
            } as unknown as DaemonApiClient;

            const { result } = renderHook(() => useSessions(apiClient, null));

            await waitFor(() => {
                expect(result.current.loading).toBe(false);
            });

            expect(result.current.error).toBeInstanceOf(Error);
            expect(result.current.error?.message).toBe('API Error');
            expect(result.current.sessions).toHaveLength(0);
        });
    });

    describe('SSE real-time updates', () => {
        it('Given a connected SSE client, when session_status_changed fires, then the matching session status is updated in state', async () => {
            const session = makeSession({ name: 'my-session', status: { status: 'idle' } });
            const apiClient = makeApiClient([session]);
            const { client: sseClient } = makeSseClient();

            const { result } = renderHook(() => useSessions(apiClient, sseClient));

            await waitFor(() => {
                expect(result.current.loading).toBe(false);
            });

            // Get the callbacks that were set on the SSE client
            const setCallbacksMock = vi.mocked(sseClient.setCallbacks);
            expect(setCallbacksMock).toHaveBeenCalled();
            const callbacks = setCallbacksMock.mock.calls[0][0];

            act(() => {
                callbacks.onSessionStatusChanged?.({
                    sessionName: 'my-session',
                    status: { status: 'working' },
                });
            });

            expect(result.current.sessions[0].status.status).toBe('working');
        });

        it('Given a connected SSE client, when session_created fires, then a new session is appended to state', async () => {
            const apiClient = makeApiClient([]);
            const { client: sseClient } = makeSseClient();

            const { result } = renderHook(() => useSessions(apiClient, sseClient));

            await waitFor(() => {
                expect(result.current.loading).toBe(false);
            });

            const setCallbacksMock = vi.mocked(sseClient.setCallbacks);
            const callbacks = setCallbacksMock.mock.calls[0][0];

            act(() => {
                callbacks.onSessionCreated?.({
                    sessionName: 'new-session',
                    worktreePath: '/projects/app/.worktrees/new-session',
                });
            });

            expect(result.current.sessions).toHaveLength(1);
            expect(result.current.sessions[0].name).toBe('new-session');
        });

        it('Given a connected SSE client, when session_deleted fires, then the matching session is removed from state', async () => {
            const session1 = makeSession({ name: 'session-1' });
            const session2 = makeSession({ name: 'session-2' });
            const apiClient = makeApiClient([session1, session2]);
            const { client: sseClient } = makeSseClient();

            const { result } = renderHook(() => useSessions(apiClient, sseClient));

            await waitFor(() => {
                expect(result.current.sessions).toHaveLength(2);
            });

            const setCallbacksMock = vi.mocked(sseClient.setCallbacks);
            const callbacks = setCallbacksMock.mock.calls[0][0];

            act(() => {
                callbacks.onSessionDeleted?.({ sessionName: 'session-1' });
            });

            expect(result.current.sessions).toHaveLength(1);
            expect(result.current.sessions[0].name).toBe('session-2');
        });
    });
});
