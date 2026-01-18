import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import {
    initializeGlobalStorageContext,
} from '../ClaudeSessionProvider';
import { getOrCreateExtensionSettingsFile } from '../extension';
import { ClaudeCodeAgent } from '../codeAgents/ClaudeCodeAgent';

suite('Hook Script Generation', () => {
    let tempDir: string;
    let worktreesDir: string;
    let globalStorageDir: string;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-hook-script-test-'));
        worktreesDir = path.join(tempDir, '.worktrees');
        fs.mkdirSync(worktreesDir, { recursive: true });
        globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-global-storage-'));

        // Initialize global storage context for tests
        const mockUri = vscode.Uri.file(globalStorageDir);
        initializeGlobalStorageContext(mockUri, tempDir);

        // Enable global storage for these tests
        const config = vscode.workspace.getConfiguration('lanes');
        await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);
    });

    teardown(async () => {
        // Reset configuration
        const config = vscode.workspace.getConfiguration('lanes');
        await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);

        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.rmSync(globalStorageDir, { recursive: true, force: true });
    });

    test('generates hook script with executable permissions', async () => {
        // Arrange
        const sessionName = 'hook-script-perms-test';
        const worktreePath = path.join(worktreesDir, sessionName);
        fs.mkdirSync(worktreePath, { recursive: true });

        const codeAgent = new ClaudeCodeAgent();
        const settingsPath = await getOrCreateExtensionSettingsFile(
            worktreePath,
            undefined,
            codeAgent
        );

        // Verify settings file was created
        assert.ok(settingsPath, 'Settings file path should be returned');

        // Get the settings directory path
        const settingsDir = path.dirname(settingsPath);
        const hookScriptPath = path.join(settingsDir, 'register-artefact.sh');

        // Verify hook script exists
        assert.ok(fs.existsSync(hookScriptPath), 'Hook script should be created');

        // Verify script is executable
        const stats = await fsPromises.stat(hookScriptPath);
        // On Unix, mode 0o755 means owner can read/write/execute, others can read/execute
        // Note: This check may not work on Windows
        if (process.platform !== 'win32') {
            assert.ok((stats.mode & 0o111) !== 0, 'Hook script should be executable');
        }

        // Read and verify script content
        const content = await fsPromises.readFile(hookScriptPath, 'utf-8');
        assert.ok(content.includes('#!/bin/bash'), 'Script should have shebang');
        assert.ok(content.includes('.tool_input.file_path'), 'Script should use correct JSON path (tool_input.file_path)');
        assert.ok(!content.includes('tool_response.filePath'), 'Script should NOT use incorrect JSON path (tool_response.filePath)');
        assert.ok(content.includes('currentStepArtefacts'), 'Script should check currentStepArtefacts');
        assert.ok(content.includes('artefacts'), 'Script should add to artefacts array');
    });

    test('hook script contains correct JSON path for Write tool', async () => {
        // Arrange
        const sessionName = 'json-path-test';
        const worktreePath = path.join(worktreesDir, sessionName);
        fs.mkdirSync(worktreePath, { recursive: true });

        const codeAgent = new ClaudeCodeAgent();
        const settingsPath = await getOrCreateExtensionSettingsFile(
            worktreePath,
            undefined,
            codeAgent
        );

        const settingsDir = path.dirname(settingsPath);
        const hookScriptPath = path.join(settingsDir, 'register-artefact.sh');
        const content = await fsPromises.readFile(hookScriptPath, 'utf-8');

        // The critical fix: verify .tool_input.file_path is used
        assert.match(content, /tool_input\.file_path/,
            'Hook script must extract file path from .tool_input.file_path (not .tool_response.filePath)');
    });

    test('hook script checks workflow state before registering artefacts', async () => {
        // Arrange
        const sessionName = 'workflow-state-check-test';
        const worktreePath = path.join(worktreesDir, sessionName);
        fs.mkdirSync(worktreePath, { recursive: true });

        const codeAgent = new ClaudeCodeAgent();
        const settingsPath = await getOrCreateExtensionSettingsFile(
            worktreePath,
            undefined,
            codeAgent
        );

        const settingsDir = path.dirname(settingsPath);
        const hookScriptPath = path.join(settingsDir, 'register-artefact.sh');
        const content = await fsPromises.readFile(hookScriptPath, 'utf-8');

        // Verify the script checks for workflow-state.json
        assert.ok(content.includes('workflow-state.json'), 'Script should check for workflow-state.json');
        assert.ok(content.includes('currentStepArtefacts'), 'Script should check currentStepArtefacts flag');
    });

    test('hook script only registers files that exist', async () => {
        // Arrange
        const sessionName = 'file-existence-test';
        const worktreePath = path.join(worktreesDir, sessionName);
        fs.mkdirSync(worktreePath, { recursive: true });

        const codeAgent = new ClaudeCodeAgent();
        const settingsPath = await getOrCreateExtensionSettingsFile(
            worktreePath,
            undefined,
            codeAgent
        );

        const settingsDir = path.dirname(settingsPath);
        const hookScriptPath = path.join(settingsDir, 'register-artefact.sh');
        const content = await fsPromises.readFile(hookScriptPath, 'utf-8');

        // Verify the script checks file existence before adding to artefacts
        assert.ok(content.includes('[ -f "$FILE_PATH" ]'), 'Script should check if file exists before registering');
    });
});
