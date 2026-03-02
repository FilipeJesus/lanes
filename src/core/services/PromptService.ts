/**
 * PromptService - Shared prompt assembly and file writing for all adapters.
 *
 * Combines workflow orchestrator instructions with user prompts and handles
 * writing prompts to files with command substitution for shell safety.
 */

import * as fsPromises from 'fs/promises';
import { getWorkflowOrchestratorInstructions } from './WorkflowService';
import { getPromptsPath } from '../session/SessionDataService';

export interface PromptAssemblyOptions {
    /** User-provided prompt text. */
    userPrompt?: string;
    /** Resolved workflow path (null means no workflow). */
    effectiveWorkflow: string | null;
    /** True when session was cleared (skipWorkflowPrompt case). */
    isCleared?: boolean;
}

/**
 * Combine workflow orchestrator instructions with user prompt.
 * Returns undefined if no prompt content would result.
 */
export function assemblePrompt(options: PromptAssemblyOptions): string | undefined {
    const { effectiveWorkflow, isCleared } = options;
    const trimmed = options.userPrompt?.trim() || '';

    if (effectiveWorkflow && trimmed) {
        return getWorkflowOrchestratorInstructions(effectiveWorkflow) + trimmed;
    }

    if (effectiveWorkflow && isCleared) {
        return getWorkflowOrchestratorInstructions(effectiveWorkflow) + `This is a Lanes workflow session that has been cleared.

To resume your work:
1. Call workflow_status to check the current state of the workflow
2. Review any artifacts from the previous session to understand what was completed
3. Continue with the next steps in the workflow

Proceed with resuming the workflow from where it left off.`;
    }

    if (effectiveWorkflow) {
        return getWorkflowOrchestratorInstructions(effectiveWorkflow) + 'Start the workflow and follow the steps.';
    }

    if (isCleared) {
        return `This is a Lanes session that has been cleared and restarted with fresh context.

To resume your work:
1. Call workflow_status to check if there is an active workflow and its current state
2. Continue working based on the workflow status

Proceed by calling workflow_status now.`;
    }

    return trimmed || undefined;
}

export interface WritePromptFileResult {
    /** Absolute path to the written prompt file. */
    path: string;
    /** Shell command substitution argument (e.g. '"$(cat "/path/to/prompt")"'). */
    commandArg: string;
}

/**
 * Write prompt content to a file and return the command substitution string.
 * Returns null if prompt is empty or path resolution fails.
 */
export async function writePromptFile(
    prompt: string,
    sessionName: string,
    repoRoot: string,
    promptsFolder?: string,
): Promise<WritePromptFileResult | null> {
    if (!prompt) {
        return null;
    }

    const promptPathInfo = getPromptsPath(sessionName, repoRoot, promptsFolder);
    if (!promptPathInfo) {
        return null;
    }

    await fsPromises.mkdir(promptPathInfo.needsDir, { recursive: true });
    await fsPromises.writeFile(promptPathInfo.path, prompt, 'utf-8');

    const escapedPath = promptPathInfo.path.replace(/"/g, '\\"');
    return {
        path: promptPathInfo.path,
        commandArg: `"$(cat "${escapedPath}")"`,
    };
}
