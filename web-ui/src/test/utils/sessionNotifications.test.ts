import { describe, expect, it, vi } from 'vitest';
import { prepareSessionNotifications } from '../../utils/sessionNotifications';

describe('prepareSessionNotifications', () => {
    it('does not throw when browser notifications are unsupported', async () => {
        await expect(
            prepareSessionNotifications({
                permission: 'unsupported',
                requestPermission: vi.fn(),
                primeAudio: vi.fn().mockResolvedValue(undefined),
            })
        ).resolves.toBeUndefined();
    });

    it('does not throw when browser notification permission is denied', async () => {
        await expect(
            prepareSessionNotifications({
                permission: 'denied',
                requestPermission: vi.fn(),
                primeAudio: vi.fn().mockResolvedValue(undefined),
            })
        ).resolves.toBeUndefined();
    });

    it('requests permission when the browser permission is default', async () => {
        const requestPermission = vi.fn().mockResolvedValue('granted');

        await prepareSessionNotifications({
            permission: 'default',
            requestPermission,
            primeAudio: vi.fn().mockResolvedValue(undefined),
        });

        expect(requestPermission).toHaveBeenCalledTimes(1);
    });
});
