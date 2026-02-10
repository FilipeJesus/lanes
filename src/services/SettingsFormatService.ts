/**
 * SettingsFormatService - Format-agnostic settings read/write
 *
 * Provides an abstraction for reading and writing settings files in different
 * formats (JSON, TOML). The format is determined by the CodeAgent instance,
 * allowing each agent to use its native configuration format.
 *
 * - Claude uses JSON (claude-settings.json)
 * - Codex uses TOML (config.toml)
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

/** Singleton TOML format instance */
const tomlFormat = new TomlSettingsFormat();

/**
 * Get the appropriate settings format for a code agent.
 *
 * Determines the format based on the agent's settings file name:
 * - Files ending in .toml use TomlSettingsFormat
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
    return jsonFormat;
}
