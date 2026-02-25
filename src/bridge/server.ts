/**
 * Node.js Bridge Server for IntelliJ Plugin
 *
 * This server sits between the IntelliJ plugin (Kotlin) and the Lanes core services.
 * It communicates over stdio using JSON-RPC 2.0 protocol (newline-delimited JSON).
 *
 * Protocol:
 * - Request: {"jsonrpc":"2.0","id":1,"method":"session.list","params":{...}}
 * - Response: {"jsonrpc":"2.0","id":1,"result":{...}}
 * - Error: {"jsonrpc":"2.0","id":1,"error":{"code":1003,"message":"..."}}
 * - Notification: {"jsonrpc":"2.0","method":"notification.sessionStatusChanged","params":{...}}
 *
 * Usage:
 *   node server.js --workspace-root /path/to/workspace
 */

import * as readline from 'readline';
import { initializeGitPath } from '../core/gitService';
import { initializeGlobalStorageContext, setConfigCallbacks } from '../core/session/SessionDataService';
import { getAgent } from '../core/codeAgents';
import { isTmuxInstalled } from '../core/services/TmuxService';
import { handleRequest, initializeHandlers, disposeHandlers } from './handlers';
import { NotificationEmitter } from './notifications';
import { ConfigStore } from './config';
import { GitError } from '../core/errors';
import { ValidationError } from '../core/errors';

// Error codes matching BridgeProtocol.kt
export const ErrorCodes = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    GIT_ERROR: 1001,
    VALIDATION_ERROR: 1002,
    SESSION_NOT_FOUND: 1003,
    WORKFLOW_ERROR: 1004,
    AGENT_NOT_AVAILABLE: 1005,
};

// JSON-RPC types
interface JsonRpcRequest {
    jsonrpc: string;
    id: number;
    method: string;
    params?: Record<string, unknown>;
}

interface JsonRpcResponse {
    jsonrpc: string;
    id: number;
    result?: unknown;
    error?: JsonRpcError;
}

interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}

// Global state
let workspaceRoot: string | undefined;
let configStore: ConfigStore | undefined;
let notificationEmitter: NotificationEmitter | undefined;
let initialized = false;

/**
 * Parse CLI arguments
 */
function parseArgs(): { workspaceRoot?: string } {
    const args = process.argv.slice(2);
    const result: { workspaceRoot?: string } = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--workspace-root' && i + 1 < args.length) {
            result.workspaceRoot = args[i + 1];
            i++;
        }
    }

    return result;
}

/**
 * Log to stderr (stdout is reserved for protocol messages)
 */
function log(message: string, ...args: unknown[]): void {
    process.stderr.write(`[Bridge] ${message}${args.length > 0 ? ' ' + args.join(' ') : ''}\n`);
}

/**
 * Send a JSON-RPC response to stdout
 */
function sendResponse(response: JsonRpcResponse): void {
    process.stdout.write(JSON.stringify(response) + '\n');
}

/**
 * Send a JSON-RPC error response
 */
function sendError(id: number | null, code: number, message: string, data?: unknown): void {
    sendResponse({
        jsonrpc: '2.0',
        id: id ?? 0,
        error: { code, message, data }
    });
}

/**
 * Handle initialize request
 */
async function handleInitialize(id: number, params: Record<string, unknown>): Promise<void> {
    if (initialized) {
        sendError(id, ErrorCodes.INVALID_REQUEST, 'Server already initialized');
        return;
    }

    try {
        // Validate params
        const clientVersion = params.clientVersion as string;
        const workspaceRootParam = params.workspaceRoot as string;

        if (!clientVersion || !workspaceRootParam) {
            sendError(id, ErrorCodes.INVALID_PARAMS, 'Missing clientVersion or workspaceRoot');
            return;
        }

        // Set workspace root
        workspaceRoot = workspaceRootParam;
        log(`Initializing with workspace root: ${workspaceRoot}`);

        // Initialize git path (use 'git' from PATH)
        initializeGitPath('git');

        // Initialize config store
        configStore = new ConfigStore(workspaceRoot);
        await configStore.initialize();

        // Initialize notification emitter
        notificationEmitter = new NotificationEmitter();

        // Set up config callbacks for SessionDataService
        setConfigCallbacks({
            getUseGlobalStorage: () => configStore!.get('lanes.useGlobalStorage') as boolean ?? true,
            getWorktreesFolder: () => configStore!.get('lanes.worktreesFolder') as string ?? '.worktrees',
            getPromptsFolder: () => configStore!.get('lanes.promptsFolder') as string ?? '',
        });

        // Initialize SessionDataService context
        // For IntelliJ, we'll use local storage (no global storage path)
        const defaultAgent = configStore.get('lanes.defaultAgent') as string ?? 'claude';
        const codeAgent = getAgent(defaultAgent);
        if (!codeAgent) {
            log(`Warning: Could not initialize code agent '${defaultAgent}', using 'claude' as fallback`);
        }
        initializeGlobalStorageContext(
            workspaceRoot, // Use workspace root for storage
            workspaceRoot,
            codeAgent ?? getAgent('claude')!
        );

        // Initialize handlers with context
        initializeHandlers(workspaceRoot, configStore, notificationEmitter);

        // Check tmux availability
        const supportsTmux = await isTmuxInstalled();

        // Get supported agents
        const supportedAgents = ['claude', 'codex', 'cortex', 'gemini', 'opencode'];

        initialized = true;

        // Send initialize result
        sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
                serverVersion: '0.1.0',
                protocolVersion: '0.1.0',
                capabilities: {
                    supportsWorkflows: true,
                    supportsTmux,
                    supportedAgents
                }
            }
        });

        log('Initialization complete');
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Initialization failed: ${message}`);
        sendError(id, ErrorCodes.INTERNAL_ERROR, `Initialization failed: ${message}`);
    }
}

/**
 * Handle shutdown request
 */
function handleShutdown(id: number): void {
    log('Shutdown requested');
    disposeHandlers();
    sendResponse({
        jsonrpc: '2.0',
        id,
        result: { success: true }
    });
    process.exit(0);
}

/**
 * Process a JSON-RPC request
 */
async function processRequest(request: JsonRpcRequest): Promise<void> {
    const { id, method, params } = request;

    try {
        // Handle lifecycle methods
        if (method === 'initialize') {
            await handleInitialize(id, params ?? {});
            return;
        }

        if (method === 'shutdown') {
            handleShutdown(id);
            return;
        }

        // Check if initialized
        if (!initialized) {
            sendError(id, ErrorCodes.INVALID_REQUEST, 'Server not initialized. Call initialize first.');
            return;
        }

        // Delegate to method handlers
        const result = await handleRequest(method, params ?? {});
        sendResponse({
            jsonrpc: '2.0',
            id,
            result
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Map error types to error codes using typed errors
        let code = ErrorCodes.INTERNAL_ERROR;
        if (err instanceof GitError) {
            code = ErrorCodes.GIT_ERROR;
        } else if (err instanceof ValidationError) {
            code = ErrorCodes.VALIDATION_ERROR;
        } else if (message.includes('not found') || message.includes('does not exist')) {
            code = ErrorCodes.SESSION_NOT_FOUND;
        } else if (message.includes('workflow')) {
            code = ErrorCodes.WORKFLOW_ERROR;
        } else if (message.includes('agent') || message.includes('CLI')) {
            code = ErrorCodes.AGENT_NOT_AVAILABLE;
        }

        log(`Error handling ${method}: ${message}`);
        sendError(id, code, message);
    }
}

/**
 * Main server loop
 */
async function main(): Promise<void> {
    // Parse CLI arguments
    const args = parseArgs();
    if (!args.workspaceRoot) {
        process.stderr.write('Error: --workspace-root argument is required\n');
        process.stderr.write('Usage: node server.js --workspace-root /path/to/workspace\n');
        process.exit(1);
    }

    log('Bridge server starting...');
    log(`Workspace root: ${args.workspaceRoot}`);

    // Set up readline for line-based protocol
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    // Process each line as a JSON-RPC request
    rl.on('line', async (line: string) => {
        if (!line.trim()) {
            return; // Skip empty lines
        }

        try {
            const request = JSON.parse(line) as JsonRpcRequest;

            // Validate JSON-RPC structure
            if (request.jsonrpc !== '2.0' || typeof request.method !== 'string' || typeof request.id !== 'number') {
                sendError(null, ErrorCodes.INVALID_REQUEST, 'Invalid JSON-RPC request structure');
                return;
            }

            await processRequest(request);
        } catch (err) {
            if (err instanceof SyntaxError) {
                sendError(null, ErrorCodes.PARSE_ERROR, 'Failed to parse JSON');
            } else {
                const message = err instanceof Error ? err.message : String(err);
                log(`Unexpected error: ${message}`);
                sendError(null, ErrorCodes.INTERNAL_ERROR, `Unexpected error: ${message}`);
            }
        }
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
        log('Received SIGTERM, shutting down...');
        disposeHandlers();
        process.exit(0);
    });

    process.on('SIGINT', () => {
        log('Received SIGINT, shutting down...');
        disposeHandlers();
        process.exit(0);
    });

    log('Bridge server ready');
}

// Start the server
main().catch((err) => {
    process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
