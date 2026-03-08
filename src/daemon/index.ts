/**
 * Daemon module - barrel exports
 *
 * Re-exports all public symbols from the daemon infrastructure modules.
 */

export { DaemonConfigStore } from './config';
export {
    generateToken,
    writeTokenFile,
    readTokenFile,
    removeTokenFile,
    validateAuthHeader,
} from './auth';
export type { StartDaemonOptions } from './lifecycle';
export {
    startDaemon,
    stopDaemon,
    isDaemonRunning,
    getDaemonPort,
    getDaemonPid,
} from './lifecycle';
export { DaemonNotificationEmitter } from './notifications';
export type { FileWatchOptions } from './fileWatcher';
export { DaemonFileWatchManager } from './fileWatcher';
export { createRouter } from './router';
export type { DaemonRegistryEntry } from './registry';
export {
    getRegistryPath,
    registerDaemon,
    deregisterDaemon,
    listRegisteredDaemons,
    cleanStaleEntries,
} from './registry';
