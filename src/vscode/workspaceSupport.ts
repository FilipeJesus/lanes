import * as vscode from 'vscode';

export interface WorkspaceSupportState {
    workspaceRoot: string | undefined;
    requirementMessage: string;
    warningMessage?: string;
    isSupported: boolean;
    isMultiRoot: boolean;
}

const NO_WORKSPACE_MESSAGE = 'Lanes requires an open folder in VS Code.';
const MULTI_ROOT_MESSAGE = 'Lanes supports single-folder VS Code windows only. Open one repository folder in its own window to create or manage sessions.';

export function resolveWorkspaceSupport(
    workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders
): WorkspaceSupportState {
    const folders = workspaceFolders ?? [];

    if (folders.length === 0) {
        return {
            workspaceRoot: undefined,
            requirementMessage: NO_WORKSPACE_MESSAGE,
            isSupported: false,
            isMultiRoot: false,
        };
    }

    if (folders.length > 1) {
        return {
            workspaceRoot: undefined,
            requirementMessage: MULTI_ROOT_MESSAGE,
            warningMessage: `${MULTI_ROOT_MESSAGE} Current window: ${folders.length} folders.`,
            isSupported: false,
            isMultiRoot: true,
        };
    }

    return {
        workspaceRoot: folders[0].uri.fsPath,
        requirementMessage: '',
        isSupported: true,
        isMultiRoot: false,
    };
}
