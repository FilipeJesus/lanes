/**
 * ProjectManagerService - Integrates with the Project Manager VS Code extension
 *
 * This service provides functions for adding/removing projects from Project Manager
 * (ID: alefragnani.project-manager) by directly reading/writing its projects.json file.
 *
 * The path to projects.json is derived from our extension's globalStorageUri, ensuring
 * we write to the correct location regardless of the VS Code installation type.
 *
 * LIMITATION: This integration is disabled in remote development contexts (Remote-SSH,
 * Remote-WSL, Dev Containers) because Project Manager is a UI extension that runs
 * locally while Lanes runs on the remote machine. The worktree paths created
 * on the remote wouldn't be accessible from Project Manager anyway.
 *
 * @see https://marketplace.visualstudio.com/items?itemName=alefragnani.project-manager
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fsPromises from 'fs/promises';

/**
 * The extension ID for Project Manager by Alessandro Fragnani.
 */
const PROJECT_MANAGER_EXTENSION_ID = 'alefragnani.project-manager';

/**
 * Cached reference to our extension's global storage path.
 * Set during initialization.
 */
let globalStoragePath: string | undefined;

/**
 * Initialize the service with the extension context.
 * Must be called during extension activation.
 *
 * Note: Project Manager integration is disabled in remote contexts (Remote-SSH,
 * Remote-WSL, Dev Containers) because Project Manager is a UI extension that
 * stores its data locally, while Lanes runs on the remote machine.
 * The paths would not be accessible from Project Manager anyway.
 *
 * @param context The VS Code extension context
 */
export function initialize(context: vscode.ExtensionContext): void {
    // Skip initialization in remote contexts
    // Project Manager runs locally while we run on the remote - paths wouldn't match
    if (vscode.env.remoteName) {
        console.log(`Lanes: Skipping Project Manager integration in remote context (${vscode.env.remoteName})`);
        return;
    }

    // Get our extension's global storage path and derive Project Manager's path from it
    // Our path: .../globalStorage/FilipeMarquesJesus.lanes
    // PM path:  .../globalStorage/alefragnani.project-manager
    const ourStoragePath = context.globalStorageUri.fsPath;
    const globalStorageDir = path.dirname(ourStoragePath);
    globalStoragePath = path.join(globalStorageDir, PROJECT_MANAGER_EXTENSION_ID);
}

/**
 * Get the path to Project Manager's projects.json file.
 * Uses the global storage path derived from our extension's context.
 *
 * @returns Path to projects.json, or undefined if not initialized
 */
function getProjectsFilePath(): string | undefined {
    if (!globalStoragePath) {
        console.warn('Lanes: ProjectManagerService not initialized. Call initialize() first.');
        return undefined;
    }
    return path.join(globalStoragePath, 'projects.json');
}

/**
 * Represents a project entry in Project Manager.
 * This interface matches the structure used in projects.json.
 */
export interface ProjectEntry {
    /** Display name of the project */
    name: string;
    /** Absolute path to the project root */
    rootPath: string;
    /** Whether the project is enabled/visible in the list */
    enabled: boolean;
    /** Optional tags for organizing projects */
    tags?: string[];
    /** Optional group for organizing projects */
    group?: string;
}

/**
 * Check if the Project Manager extension is installed.
 *
 * @returns true if the extension is installed, false otherwise
 */
export function isProjectManagerAvailable(): boolean {
    const extension = vscode.extensions.getExtension(PROJECT_MANAGER_EXTENSION_ID);
    return extension !== undefined;
}

/**
 * Get all projects from Project Manager.
 * Reads directly from projects.json file.
 *
 * @returns Array of projects, or empty array if not available
 */
export async function getProjects(): Promise<ProjectEntry[]> {
    const projectsPath = getProjectsFilePath();
    if (!projectsPath) {
        return [];
    }

    try {
        const content = await fsPromises.readFile(projectsPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            return parsed;
        }
        return [];
    } catch {
        // File doesn't exist or is invalid - return empty array
        return [];
    }
}

/**
 * Add a project to Project Manager.
 * Writes directly to projects.json file using atomic writes.
 *
 * @param name Display name for the project
 * @param rootPath Absolute path to the project root
 * @param tags Optional tags for organizing the project
 * @returns true if the project was added successfully, false otherwise
 */
export async function addProject(
    name: string,
    rootPath: string,
    tags?: string[]
): Promise<boolean> {
    // Validate inputs
    if (!name || !name.trim()) {
        console.warn('Lanes: addProject called with empty name');
        return false;
    }

    if (!rootPath || !rootPath.trim()) {
        console.warn('Lanes: addProject called with empty rootPath');
        return false;
    }

    const projectsPath = getProjectsFilePath();
    if (!projectsPath) {
        return false;
    }

    try {
        // Read existing projects
        let projects: ProjectEntry[] = [];
        try {
            const content = await fsPromises.readFile(projectsPath, 'utf-8');
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
                projects = parsed;
            }
        } catch {
            // File doesn't exist or is invalid - start with empty array
        }

        // Check if project already exists (by path)
        const existingIndex = projects.findIndex(p => p.rootPath === rootPath);
        if (existingIndex >= 0) {
            // Update existing project
            projects[existingIndex].name = name;
            projects[existingIndex].tags = tags || ['lanes'];
        } else {
            // Add new project
            projects.push({
                name,
                rootPath,
                enabled: true,
                tags: tags || ['lanes']
            });
        }

        // Ensure directory exists
        await fsPromises.mkdir(path.dirname(projectsPath), { recursive: true });

        // Write back atomically (write to temp, then rename)
        const tempPath = `${projectsPath}.${Date.now()}.tmp`;
        await fsPromises.writeFile(tempPath, JSON.stringify(projects, null, 4), 'utf-8');
        await fsPromises.rename(tempPath, projectsPath);

        return true;

    } catch (err) {
        console.error('Lanes: Failed to add project to Project Manager:', err);
        return false;
    }
}

/**
 * Remove a project from Project Manager by its root path.
 * Writes directly to projects.json file using atomic writes.
 *
 * @param rootPath Absolute path to the project root
 * @returns true if the project was removed successfully, false otherwise
 */
export async function removeProject(rootPath: string): Promise<boolean> {
    // Validate input
    if (!rootPath || !rootPath.trim()) {
        console.warn('Lanes: removeProject called with empty rootPath');
        return false;
    }

    const projectsPath = getProjectsFilePath();
    if (!projectsPath) {
        return false;
    }

    try {
        const content = await fsPromises.readFile(projectsPath, 'utf-8');
        const parsed = JSON.parse(content);

        if (!Array.isArray(parsed)) {
            return false;
        }

        // Remove the project with this path
        const projects = parsed.filter((p: ProjectEntry) => p.rootPath !== rootPath);

        // Write back atomically (write to temp, then rename)
        const tempPath = `${projectsPath}.${Date.now()}.tmp`;
        await fsPromises.writeFile(tempPath, JSON.stringify(projects, null, 4), 'utf-8');
        await fsPromises.rename(tempPath, projectsPath);

        return true;

    } catch {
        // Ignore errors - project may not exist
        return false;
    }
}

/**
 * Clear the cached global storage path.
 * Useful for testing or when the extension is reinstalled/updated.
 */
export function clearCache(): void {
    globalStoragePath = undefined;
}

/**
 * Get the extension ID being used for Project Manager.
 * Useful for debugging and error messages.
 *
 * @returns The extension ID string
 */
export function getExtensionId(): string {
    return PROJECT_MANAGER_EXTENSION_ID;
}
