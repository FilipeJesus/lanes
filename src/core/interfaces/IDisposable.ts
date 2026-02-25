/**
 * Platform-agnostic disposable interface.
 * Mirrors the VS Code Disposable pattern for cleanup.
 */
export interface IDisposable {
    dispose(): void;
}
