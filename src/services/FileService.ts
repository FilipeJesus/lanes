/**
 * FileService - Centralized async file I/O operations
 *
 * Provides consistent async file operations with atomic writes,
 * JSON handling, and ENOENT-safe reads. All functions use fs/promises
 * to ensure non-blocking I/O throughout the codebase.
 */

import * as fs from 'fs/promises';
import { constants } from 'fs';

/**
 * Write content to a file atomically using a temp-file-then-rename pattern.
 * This prevents file corruption if the process crashes mid-write.
 *
 * @param filePath - The target file path
 * @param content - The string content to write
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp.${process.pid}`;

    try {
        await fs.writeFile(tempPath, content, 'utf-8');
        await fs.rename(tempPath, filePath);
    } catch (err) {
        // Clean up temp file on failure
        await fs.unlink(tempPath).catch(() => {});
        throw err;
    }
}

/**
 * Read and parse a JSON file with type-safe return.
 * Returns null if the file does not exist (ENOENT), re-throws other errors.
 *
 * @param filePath - The path to the JSON file
 * @returns The parsed JSON data, or null if the file does not exist
 */
export async function readJson<T>(filePath: string): Promise<T | null> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

/**
 * Write data as formatted JSON to a file atomically.
 * Uses atomicWrite internally to prevent corruption.
 *
 * @param filePath - The target file path
 * @param data - The data to serialize as JSON
 */
export async function writeJson(filePath: string, data: unknown): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    await atomicWrite(filePath, content);
}

/**
 * Create a directory and all parent directories recursively.
 * No-op if the directory already exists.
 *
 * @param dirPath - The directory path to create
 */
export async function ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Check if a file exists at the given path.
 * Returns false instead of throwing on ENOENT.
 *
 * @param filePath - The file path to check
 * @returns true if the file exists, false otherwise
 */
export async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Read the content of a file as a UTF-8 string.
 * Throws on any error (including ENOENT).
 *
 * @param filePath - The file path to read
 * @returns The file content as a string
 */
export async function readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf-8');
}

/**
 * Read the entries of a directory.
 * Returns an empty array if the directory does not exist (ENOENT).
 *
 * @param dirPath - The directory path to read
 * @returns Array of directory entry names
 */
export async function readDir(dirPath: string): Promise<string[]> {
    try {
        return await fs.readdir(dirPath);
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw err;
    }
}

/**
 * Check if a path is a directory.
 * Returns false if the path does not exist.
 *
 * @param filePath - The path to check
 * @returns true if the path is a directory, false otherwise
 */
export async function isDirectory(filePath: string): Promise<boolean> {
    try {
        const stat = await fs.stat(filePath);
        return stat.isDirectory();
    } catch {
        return false;
    }
}

/**
 * Check if a path is a file.
 * Returns false if the path does not exist.
 *
 * @param filePath - The path to check
 * @returns true if the path is a file, false otherwise
 */
export async function isFile(filePath: string): Promise<boolean> {
    try {
        const stat = await fs.stat(filePath);
        return stat.isFile();
    } catch {
        return false;
    }
}
