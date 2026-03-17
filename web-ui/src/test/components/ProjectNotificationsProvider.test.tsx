import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
    ProjectNotificationsProvider,
    useProjectNotifications,
} from '../../components/ProjectNotificationsProvider';
import { useDaemonConnection } from '../../hooks/useDaemonConnection';
import type { DaemonApiClient } from '../../api/client';
import type { DaemonConnection } from '../../hooks/useDaemonConnection';
import type { SessionInfo } from '../../api/types';

vi.mock('../../hooks/useDaemonConnection', () => ({
    useDaemonConnection: vi.fn(),
}));

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
    return {
        name: 'session-1',
        worktreePath: '/projects/app/.worktrees/session-1',
        branch: 'feat/session-1',
        data: { sessionId: 'session-1', agentName: 'claude' },
        status: { status: 'idle' },
        workflowStatus: { active: false },
        isPinned: false,
        notificationsEnabled: true,
        ...overrides,
    };
}

function makeConnection(listSessions: ReturnType<typeof vi.fn>): DaemonConnection {
    return {
        apiClient: { listSessions } as unknown as DaemonApiClient,
        sseClient: null,
        daemonInfo: {
            projectId: 'project-1',
            projectName: 'demo-app',
            workspaceRoot: '/projects/app',
            registeredAt: new Date().toISOString(),
            status: 'running',
            daemon: {
                projectId: 'project-1',
                workspaceRoot: '/projects/app',
                projectName: 'demo-app',
                port: 3847,
                pid: 123,
                token: 'secret',
                startedAt: new Date().toISOString(),
            },
        },
        loading: false,
        error: null,
        projectState: 'connected',
        refresh: vi.fn(),
    };
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function NotificationsConsumer() {
    const { permission, requestPermission, syncSessionNotifications } = useProjectNotifications();

    return (
        <div>
            <span>{permission}</span>
            <button type="button" onClick={() => void requestPermission()}>
                Request permission
            </button>
            <button
                type="button"
                onClick={() =>
                    syncSessionNotifications('session-1', true, { status: 'idle' })
                }
            >
                Sync session
            </button>
        </div>
    );
}

describe('ProjectNotificationsProvider', () => {
    const notifySpy = vi.fn();
    const requestPermissionSpy = vi.fn<() => Promise<NotificationPermission>>();
    const audioContextResumeSpy = vi.fn<() => Promise<void>>();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        class MockNotification {
            static permission: NotificationPermission = 'granted';
            static requestPermission = requestPermissionSpy;

            constructor(title: string, options?: NotificationOptions) {
                notifySpy(title, options);
            }
        }

        class MockAudioContext {
            public state: AudioContextState = 'running';
            public currentTime = 0;

            resume = audioContextResumeSpy;

            createGain() {
                return {
                    gain: {
                        setValueAtTime: vi.fn(),
                        exponentialRampToValueAtTime: vi.fn(),
                    },
                    connect: vi.fn(),
                };
            }

            createOscillator() {
                return {
                    type: 'sine',
                    frequency: {
                        setValueAtTime: vi.fn(),
                    },
                    connect: vi.fn(),
                    start: vi.fn(),
                    stop: vi.fn(),
                };
            }
        }

        requestPermissionSpy.mockResolvedValue('granted');
        audioContextResumeSpy.mockResolvedValue(undefined);

        vi.stubGlobal('Notification', MockNotification);
        vi.stubGlobal('AudioContext', MockAudioContext);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('polls every 5 seconds and notifies on later enabled-session status changes', async () => {
        const listSessions = vi
            .fn()
            .mockResolvedValueOnce({
                sessions: [makeSession({ status: { status: 'idle' }, notificationsEnabled: true })],
            })
            .mockResolvedValueOnce({
                sessions: [
                    makeSession({
                        status: { status: 'waiting_for_user', message: 'Need review' },
                        notificationsEnabled: true,
                    }),
                ],
            });

        vi.mocked(useDaemonConnection).mockReturnValue(makeConnection(listSessions));

        render(
            <ProjectNotificationsProvider projectId="project-1">
                <div>child</div>
            </ProjectNotificationsProvider>
        );

        await act(async () => {
            await flushMicrotasks();
        });
        expect(listSessions).toHaveBeenCalledTimes(1);
        expect(notifySpy).not.toHaveBeenCalled();

        await act(async () => {
            vi.advanceTimersByTime(5_000);
            await flushMicrotasks();
        });

        expect(listSessions).toHaveBeenCalledTimes(2);
        expect(notifySpy).toHaveBeenCalledTimes(1);
        expect(notifySpy).toHaveBeenCalledWith('Lanes: session-1', {
            body: 'demo-app: waiting for user',
            tag: 'lanes-session-session-1',
        });
        expect(audioContextResumeSpy).not.toHaveBeenCalled();
    });

    it('does not notify for working transitions even when notifications are enabled', async () => {
        const listSessions = vi
            .fn()
            .mockResolvedValueOnce({
                sessions: [makeSession({ status: { status: 'idle' }, notificationsEnabled: true })],
            })
            .mockResolvedValueOnce({
                sessions: [makeSession({ status: { status: 'working' }, notificationsEnabled: true })],
            });

        vi.mocked(useDaemonConnection).mockReturnValue(makeConnection(listSessions));

        render(
            <ProjectNotificationsProvider projectId="project-1">
                <div>child</div>
            </ProjectNotificationsProvider>
        );

        await act(async () => {
            await flushMicrotasks();
        });
        expect(listSessions).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(5_000);
            await flushMicrotasks();
        });

        expect(listSessions).toHaveBeenCalledTimes(2);
        expect(notifySpy).not.toHaveBeenCalled();
    });

    it('still shows a browser notification when chime playback fails', async () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const listSessions = vi
            .fn()
            .mockResolvedValueOnce({
                sessions: [makeSession({ status: { status: 'idle' }, notificationsEnabled: true })],
            })
            .mockResolvedValueOnce({
                sessions: [makeSession({ status: { status: 'error' }, notificationsEnabled: true })],
            });

        class FailingAudioContext {
            public state: AudioContextState = 'suspended';
            public currentTime = 0;

            resume = vi.fn().mockRejectedValue(new Error('autoplay blocked'));

            createGain() {
                return {
                    gain: {
                        setValueAtTime: vi.fn(),
                        exponentialRampToValueAtTime: vi.fn(),
                    },
                    connect: vi.fn(),
                };
            }

            createOscillator() {
                return {
                    type: 'sine',
                    frequency: {
                        setValueAtTime: vi.fn(),
                    },
                    connect: vi.fn(),
                    start: vi.fn(),
                    stop: vi.fn(),
                };
            }
        }

        vi.stubGlobal('AudioContext', FailingAudioContext);
        vi.mocked(useDaemonConnection).mockReturnValue(makeConnection(listSessions));

        render(
            <ProjectNotificationsProvider projectId="project-1">
                <div>child</div>
            </ProjectNotificationsProvider>
        );

        await act(async () => {
            await flushMicrotasks();
        });

        await act(async () => {
            vi.advanceTimersByTime(5_000);
            await flushMicrotasks();
        });

        expect(notifySpy).toHaveBeenCalledTimes(1);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            'Lanes: Failed to play notification chime:',
            expect.any(Error)
        );
        consoleWarnSpy.mockRestore();
    });

    it('exposes browser notification permission helpers through context', async () => {
        class MockNotification {
            static permission: NotificationPermission = 'default';
            static requestPermission = requestPermissionSpy;

            constructor(_title: string, _options?: NotificationOptions) {}
        }

        vi.stubGlobal('Notification', MockNotification);
        vi.mocked(useDaemonConnection).mockReturnValue(makeConnection(vi.fn().mockResolvedValue({ sessions: [] })));

        render(
            <ProjectNotificationsProvider projectId="project-1">
                <NotificationsConsumer />
            </ProjectNotificationsProvider>
        );

        expect(screen.getByText('default')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /request permission/i }));
        await act(async () => {
            await flushMicrotasks();
        });
        expect(requestPermissionSpy).toHaveBeenCalledTimes(1);
    });

    it('applies a synced enablement immediately before the next poll', async () => {
        const listSessions = vi
            .fn()
            .mockResolvedValueOnce({
                sessions: [makeSession({ status: { status: 'idle' }, notificationsEnabled: false })],
            })
            .mockResolvedValueOnce({
                sessions: [
                    makeSession({
                        status: { status: 'waiting_for_user', message: 'Done' },
                        notificationsEnabled: true,
                    }),
                ],
            });

        vi.mocked(useDaemonConnection).mockReturnValue(makeConnection(listSessions));

        render(
            <ProjectNotificationsProvider projectId="project-1">
                <NotificationsConsumer />
            </ProjectNotificationsProvider>
        );

        await act(async () => {
            await flushMicrotasks();
        });
        expect(notifySpy).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /sync session/i }));

        await act(async () => {
            vi.advanceTimersByTime(5_000);
            await flushMicrotasks();
        });

        expect(notifySpy).toHaveBeenCalledTimes(1);
        expect(notifySpy).toHaveBeenCalledWith('Lanes: session-1', {
            body: 'demo-app: waiting for user',
            tag: 'lanes-session-session-1',
        });
    });
});
