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

import { execFile } from 'child_process';
import { CodeAgent } from './CodeAgent';
import { ClaudeCodeAgent } from './ClaudeCodeAgent';
import { CodexAgent } from './CodexAgent';
import { CortexCodeAgent } from './CortexCodeAgent';
import { GeminiAgent } from './GeminiAgent';
import { OpenCodeAgent } from './OpenCodeAgent';

/**
 * The default agent name used as fallback throughout the extension.
 * Referenced instead of hardcoding 'claude' in every file.
 */
export const DEFAULT_AGENT_NAME = 'claude';

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
    'codex': () => new CodexAgent(),
    'cortex': () => new CortexCodeAgent(),
    'gemini': () => new GeminiAgent(),
    'opencode': () => new OpenCodeAgent()
};

/**
 * Get or create an agent instance by name (singleton).
 *
 * Returns the same instance for repeated calls with the same name.
 * Returns null if the agent name is not in the factory map.
 *
 * @param agentName Agent identifier ('claude', 'codex', 'cortex', 'gemini', or 'opencode')
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
 * @returns Array of agent name strings (e.g., ['claude', 'codex', 'cortex', 'gemini', 'opencode'])
 */
export function getAvailableAgents(): string[] {
    return Object.keys(agentConstructors);
}

/**
 * Get the default agent name, validating the configured value.
 *
 * @param configuredAgent - The agent name from configuration (e.g., lanes.defaultAgent setting)
 * @returns Object with the resolved agent name and an optional warning if the configured name was invalid
 */
export function getDefaultAgent(configuredAgent: string = DEFAULT_AGENT_NAME): { agent: string; warning?: string } {
    const validAgents = getAvailableAgents();
    if (!validAgents.includes(configuredAgent)) {
        return {
            agent: DEFAULT_AGENT_NAME,
            warning: `Unknown agent '${configuredAgent}' in lanes.defaultAgent setting. Falling back to Claude.`
        };
    }
    return { agent: configuredAgent };
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
 * command is available on the system. Returns a result-type instead
 * of directly showing UI warnings.
 *
 * @param agentName Agent identifier to validate
 * @returns Object with the agent (if available) and an optional warning message
 */
export async function validateAndGetAgent(agentName: string): Promise<{ agent: CodeAgent | null; warning?: string }> {
    const agent = getAgent(agentName);
    if (!agent) {
        return { agent: null };
    }

    const available = await isCliAvailable(agent.cliCommand);
    if (!available) {
        return {
            agent: null,
            warning: `${agent.displayName} CLI ('${agent.cliCommand}') not found. ` +
                `Please install it before using ${agent.displayName} sessions.`
        };
    }

    return { agent };
}
