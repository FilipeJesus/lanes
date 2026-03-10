import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type MutableRefObject,
    type ReactNode,
} from 'react';
import { useDaemonConnection } from '../hooks/useDaemonConnection';
import type { AgentSessionStatus, SessionInfo } from '../api/types';

const POLL_INTERVAL_MS = 5_000;

type BrowserNotificationPermission = NotificationPermission | 'unsupported';

interface ProjectNotificationsContextValue {
    permission: BrowserNotificationPermission;
    requestPermission: () => Promise<BrowserNotificationPermission>;
    primeAudio: () => Promise<void>;
    syncSessionNotifications: (
        sessionName: string,
        enabled: boolean,
        status: AgentSessionStatus | null
    ) => void;
}

interface SessionStatusSnapshot {
    enabled: boolean;
    status: AgentSessionStatus | null;
}

const ProjectNotificationsContext = createContext<ProjectNotificationsContextValue>({
    permission: 'unsupported',
    requestPermission: async () => 'unsupported',
    primeAudio: async () => undefined,
    syncSessionNotifications: () => undefined,
});

function getNotificationPermission(): BrowserNotificationPermission {
    if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
        return 'unsupported';
    }
    return window.Notification.permission;
}

function shouldNotifyStatusChange(
    previousStatus: AgentSessionStatus | null,
    nextStatus: AgentSessionStatus | null
): boolean {
    if (!previousStatus || !nextStatus) {
        return false;
    }

    if (
        previousStatus.status === nextStatus.status &&
        previousStatus.timestamp === nextStatus.timestamp &&
        previousStatus.message === nextStatus.message
    ) {
        return false;
    }

    return nextStatus.status !== 'working';
}

async function playNotificationChime(audioContextRef: MutableRefObject<AudioContext | null>): Promise<void> {
    if (typeof window === 'undefined') {
        return;
    }

    const AudioContextCtor =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
        return;
    }

    let audioContext = audioContextRef.current;
    if (!audioContext) {
        audioContext = new AudioContextCtor();
        audioContextRef.current = audioContext;
    }

    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    const startAt = audioContext.currentTime + 0.02;
    const masterGain = audioContext.createGain();
    masterGain.gain.setValueAtTime(0.0001, startAt);
    masterGain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.03);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.42);
    masterGain.connect(audioContext.destination);

    const firstTone = audioContext.createOscillator();
    firstTone.type = 'sine';
    firstTone.frequency.setValueAtTime(880, startAt);
    firstTone.connect(masterGain);
    firstTone.start(startAt);
    firstTone.stop(startAt + 0.16);

    const secondTone = audioContext.createOscillator();
    secondTone.type = 'sine';
    secondTone.frequency.setValueAtTime(1174, startAt + 0.18);
    secondTone.connect(masterGain);
    secondTone.start(startAt + 0.18);
    secondTone.stop(startAt + 0.36);
}

function showBrowserNotification(
    session: SessionInfo,
    projectName: string | undefined
): void {
    if (
        typeof window === 'undefined' ||
        typeof window.Notification === 'undefined' ||
        window.Notification.permission !== 'granted'
    ) {
        return;
    }

    const stateLabel = session.status?.status.replaceAll('_', ' ') ?? 'updated';
    const bodyPrefix = projectName ? `${projectName}: ` : '';

    new window.Notification(`Lanes: ${session.name}`, {
        body: `${bodyPrefix}${stateLabel}`,
        tag: `lanes-session-${session.name}`,
    });
}

export interface ProjectNotificationsProviderProps {
    projectId?: string;
    children: ReactNode;
}

export function ProjectNotificationsProvider({
    projectId,
    children,
}: ProjectNotificationsProviderProps) {
    const { apiClient, daemonInfo } = useDaemonConnection(projectId);
    const [permission, setPermission] = useState<BrowserNotificationPermission>(() =>
        getNotificationPermission()
    );
    const snapshotsRef = useRef<Map<string, SessionStatusSnapshot>>(new Map());
    const audioContextRef = useRef<AudioContext | null>(null);

    const primeAudio = useCallback(async () => {
        if (typeof window === 'undefined') {
            return;
        }

        const AudioContextCtor =
            window.AudioContext ??
            (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) {
            return;
        }

        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContextCtor();
        }

        if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }
    }, []);

    const requestPermission = useCallback(async (): Promise<BrowserNotificationPermission> => {
        if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
            setPermission('unsupported');
            return 'unsupported';
        }

        const nextPermission = await window.Notification.requestPermission();
        setPermission(nextPermission);
        return nextPermission;
    }, []);

    const syncSessionNotifications = useCallback(
        (sessionName: string, enabled: boolean, status: AgentSessionStatus | null) => {
            const nextSnapshots = new Map(snapshotsRef.current);
            const existing = nextSnapshots.get(sessionName);
            nextSnapshots.set(sessionName, {
                enabled,
                status: status ?? existing?.status ?? null,
            });
            snapshotsRef.current = nextSnapshots;
        },
        []
    );

    useEffect(() => {
        setPermission(getNotificationPermission());
    }, [projectId]);

    useEffect(() => {
        if (!apiClient || !projectId) {
            snapshotsRef.current.clear();
            return;
        }

        let cancelled = false;
        let isPolling = false;
        let timerId: number | null = null;

        const poll = async () => {
            if (cancelled || isPolling) {
                return;
            }

            isPolling = true;

            try {
                const response = await apiClient.listSessions();
                if (cancelled) {
                    return;
                }

                const nextSnapshots = new Map<string, SessionStatusSnapshot>();

                for (const session of response.sessions) {
                    const nextSnapshot: SessionStatusSnapshot = {
                        enabled: session.notificationsEnabled === true,
                        status: session.status,
                    };
                    const previousSnapshot = snapshotsRef.current.get(session.name);

                    if (
                        previousSnapshot?.enabled &&
                        nextSnapshot.enabled &&
                        shouldNotifyStatusChange(previousSnapshot.status, nextSnapshot.status)
                    ) {
                        try {
                            await playNotificationChime(audioContextRef);
                        } catch (err) {
                            console.warn('Lanes: Failed to play notification chime:', err);
                        }
                        showBrowserNotification(session, daemonInfo?.projectName);
                    }

                    nextSnapshots.set(session.name, nextSnapshot);
                }

                snapshotsRef.current = nextSnapshots;
            } catch (err) {
                console.warn('Lanes: Failed to poll session notifications:', err);
            } finally {
                isPolling = false;
            }
        };

        void poll();
        timerId = window.setInterval(() => {
            void poll();
        }, POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            if (timerId !== null) {
                window.clearInterval(timerId);
            }
        };
    }, [apiClient, daemonInfo?.projectName, projectId]);

    return (
        <ProjectNotificationsContext.Provider
            value={{
                permission,
                requestPermission,
                primeAudio,
                syncSessionNotifications,
            }}
        >
            {children}
        </ProjectNotificationsContext.Provider>
    );
}

export function useProjectNotifications(): ProjectNotificationsContextValue {
    return useContext(ProjectNotificationsContext);
}
