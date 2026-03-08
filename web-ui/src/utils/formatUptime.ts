/**
 * Format an uptime duration (in seconds) as a human-readable string.
 *
 * Examples:
 *   45        → "45s"
 *   135       → "2m 15s"
 *   8100      → "2h 15m"
 *   277200    → "3d 5h"
 */
export function formatUptime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '0s';
    }

    if (seconds < 60) {
        return `${Math.floor(seconds)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}m ${remainingSeconds}s`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    }

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
}
