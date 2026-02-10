/**
 * Agent Factory - Creates and manages CodeAgent instances
 *
 * Provides a simple factory with a hardcoded map of agent constructors
 * and singleton caching. Adding a new agent requires one line in the
 * agentConstructors map.
 *
 * The factory also handles:
 * - Reading the lanes.defaultAgent VS Code setting
 * - Validating CLI availability using `command -v` (POSIX builtin)
 * - Singleton lifecycle (one instance per agent type)
 */

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { CodeAgent } from './CodeAgent';
import { ClaudeCodeAgent } from './ClaudeCodeAgent';
import { CodexAgent } from './CodexAgent';

/**
 * Singleton instance cache - one CodeAgent instance per agent type.
 * Ensures the same object reference is returned for repeated calls.
 */
const instances = new Map<string, CodeAgent>();

/**
 * Hardcoded factory map of agent name to constructor function.
 * Adding a new agent = one line here + the agent class.
 */
const agentConstructors: Record<string, () => CodeAgent> = {
    'claude': () => new ClaudeCodeAgent(),
    'codex': () => new CodexAgent()
};

/**
 * Get or create an agent instance by name (singleton).
 *
 * Returns the same instance for repeated calls with the same name.
 * Returns null if the agent name is not in the factory map.
 *
 * @param agentName Agent identifier ('claude' or 'codex')
 * @returns CodeAgent instance, or null if agent name is not recognized
 */
export function getAgent(agentName: string): CodeAgent | null {
    // Check singleton cache first
    if (instances.has(agentName)) {
        return instances.get(agentName)!;
    }

    // Look up constructor in factory map
    const constructor = agentConstructors[agentName];
    if (!constructor) {
        return null;
    }

    // Create instance, cache it, return it
    const instance = constructor();
    instances.set(agentName, instance);
    return instance;
}

/**
 * Get list of all available agent names.
 *
 * @returns Array of agent name strings (e.g., ['claude', 'codex'])
 */
export function getAvailableAgents(): string[] {
    return Object.keys(agentConstructors);
}

/**
 * Get the default agent name from VS Code settings.
 *
 * Reads the `lanes.defaultAgent` setting and validates it against
 * available agents. Shows a warning and falls back to 'claude' if
 * the configured value is not recognized.
 *
 * @returns Valid agent name string
 */
export function getDefaultAgent(): string {
    const config = vscode.workspace.getConfiguration('lanes');
    const agent = config.get<string>('defaultAgent', 'claude');

    // Validate against known agents
    const validAgents = getAvailableAgents();
    if (!validAgents.includes(agent)) {
        vscode.window.showWarningMessage(
            `Unknown agent '${agent}' in lanes.defaultAgent setting. Falling back to Claude.`
        );
        return 'claude';
    }

    return agent;
}

/**
 * Check if a CLI command is available on the system.
 *
 * Uses `command -v` (POSIX builtin) instead of `which` for
 * reliable cross-platform behavior.
 *
 * @param cliCommand The CLI command to check (e.g., 'codex', 'claude')
 * @returns true if the command is available, false otherwise
 */
export async function isCliAvailable(cliCommand: string): Promise<boolean> {
    return new Promise((resolve) => {
        execFile('command', ['-v', cliCommand], { shell: true, timeout: 5000 }, (error) => {
            resolve(!error);
        });
    });
}

/**
 * Validate CLI availability and return the agent instance.
 *
 * Creates the agent via getAgent(), then checks if the agent's CLI
 * command is available on the system. If the CLI is not found, shows
 * a warning message and returns null.
 *
 * @param agentName Agent identifier to validate
 * @returns CodeAgent instance if CLI is available, null otherwise
 */
export async function validateAndGetAgent(agentName: string): Promise<CodeAgent | null> {
    const agent = getAgent(agentName);
    if (!agent) {
        return null;
    }

    const available = await isCliAvailable(agent.cliCommand);
    if (!available) {
        vscode.window.showWarningMessage(
            `${agent.displayName} CLI ('${agent.cliCommand}') not found. ` +
            `Please install it before using ${agent.displayName} sessions.`
        );
        return null;
    }

    return agent;
}
