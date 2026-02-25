/**
 * SettingsFormatService - Format-agnostic settings read/write
 *
 * Provides an abstraction for reading and writing settings files in different
 * formats (JSON, TOML). The format is determined by the CodeAgent instance,
 * allowing each agent to use its native configuration format.
 *
 * - Claude uses JSON (claude-settings.json)
 * - Codex uses TOML (config.toml)
 * - Gemini uses JSON (settings.json)
 *
 * TOML support is lazily imported to avoid loading the @iarna/toml library
 * when only JSON (Claude) sessions are in use.
 */

import * as fsPromises from 'fs/promises';
import type { CodeAgent } from '../codeAgents';

/**
 * Interface for reading and writing settings in a specific format.
 */
export interface SettingsFormat {
    /** File extension including the dot (e.g., '.json', '.toml') */
    readonly extension: string;

    /**
     * Read and parse a settings file.
     * @param filePath Absolute path to the settings file
     * @returns Parsed settings object
     * @throws Error if the file cannot be read or parsed
     */
    read(filePath: string): Promise<Record<string, unknown>>;

    /**
     * Write settings to a file.
     * @param filePath Absolute path to the settings file
     * @param data Settings object to serialize and write
     * @throws Error if the file cannot be written
     */
    write(filePath: string, data: Record<string, unknown>): Promise<void>;
}

/**
 * JSON settings format implementation.
 *
 * Used by Claude Code for claude-settings.json files.
 * Uses 2-space indentation for human readability.
 */
export class JsonSettingsFormat implements SettingsFormat {
    readonly extension = '.json';

    async read(filePath: string): Promise<Record<string, unknown>> {
        const content = await fsPromises.readFile(filePath, 'utf-8');
        return JSON.parse(content) as Record<string, unknown>;
    }

    async write(filePath: string, data: Record<string, unknown>): Promise<void> {
        await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
}

/**
 * JSONC (JSON with Comments) settings format implementation.
 *
 * Used by OpenCode for opencode.jsonc files.
 * Strips single-line (//) and multi-line comments before parsing.
 * Writes standard JSON (valid JSONC since JSON is a subset).
 */
export class JsoncSettingsFormat implements SettingsFormat {
    readonly extension = '.jsonc';

    /**
     * Strip JSONC comments from content.
     * Handles // line comments and multi-line comments outside of strings.
     */
    private stripComments(content: string): string {
        let result = '';
        let i = 0;
        let inString = false;
        let stringChar = '';

        while (i < content.length) {
            // Handle string contents (don't strip inside strings)
            if (inString) {
                if (content[i] === '\\') {
                    result += content[i] + (content[i + 1] || '');
                    i += 2;
                    continue;
                }
                if (content[i] === stringChar) {
                    inString = false;
                }
                result += content[i];
                i++;
                continue;
            }

            // Check for string start
            if (content[i] === '"' || content[i] === "'") {
                inString = true;
                stringChar = content[i];
                result += content[i];
                i++;
                continue;
            }

            // Check for // line comment
            if (content[i] === '/' && content[i + 1] === '/') {
                // Skip until end of line, preserve the newline
                while (i < content.length && content[i] !== '\n') {
                    i++;
                }
                if (i < content.length && content[i] === '\n') {
                    result += '\n';
                    i++;
                }
                continue;
            }

            // Check for /* block comment */
            if (content[i] === '/' && content[i + 1] === '*') {
                i += 2;
                while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) {
                    i++;
                }
                if (i < content.length) {
                    i += 2; // Skip */
                }
                continue;
            }

            result += content[i];
            i++;
        }

        return result;
    }

    async read(filePath: string): Promise<Record<string, unknown>> {
        const content = await fsPromises.readFile(filePath, 'utf-8');
        const stripped = this.stripComments(content);
        return JSON.parse(stripped) as Record<string, unknown>;
    }

    async write(filePath: string, data: Record<string, unknown>): Promise<void> {
        await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
}

/**
 * TOML settings format implementation.
 *
 * Used by Codex CLI for config.toml files.
 * Lazily imports @iarna/toml to avoid loading the library when only
 * JSON sessions are in use (most common case with Claude).
 */
export class TomlSettingsFormat implements SettingsFormat {
    readonly extension = '.toml';

    async read(filePath: string): Promise<Record<string, unknown>> {
        const TOML = await import('@iarna/toml');
        const content = await fsPromises.readFile(filePath, 'utf-8');
        return TOML.parse(content) as Record<string, unknown>;
    }

    async write(filePath: string, data: Record<string, unknown>): Promise<void> {
        const TOML = await import('@iarna/toml');
        const tomlString = TOML.stringify(data as Parameters<typeof TOML.stringify>[0]);
        await fsPromises.writeFile(filePath, tomlString, 'utf-8');
    }
}

/** Singleton JSON format instance */
const jsonFormat = new JsonSettingsFormat();

/** Singleton JSONC format instance */
const jsoncFormat = new JsoncSettingsFormat();

/** Singleton TOML format instance */
const tomlFormat = new TomlSettingsFormat();

/**
 * Get the appropriate settings format for a code agent.
 *
 * Determines the format based on the agent's settings file name:
 * - Files ending in .toml use TomlSettingsFormat
 * - Files ending in .jsonc use JsoncSettingsFormat
 * - All other files use JsonSettingsFormat (default)
 *
 * @param codeAgent The code agent to get the format for
 * @returns The appropriate SettingsFormat implementation
 */
export function getSettingsFormat(codeAgent: CodeAgent): SettingsFormat {
    const settingsFileName = codeAgent.getSettingsFileName();
    if (settingsFileName.endsWith('.toml')) {
        return tomlFormat;
    }
    if (settingsFileName.endsWith('.jsonc')) {
        return jsoncFormat;
    }
    return jsonFormat;
}
