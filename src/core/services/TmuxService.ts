/**
 * TmuxService - tmux backend support for Claude sessions
 *
 * This service provides tmux session management as an alternative to VS Code integrated terminals.
 * Tmux sessions are persistent across VS Code restarts and offer advanced terminal multiplexing.
 *
 * Key features:
 * - Create detached tmux sessions with custom working directories
 * - Send commands to running sessions
 * - Manage session lifecycle (create, kill, check existence)
 * - Build shell commands for attaching to sessions
 *
 * Security: Uses execFile instead of exec to bypass shell interpretation for tmux CLI
 * invocations. Note that sendCommand() uses tmux send-keys which types into a shell,
 * so commands sent via sendCommand are still interpreted by the target shell.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Timeout for tmux commands to prevent hangs
const TMUX_EXEC_TIMEOUT_MS = 10_000;

// Cache for tmux installation check
let tmuxInstalledCache: boolean | undefined;

// Valid environment variable name pattern
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Sanitize a session name for tmux compatibility.
 * Only allows alphanumeric characters, hyphens, and underscores.
 *
 * @param name The raw session name
 * @returns Sanitized name safe for tmux sessions
 * @throws Error if name is empty or produces no valid characters
 */
export function sanitizeTmuxSessionName(name: string): string {
	if (!name) {
		throw new Error('Tmux session name cannot be empty');
	}

	// Only allow alphanumeric, hyphens, and underscores (safe for tmux and shell)
	let result = name.replace(/[^a-zA-Z0-9_-]/g, '-');

	// Replace consecutive hyphens with single hyphen
	result = result.replace(/-+/g, '-');

	// Remove leading/trailing hyphens
	result = result.replace(/^-+/, '').replace(/-+$/, '');

	if (!result) {
		throw new Error(`Cannot sanitize session name '${name}': no valid characters remain`);
	}

	return result;
}

/**
 * Check if tmux mode is enabled.
 *
 * @param terminalMode - The configured terminal mode value (e.g., 'vscode' or 'tmux')
 * @returns True if terminal mode is 'tmux', false otherwise
 */
export function isTmuxMode(terminalMode: string = 'vscode'): boolean {
	return terminalMode === 'tmux';
}

/**
 * Check if tmux is installed on the system.
 * Result is cached after the first check.
 *
 * @returns True if tmux is available, false otherwise
 */
export async function isTmuxInstalled(): Promise<boolean> {
	if (tmuxInstalledCache !== undefined) {
		return tmuxInstalledCache;
	}

	try {
		await execFileAsync('which', ['tmux'], { timeout: TMUX_EXEC_TIMEOUT_MS });
		tmuxInstalledCache = true;
		return true;
	} catch {
		tmuxInstalledCache = false;
		return false;
	}
}

/**
 * Reset the tmux installation cache.
 * Useful when the user may have installed tmux after the initial check.
 * @internal Exposed for testing and cache invalidation.
 */
export function resetTmuxInstalledCache(): void {
	tmuxInstalledCache = undefined;
}

/**
 * Check if a tmux session with the given name exists.
 *
 * @param name The session name to check
 * @returns True if the session exists, false otherwise
 */
export async function sessionExists(name: string): Promise<boolean> {
	try {
		await execFileAsync('tmux', ['has-session', '-t', name], { timeout: TMUX_EXEC_TIMEOUT_MS });
		return true;
	} catch {
		return false;
	}
}

/**
 * Create a new detached tmux session.
 * If a session with the same name already exists, it will be killed first (clean slate).
 *
 * @param name The session name
 * @param cwd The working directory for the session
 * @param env Optional environment variables to set in the session
 */
export async function createSession(
	name: string,
	cwd: string,
	env?: Record<string, string>
): Promise<void> {
	// Kill existing session if it exists (clean slate)
	if (await sessionExists(name)) {
		await killSession(name);
	}

	// Create new detached session
	await execFileAsync('tmux', ['new-session', '-d', '-s', name, '-c', cwd], { timeout: TMUX_EXEC_TIMEOUT_MS });

	// Set environment variables if provided
	if (env) {
		for (const [key, value] of Object.entries(env)) {
			if (!ENV_KEY_PATTERN.test(key)) {
				throw new Error(`Invalid environment variable name: ${key}`);
			}
			await execFileAsync('tmux', ['set-environment', '-t', name, key, value], { timeout: TMUX_EXEC_TIMEOUT_MS });
		}
	}
}

/**
 * Send a command to a tmux session.
 *
 * @param sessionName The session name
 * @param command The command to send
 */
export async function sendCommand(sessionName: string, command: string): Promise<void> {
	try {
		await execFileAsync('tmux', ['send-keys', '-t', sessionName, command, 'Enter'], { timeout: TMUX_EXEC_TIMEOUT_MS });
	} catch (err) {
		throw new Error(`Failed to send command to tmux session '${sessionName}': ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Kill a tmux session.
 * Does not throw if the session doesn't exist.
 *
 * @param name The session name to kill
 */
export async function killSession(name: string): Promise<void> {
	try {
		await execFileAsync('tmux', ['kill-session', '-t', name], { timeout: TMUX_EXEC_TIMEOUT_MS });
	} catch {
		// Ignore errors (session might not exist)
	}
}

// ---------------------------------------------------------------------------
// High-level launch helper
// ---------------------------------------------------------------------------

export interface TmuxLaunchOptions {
	/** Raw session name (will be sanitized). */
	sessionName: string;
	/** Working directory for the tmux session. */
	worktreePath: string;
	/** Shell command to run inside the tmux session (only used if session is new). */
	command: string;
	/** Environment variables to export in the tmux session. */
	env?: Record<string, string>;
}

export interface TmuxLaunchResult {
	/** Sanitized tmux session name. */
	tmuxSessionName: string;
	/** Command to attach to the tmux session. */
	attachCommand: string;
	/** True if the session already existed (reattached). */
	wasExisting: boolean;
}

/**
 * Create or reattach to a tmux session and send a command.
 *
 * If the session already exists, returns attach info without sending the command
 * (assumes the existing session is already running the agent).
 *
 * If the session does not exist, creates it, exports env vars, sends the command,
 * and returns attach info.
 */
export async function launchInTmux(options: TmuxLaunchOptions): Promise<TmuxLaunchResult> {
	const tmuxSessionName = sanitizeTmuxSessionName(options.sessionName);
	const existing = await sessionExists(tmuxSessionName);

	if (existing) {
		return {
			tmuxSessionName,
			attachCommand: `tmux attach-session -t "${tmuxSessionName}"`,
			wasExisting: true,
		};
	}

	// Create new session
	await createSession(tmuxSessionName, options.worktreePath);

	// Export env vars via send-keys (set-environment only affects new windows/panes)
	if (options.env) {
		for (const [key, value] of Object.entries(options.env)) {
			if (!ENV_KEY_PATTERN.test(key)) {
				throw new Error(`Invalid environment variable name: ${key}`);
			}
			await sendCommand(tmuxSessionName, `export ${key}='${value}'`);
		}
	}

	// Send the agent command
	await sendCommand(tmuxSessionName, options.command);

	return {
		tmuxSessionName,
		attachCommand: `tmux attach-session -t "${tmuxSessionName}"`,
		wasExisting: false,
	};
}

/**
 * List all active tmux sessions.
 * Returns an empty array if tmux is not running or no sessions exist.
 *
 * @returns Array of session names
 */
export async function listSessions(): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync(
			'tmux',
			['list-sessions', '-F', '#{session_name}'],
			{ timeout: TMUX_EXEC_TIMEOUT_MS }
		);
		return stdout
			.trim()
			.split('\n')
			.map(s => s.trim())
			.filter(s => s.length > 0);
	} catch {
		// tmux not running or no sessions exist
		return [];
	}
}
