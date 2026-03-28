/**
 * IHandlerContext - Protocol-agnostic handler context interfaces.
 *
 * These interfaces capture exactly what the session handler layer needs
 * from the host environment (daemon, tests, future transports, etc.) without
 * importing any platform-specific code.
 *
 * Implementations:
 *   - Daemon: config store, notification emitter, file watch manager
 *   - Tests/future transports: any classes that satisfy these interfaces
 */

import type { SettingsScope, SettingsView } from '../services/UnifiedSettingsService';

/**
 * A simple synchronous/async key-value configuration store.
 * Small adapter-friendly surface used by SessionHandlerService.
 */
export interface ISimpleConfigStore {
    /** Get a configuration value by key. Returns undefined if not set. */
    get(key: string, scope?: SettingsView): unknown;
    /** Persist a configuration value. */
    set(key: string, value: unknown, scope?: SettingsScope): Promise<void>;
    /** Get all configuration values, optionally filtered by key prefix. */
    getAll(prefix?: string, scope?: SettingsView): Record<string, unknown>;
}

/**
 * Emits events to the connected client (e.g., via JSON-RPC notifications).
 */
export interface INotificationEmitter {
    /** Notify the client that a session's status has changed. */
    sessionStatusChanged(
        sessionName: string,
        status: { status: string; timestamp?: string; message?: string }
    ): void;
    /** Notify the client that a watched file has changed. */
    fileChanged(filePath: string, eventType: 'created' | 'changed' | 'deleted'): void;
    /** Notify the client that a new session was created. */
    sessionCreated(sessionName: string, worktreePath: string): void;
    /** Notify the client that a session was deleted. */
    sessionDeleted(sessionName: string): void;
}

/**
 * Manages file system watches on behalf of the client.
 */
export interface IFileWatchManager {
    /**
     * Start watching a directory for files matching a glob pattern.
     * Returns a watch ID that can be passed to unwatch().
     */
    watch(basePath: string, pattern: string): string;
    /**
     * Stop a file watch.
     * Returns true if the watch existed and was removed, false otherwise.
     */
    unwatch(watchId: string): Promise<boolean>;
    /** Stop all active watches and free resources. */
    dispose(): void;
}

/**
 * The full context object passed to SessionHandlerService.
 * Combines the workspace root with the four collaborator interfaces.
 */
export interface IHandlerContext {
    /** Absolute path to the repository workspace root. */
    workspaceRoot: string;
    /** Access to persisted configuration values. */
    config: ISimpleConfigStore;
    /** Emitter for push notifications to the client. */
    notificationEmitter: INotificationEmitter;
    /** Manager for active file system watches. */
    fileWatchManager: IFileWatchManager;
}
