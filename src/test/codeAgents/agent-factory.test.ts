import * as assert from 'assert';
import { getAgent, getAvailableAgents } from '../../codeAgents/factory';
import { ClaudeCodeAgent } from '../../codeAgents/ClaudeCodeAgent';
import { CodexAgent } from '../../codeAgents/CodexAgent';
import { CortexCodeAgent } from '../../codeAgents/CortexCodeAgent';

suite('Agent Factory', () => {
    test('getAgent("claude") returns ClaudeCodeAgent instance', () => {
        const agent = getAgent('claude');
        assert.ok(agent, 'Agent should not be null');
        assert.strictEqual(agent!.name, 'claude', 'Agent name should be claude');
        assert.ok(agent instanceof ClaudeCodeAgent, 'Should be ClaudeCodeAgent instance');
    });

    test('getAgent("codex") returns CodexAgent instance', () => {
        const agent = getAgent('codex');
        assert.ok(agent, 'Agent should not be null');
        assert.strictEqual(agent!.name, 'codex', 'Agent name should be codex');
        assert.ok(agent instanceof CodexAgent, 'Should be CodexAgent instance');
    });

    test('getAgent("cortex") returns CortexCodeAgent instance', () => {
        const agent = getAgent('cortex');
        assert.ok(agent, 'Agent should not be null');
        assert.strictEqual(agent!.name, 'cortex', 'Agent name should be cortex');
        assert.ok(agent instanceof CortexCodeAgent, 'Should be CortexCodeAgent instance');
    });

    test('getAgent("unknown") returns null', () => {
        const agent = getAgent('unknown');
        assert.strictEqual(agent, null, 'Unknown agent should return null');
    });

    test('getAgent with empty string returns null', () => {
        const agent = getAgent('');
        assert.strictEqual(agent, null, 'Empty string should return null');
    });

    test('getAvailableAgents() returns array containing claude, codex, and cortex', () => {
        const agents = getAvailableAgents();
        assert.ok(Array.isArray(agents), 'Should return an array');
        assert.ok(agents.includes('claude'), 'Should include claude');
        assert.ok(agents.includes('codex'), 'Should include codex');
        assert.ok(agents.includes('cortex'), 'Should include cortex');
        assert.strictEqual(agents.length, 3, 'Should have exactly 3 agents');
    });

    test('getAgent returns same instance on repeated calls (singleton)', () => {
        const agent1 = getAgent('claude');
        const agent2 = getAgent('claude');
        assert.strictEqual(agent1, agent2, 'Should return the same instance (singleton)');

        const codexAgent1 = getAgent('codex');
        const codexAgent2 = getAgent('codex');
        assert.strictEqual(codexAgent1, codexAgent2, 'Codex should also be singleton');

        const cortexAgent1 = getAgent('cortex');
        const cortexAgent2 = getAgent('cortex');
        assert.strictEqual(cortexAgent1, cortexAgent2, 'Cortex should also be singleton');
    });

    test('getAgent returns consistent instances across different agent names', () => {
        const claudeAgent = getAgent('claude');
        const codexAgent = getAgent('codex');
        const cortexAgent = getAgent('cortex');

        assert.notStrictEqual(claudeAgent, codexAgent, 'Different agents should be different instances');
        assert.notStrictEqual(claudeAgent, cortexAgent, 'Claude and Cortex should be different instances');
        assert.notStrictEqual(codexAgent, cortexAgent, 'Codex and Cortex should be different instances');
        assert.ok(claudeAgent, 'Claude agent should exist');
        assert.ok(codexAgent, 'Codex agent should exist');
        assert.ok(cortexAgent, 'Cortex agent should exist');
    });

    test('getAgent returns correct agent types', () => {
        const claude = getAgent('claude');
        const codex = getAgent('codex');
        const cortex = getAgent('cortex');

        assert.strictEqual(claude!.name, 'claude', 'Claude agent should have name "claude"');
        assert.strictEqual(claude!.displayName, 'Claude', 'Claude should have correct display name');
        assert.strictEqual(claude!.cliCommand, 'claude', 'Claude should have correct CLI command');

        assert.strictEqual(codex!.name, 'codex', 'Codex agent should have name "codex"');
        assert.strictEqual(codex!.displayName, 'Codex', 'Codex should have correct display name');
        assert.strictEqual(codex!.cliCommand, 'codex', 'Codex should have correct CLI command');

        assert.strictEqual(cortex!.name, 'cortex', 'Cortex agent should have name "cortex"');
        assert.strictEqual(cortex!.displayName, 'Cortex Code', 'Cortex should have correct display name');
        assert.strictEqual(cortex!.cliCommand, 'cortex', 'Cortex should have correct CLI command');
    });
});

suite('Agent Factory - CLI Availability Implementation', () => {
    // Helper to get the source directory path (works from compiled out/ directory)
    function getSourcePath(relativePath: string): string {
        const fs = require('fs');
        const path = require('path');

        // __dirname in compiled code is in out/test/codeAgents/
        // We need to go up to the workspace root and then into src/
        const outDir = __dirname; // e.g., /path/to/out/test/codeAgents
        const workspaceRoot = path.resolve(outDir, '../../..'); // Go up 3 levels to workspace root
        const srcPath = path.join(workspaceRoot, 'src', relativePath);

        return srcPath;
    }

    test('isCliAvailable is exported function', () => {
        const { isCliAvailable } = require('../../codeAgents/factory');
        assert.strictEqual(typeof isCliAvailable, 'function', 'isCliAvailable should be a function');
    });

    test('factory module imports execFile not exec', () => {
        // Read the factory source to verify it uses execFile
        const fs = require('fs');
        const factoryPath = getSourcePath('codeAgents/factory.ts');
        const source = fs.readFileSync(factoryPath, 'utf-8');

        assert.ok(source.includes('import { execFile }'), 'Should import execFile from child_process');
        assert.ok(!source.includes('import { exec }') || source.includes('execFile'), 'Should not import exec, or if it does, should also have execFile');
    });

    test('isCliAvailable implementation uses execFile with args array', () => {
        // Read the factory source to verify implementation
        const fs = require('fs');
        const factoryPath = getSourcePath('codeAgents/factory.ts');
        const source = fs.readFileSync(factoryPath, 'utf-8');

        // Verify execFile is called with args array, not template literal
        assert.ok(source.includes("execFile('command'"), 'Should call execFile with command as first arg');
        assert.ok(source.includes("['-v', cliCommand]"), 'Should pass args as array');

        // Verify the actual function implementation doesn't use template string for command execution
        // Look for the isCliAvailable function implementation specifically
        const functionMatch = source.match(/export async function isCliAvailable[\s\S]*?\{[\s\S]*?\n\}/);
        assert.ok(functionMatch, 'Should find isCliAvailable function');
        const functionBody = functionMatch[0];

        // Ensure the function body uses execFile with array args, not exec with template literal
        assert.ok(!functionBody.includes('exec(`'), 'Function should not use exec with template literal');
        assert.ok(functionBody.includes('execFile'), 'Function should use execFile');
    });

    test('isCliAvailable uses shell:true not hardcoded shell path', () => {
        // Read the factory source to verify shell option
        const fs = require('fs');
        const factoryPath = getSourcePath('codeAgents/factory.ts');
        const source = fs.readFileSync(factoryPath, 'utf-8');

        // Verify shell: true is used, not shell: '/bin/sh'
        assert.ok(source.includes('shell: true'), 'Should use shell: true');
        assert.ok(!source.includes("shell: '/bin/sh'"), 'Should not hardcode shell path');
    });
});
