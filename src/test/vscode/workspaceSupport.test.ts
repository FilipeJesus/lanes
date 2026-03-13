import * as assert from 'assert';
import * as vscode from 'vscode';
import { resolveWorkspaceSupport } from '../../vscode/workspaceSupport';

function createWorkspaceFolder(name: string, fsPath: string, index = 0): vscode.WorkspaceFolder {
    return {
        uri: vscode.Uri.file(fsPath),
        name,
        index,
    };
}

suite('Workspace Support', () => {
    test('returns unsupported state when no workspace folder is open', () => {
        const state = resolveWorkspaceSupport([]);

        assert.strictEqual(state.isSupported, false);
        assert.strictEqual(state.workspaceRoot, undefined);
        assert.strictEqual(state.isMultiRoot, false);
        assert.strictEqual(state.requirementMessage, 'Lanes requires an open folder in VS Code.');
    });

    test('returns workspace root when exactly one folder is open', () => {
        const state = resolveWorkspaceSupport([
            createWorkspaceFolder('app', '/workspace/app')
        ]);

        assert.strictEqual(state.isSupported, true);
        assert.strictEqual(state.workspaceRoot, '/workspace/app');
        assert.strictEqual(state.requirementMessage, '');
        assert.strictEqual(state.warningMessage, undefined);
    });

    test('rejects multi-root workspaces with an explicit warning', () => {
        const state = resolveWorkspaceSupport([
            createWorkspaceFolder('app', '/workspace/app', 0),
            createWorkspaceFolder('api', '/workspace/api', 1),
        ]);

        assert.strictEqual(state.isSupported, false);
        assert.strictEqual(state.workspaceRoot, undefined);
        assert.strictEqual(state.isMultiRoot, true);
        assert.strictEqual(
            state.requirementMessage,
            'Lanes supports single-folder VS Code windows only. Open one repository folder in its own window to create or manage sessions.'
        );
        assert.ok(state.warningMessage?.includes('Current window: 2 folders.'));
    });
});
