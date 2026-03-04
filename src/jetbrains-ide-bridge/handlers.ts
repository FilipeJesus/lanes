/**
 * Method Handlers - Maps JSON-RPC methods to SessionHandlerService calls
 *
 * This module is now a thin adapter:
 * 1. It builds a IHandlerContext from the bridge's global state.
 * 2. It creates (or reuses) a SessionHandlerService instance.
 * 3. Each handler delegates directly to the corresponding service method.
 *
 * All business logic lives in SessionHandlerService; this file only owns
 * the transport-level wiring (method dispatch table, global state, lifecycle).
 *
 * Organizes handlers by domain:
 * - Session handlers (session.*)
 * - Git handlers (git.*)
 * - Workflow handlers (workflow.*)
 * - Agent handlers (agent.*)
 * - Config handlers (config.*)
 * - Terminal handlers (terminal.*)
 * - File watcher handlers (fileWatcher.*)
 */

import { ConfigStore } from './config';
import { NotificationEmitter } from './notifications';
import { FileWatchManager } from './fileWatcher';
import { IHandlerContext } from '../core/interfaces/IHandlerContext';
import { SessionHandlerService } from '../core/services/SessionHandlerService';

// Re-export JsonRpcHandlerError so that server.ts can import it from here
// without changing the existing import path.
export { JsonRpcHandlerError } from '../core/services/SessionHandlerService';

// =============================================================================
// Global handler context (set via initializeHandlers)
// =============================================================================

let workspaceRoot: string;
let configStore: ConfigStore;
let notificationEmitter: NotificationEmitter;
let fileWatchManager: FileWatchManager;
let handlerService: SessionHandlerService;

/**
 * Initialize handlers with context.
 * Must be called during server initialization.
 */
export function initializeHandlers(
    workspace: string,
    config: ConfigStore,
    notifications: NotificationEmitter
): void {
    workspaceRoot = workspace;
    configStore = config;
    notificationEmitter = notifications;
    fileWatchManager = new FileWatchManager(notifications);

    const context: IHandlerContext = {
        workspaceRoot,
        config: configStore,
        notificationEmitter,
        fileWatchManager,
    };
    handlerService = new SessionHandlerService(context);
}

/**
 * Clean up resources managed by handlers.
 * Should be called during server shutdown.
 */
export function disposeHandlers(): void {
    if (fileWatchManager) {
        fileWatchManager.dispose();
    }
}

// =============================================================================
// Method dispatch table
// =============================================================================

const methodHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
    'session.list':          (p) => handlerService.handleSessionList(p),
    'session.create':        (p) => handlerService.handleSessionCreate(p),
    'session.delete':        (p) => handlerService.handleSessionDelete(p),
    'session.clear':         (p) => handlerService.handleSessionClear(p),
    'session.getStatus':     (p) => handlerService.handleSessionGetStatus(p),
    'session.open':          (p) => handlerService.handleSessionOpen(p),
    'session.pin':           (p) => handlerService.handleSessionPin(p),
    'session.unpin':         (p) => handlerService.handleSessionUnpin(p),
    'git.listBranches':      (p) => handlerService.handleGitListBranches(p),
    'git.getDiff':           (p) => handlerService.handleGitGetDiff(p),
    'git.getDiffFiles':      (p) => handlerService.handleGitGetDiffFiles(p),
    'git.getWorktreeInfo':   (p) => handlerService.handleGitGetWorktreeInfo(p),
    'git.repairWorktrees':   (p) => handlerService.handleGitRepairWorktrees(p),
    'workflow.list':         (p) => handlerService.handleWorkflowList(p),
    'workflow.validate':     (p) => handlerService.handleWorkflowValidate(p),
    'workflow.create':       (p) => handlerService.handleWorkflowCreate(p),
    'workflow.getState':     (p) => handlerService.handleWorkflowGetState(p),
    'agent.list':            (p) => handlerService.handleAgentList(p),
    'agent.getConfig':       (p) => handlerService.handleAgentGetConfig(p),
    'config.get':            (p) => handlerService.handleConfigGet(p),
    'config.set':            (p) => handlerService.handleConfigSet(p),
    'config.getAll':         (p) => handlerService.handleConfigGetAll(p),
    'terminal.create':       (p) => handlerService.handleTerminalCreate(p),
    'terminal.send':         (p) => handlerService.handleTerminalSend(p),
    'terminal.list':         (p) => handlerService.handleTerminalList(p),
    'fileWatcher.watch':     (p) => handlerService.handleFileWatcherWatch(p),
    'fileWatcher.unwatch':   (p) => handlerService.handleFileWatcherUnwatch(p),
};

/**
 * Main request dispatcher.
 * Routes method names to handler functions.
 */
export async function handleRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const handler = methodHandlers[method];
    if (!handler) {
        throw new Error(`Method not found: ${method}`);
    }
    return handler(params);
}

