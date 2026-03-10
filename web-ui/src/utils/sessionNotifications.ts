export interface NotificationPermissionHelpers {
    permission: NotificationPermission | 'unsupported';
    requestPermission: () => Promise<NotificationPermission | 'unsupported'>;
    primeAudio: () => Promise<void>;
}

export async function prepareSessionNotifications(
    helpers: NotificationPermissionHelpers
): Promise<void> {
    if (helpers.permission === 'default') {
        await helpers.requestPermission();
    }

    try {
        await helpers.primeAudio();
    } catch {
        // Keep the session preference enabled even if audio priming is blocked.
    }
}
