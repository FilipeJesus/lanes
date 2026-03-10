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
export type { DaemonRegistryEntry, RegisteredProjectEntry } from './registry';
export {
    createProjectId,
    getRegistryPath,
    getProjectsRegistryPath,
    registerDaemon,
    deregisterDaemon,
    listRegisteredDaemons,
    cleanStaleEntries,
    registerProject,
    deregisterProject,
    listRegisteredProjects,
    getRegisteredProjectById,
    getRegisteredProjectByWorkspace,
} from './registry';
export type { DaemonClientOptions, SseCallbacks, SseSubscription } from './client';
export { DaemonClient, DaemonHttpError } from './client';
