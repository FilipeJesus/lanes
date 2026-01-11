/**
 * Workflow template discovery.
 * Discovers workflow templates from both built-in and custom locations.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

/**
 * Metadata for a discovered workflow template.
 */
export interface WorkflowMetadata {
  /** Name of the workflow (from YAML) */
  name: string;
  /** Description of the workflow (from YAML) */
  description: string;
  /** Absolute path to the workflow file */
  path: string;
  /** Whether this is a built-in workflow (vs custom) */
  isBuiltIn: boolean;
}

/**
 * Extracts name and description from a YAML workflow file.
 * Returns null if the file cannot be parsed or lacks required fields.
 *
 * @param filePath - Absolute path to the YAML file
 * @returns Object with name and description, or null if invalid
 */
async function extractWorkflowMetadata(filePath: string): Promise<{ name: string; description: string } | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const parsed = yaml.parse(content);

    // Validate that we have the required fields
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.name === 'string' &&
      typeof parsed.description === 'string'
    ) {
      return {
        name: parsed.name,
        description: parsed.description,
      };
    }

    return null;
  } catch {
    // File read error, YAML parse error, etc. - skip this file
    return null;
  }
}

/**
 * Lists YAML files in a directory.
 * Returns an empty array if the directory doesn't exist or can't be read.
 *
 * @param dirPath - Absolute path to the directory
 * @returns Array of absolute paths to .yaml files
 */
async function listYamlFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.yaml'))
      .map(entry => path.join(dirPath, entry.name));
  } catch {
    // Directory doesn't exist or can't be read - return empty array
    return [];
  }
}

/**
 * Discovers workflow templates from a directory.
 *
 * @param dirPath - Absolute path to the directory to scan
 * @param isBuiltIn - Whether these are built-in workflows
 * @returns Array of workflow metadata
 */
async function discoverFromDirectory(
  dirPath: string,
  isBuiltIn: boolean
): Promise<WorkflowMetadata[]> {
  const yamlFiles = await listYamlFiles(dirPath);
  const results: WorkflowMetadata[] = [];

  for (const filePath of yamlFiles) {
    const metadata = await extractWorkflowMetadata(filePath);
    if (metadata) {
      results.push({
        ...metadata,
        path: filePath,
        isBuiltIn,
      });
    } else {
      // Log skipped files to help with debugging invalid workflow definitions
      console.warn(`Lanes: Skipping invalid workflow file: ${filePath}`);
    }
  }

  return results;
}

/**
 * Options for workflow discovery.
 */
export interface DiscoverWorkflowsOptions {
  /** Absolute path to the extension root (for built-in workflows) */
  extensionPath: string;
  /** Absolute path to the workspace root (for custom workflows) */
  workspaceRoot: string;
  /** Custom workflows folder relative to workspace root (default: '.lanes/workflows') */
  customWorkflowsFolder?: string;
}

/**
 * Discovers all available workflow templates from built-in and custom locations.
 *
 * Built-in workflows are loaded from the extension's `workflows/` directory.
 * Custom workflows are loaded from the workspace's configured folder.
 *
 * Invalid or malformed workflow files are silently skipped.
 * If the custom workflows folder doesn't exist, no error is raised.
 *
 * @param options - Discovery options
 * @returns Array of workflow metadata, with built-in workflows first
 */
export async function discoverWorkflows(options: DiscoverWorkflowsOptions): Promise<WorkflowMetadata[]> {
  const { extensionPath, workspaceRoot, customWorkflowsFolder = '.lanes/workflows' } = options;

  // Discover built-in workflows
  const builtIn = await discoverFromDirectory(path.join(extensionPath, 'workflows'), true);

  // Validate customWorkflowsFolder against path traversal attacks
  // Reject explicit parent directory traversal patterns
  if (customWorkflowsFolder.includes('..')) {
    console.warn('Lanes: Parent directory traversal (..) not allowed in customWorkflowsFolder');
    return [...builtIn];
  }

  // Verify resolved path stays within workspace root
  const normalizedWorkspace = path.normalize(workspaceRoot + path.sep);
  const resolvedCustomPath = path.normalize(path.join(workspaceRoot, customWorkflowsFolder));
  if (!resolvedCustomPath.startsWith(normalizedWorkspace)) {
    console.warn('Lanes: Path traversal detected - customWorkflowsFolder resolves outside workspace');
    return [...builtIn];
  }

  // Discover custom workflows from validated path
  const custom = await discoverFromDirectory(resolvedCustomPath, false);

  // Return built-in workflows first, then custom
  return [...builtIn, ...custom];
}

/**
 * Discovers workflows using VS Code configuration for the custom folder path.
 * This is a convenience function for use within VS Code context.
 *
 * @param extensionPath - Absolute path to the extension root
 * @param workspaceRoot - Absolute path to the workspace root
 * @param getConfigValue - Function to get configuration value (for testing/DI)
 * @returns Array of workflow metadata
 */
export async function discoverWorkflowsWithConfig(
  extensionPath: string,
  workspaceRoot: string,
  getConfigValue?: <T>(section: string, key: string, defaultValue: T) => T
): Promise<WorkflowMetadata[]> {
  // Use default value if no config function provided
  const customWorkflowsFolder = getConfigValue
    ? getConfigValue<string>('lanes', 'customWorkflowsFolder', '.lanes/workflows')
    : '.lanes/workflows';

  return discoverWorkflows({
    extensionPath,
    workspaceRoot,
    customWorkflowsFolder,
  });
}
