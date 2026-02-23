/**
 * Platform-agnostic storage provider interface.
 * Abstracts persistent state storage for the extension.
 */

export interface IStorageProvider {
    getGlobalStoragePath(): string;
    getWorkspaceState<T>(key: string, defaultValue: T): T;
    setWorkspaceState<T>(key: string, value: T): Promise<void>;
}
