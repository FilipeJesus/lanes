/**
 * Tests for TmuxService — capturePane, getPaneSize, resizePane.
 *
 * These tests use a mock `tmux` script placed earlier in PATH to capture
 * the exact arguments that TmuxService passes to tmux.
 *
 * Covers:
 *  - capturePane: calls tmux capture-pane with correct flags and returns stdout
 *  - capturePane with escapeSequences=true: includes -e flag
 *  - capturePane with start/end options: includes -S and -E flags
 *  - capturePane error propagation
 *  - getPaneSize: invokes tmux display-message with correct format and parses output
 *  - getPaneSize: correctly parses '80 24' into { cols: 80, rows: 24 }
 *  - getPaneSize error propagation
 *  - resizePane: calls tmux resize-window with correct arguments
 *  - resizePane error propagation
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    capturePane,
    getPaneSize,
    resizePane,
} from '../../../core/services/TmuxService';

// ---------------------------------------------------------------------------
// Helpers — fake tmux binary via PATH injection
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory containing a mock `tmux` script.
 * The mock writes its arguments to an args file and prints the given stdout.
 * If exitCode is non-zero it exits with that code.
 */
function createMockTmux(
    dir: string,
    opts: { stdout?: string; exitCode?: number } = {}
): string {
    const argsFile = path.join(dir, 'tmux-args.txt');
    const stdout = opts.stdout ?? '';
    const exitCode = opts.exitCode ?? 0;

    const scriptPath = path.join(dir, 'tmux');

    // Write a shell script that records args and emits the configured output
    fs.writeFileSync(
        scriptPath,
        [
            '#!/bin/sh',
            // Append all args to a file (one arg per line, preceded by count)
            `printf '%s\\n' "$@" > "${argsFile}"`,
            // Print the fake stdout
            `printf '%s' "${stdout.replace(/'/g, "'\\''")}"`,
            // Exit with the configured exit code
            `exit ${exitCode}`,
        ].join('\n'),
        { mode: 0o755 }
    );

    return argsFile;
}

/**
 * Read the recorded args from the mock tmux argsFile.
 */
function readRecordedArgs(argsFile: string): string[] {
    if (!fs.existsSync(argsFile)) {
        return [];
    }
    return fs.readFileSync(argsFile, 'utf-8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
}

/**
 * Temporarily prepend a directory to PATH, execute fn, then restore PATH.
 */
async function withMockedTmux<T>(
    mockDir: string,
    fn: () => Promise<T>
): Promise<T> {
    const originalPath = process.env.PATH;
    process.env.PATH = `${mockDir}:${originalPath}`;
    try {
        return await fn();
    } finally {
        process.env.PATH = originalPath;
    }
}

// ---------------------------------------------------------------------------
// Suite: TmuxService - capturePane
// ---------------------------------------------------------------------------

suite('TmuxService - capturePane', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-tmux-cp-'));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('Given a session name, when capturePane is called, then it invokes tmux capture-pane -p -t <name>', async () => {
        // Arrange
        const argsFile = createMockTmux(tempDir, { stdout: 'pane content\n' });

        // Act
        const result = await withMockedTmux(tempDir, () =>
            capturePane('my-session')
        );

        // Assert
        const args = readRecordedArgs(argsFile);
        assert.ok(args.includes('capture-pane'), `args should include 'capture-pane', got: ${args.join(', ')}`);
        assert.ok(args.includes('-p'), `args should include '-p', got: ${args.join(', ')}`);
        assert.ok(args.includes('-t'), `args should include '-t', got: ${args.join(', ')}`);
        assert.ok(args.includes('my-session'), `args should include 'my-session', got: ${args.join(', ')}`);
        assert.strictEqual(result, 'pane content\n');
    });

    test('Given escapeSequences=true, when capturePane is called, then the -e flag is included', async () => {
        // Arrange
        const argsFile = createMockTmux(tempDir, { stdout: 'colored content\n' });

        // Act
        await withMockedTmux(tempDir, () =>
            capturePane('my-session', { escapeSequences: true })
        );

        // Assert
        const args = readRecordedArgs(argsFile);
        assert.ok(args.includes('-e'), `args should include '-e' when escapeSequences=true, got: ${args.join(', ')}`);
    });

    test('Given start and end options, when capturePane is called, then -S and -E flags are included', async () => {
        // Arrange
        const argsFile = createMockTmux(tempDir, { stdout: 'range content\n' });

        // Act
        await withMockedTmux(tempDir, () =>
            capturePane('my-session', { start: -50, end: 0 })
        );

        // Assert
        const args = readRecordedArgs(argsFile);
        assert.ok(args.includes('-S'), `args should include '-S', got: ${args.join(', ')}`);
        assert.ok(args.includes('-50'), `args should include '-50', got: ${args.join(', ')}`);
        assert.ok(args.includes('-E'), `args should include '-E', got: ${args.join(', ')}`);
        assert.ok(args.includes('0'), `args should include '0', got: ${args.join(', ')}`);
    });

    test('Given tmux command fails, when capturePane is called, then the error is propagated', async () => {
        // Arrange — mock tmux exits non-zero
        createMockTmux(tempDir, { stdout: '', exitCode: 1 });

        // Act & Assert
        let thrown: unknown;
        try {
            await withMockedTmux(tempDir, () => capturePane('my-session'));
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an error when tmux fails');
        assert.ok(
            (thrown as Error).message.includes('my-session'),
            `Error message should reference the session name, got: ${(thrown as Error).message}`
        );
    });
});

// ---------------------------------------------------------------------------
// Suite: TmuxService - getPaneSize
// ---------------------------------------------------------------------------

suite('TmuxService - getPaneSize', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-tmux-gps-'));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('Given a session name, when getPaneSize is called, then it invokes tmux display-message with pane_width and pane_height format', async () => {
        // Arrange
        const argsFile = createMockTmux(tempDir, { stdout: '80 24' });

        // Act
        await withMockedTmux(tempDir, () => getPaneSize('my-session'));

        // Assert
        const args = readRecordedArgs(argsFile);
        assert.ok(args.includes('display-message'), `args should include 'display-message', got: ${args.join(', ')}`);
        assert.ok(args.includes('-t'), `args should include '-t', got: ${args.join(', ')}`);
        assert.ok(args.includes('my-session'), `args should include 'my-session', got: ${args.join(', ')}`);

        // Verify the format string contains pane_width and pane_height
        const formatArg = args.find((a) => a.includes('pane_width') || a.includes('pane_height'));
        assert.ok(
            formatArg !== undefined,
            `args should include a format string containing pane_width / pane_height, got: ${args.join(', ')}`
        );
    });

    test("Given tmux returns '80 24', when getPaneSize is called, then it returns { cols: 80, rows: 24 }", async () => {
        // Arrange
        createMockTmux(tempDir, { stdout: '80 24' });

        // Act
        const result = await withMockedTmux(tempDir, () => getPaneSize('my-session'));

        // Assert
        assert.strictEqual(result.cols, 80);
        assert.strictEqual(result.rows, 24);
    });

    test('Given tmux command fails, when getPaneSize is called, then the error is propagated', async () => {
        // Arrange — mock tmux exits non-zero
        createMockTmux(tempDir, { exitCode: 1 });

        // Act & Assert
        let thrown: unknown;
        try {
            await withMockedTmux(tempDir, () => getPaneSize('my-session'));
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an error when tmux fails');
        assert.ok(
            (thrown as Error).message.includes('my-session'),
            `Error message should reference the session name, got: ${(thrown as Error).message}`
        );
    });
});

// ---------------------------------------------------------------------------
// Suite: TmuxService - resizePane
// ---------------------------------------------------------------------------

suite('TmuxService - resizePane', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-tmux-rp-'));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('Given a session name, cols and rows, when resizePane is called, then it invokes tmux resize-window -t <name> -x <cols> -y <rows>', async () => {
        // Arrange
        const argsFile = createMockTmux(tempDir, { stdout: '' });

        // Act
        await withMockedTmux(tempDir, () => resizePane('my-session', 120, 40));

        // Assert
        const args = readRecordedArgs(argsFile);
        assert.ok(args.includes('resize-window'), `args should include 'resize-window', got: ${args.join(', ')}`);
        assert.ok(args.includes('-t'), `args should include '-t', got: ${args.join(', ')}`);
        assert.ok(args.includes('my-session'), `args should include 'my-session', got: ${args.join(', ')}`);
        assert.ok(args.includes('-x'), `args should include '-x', got: ${args.join(', ')}`);
        assert.ok(args.includes('120'), `args should include '120', got: ${args.join(', ')}`);
        assert.ok(args.includes('-y'), `args should include '-y', got: ${args.join(', ')}`);
        assert.ok(args.includes('40'), `args should include '40', got: ${args.join(', ')}`);
    });

    test('Given tmux command fails, when resizePane is called, then the error is propagated', async () => {
        // Arrange — mock tmux exits non-zero
        createMockTmux(tempDir, { exitCode: 1 });

        // Act & Assert
        let thrown: unknown;
        try {
            await withMockedTmux(tempDir, () => resizePane('my-session', 80, 24));
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an error when tmux fails');
        assert.ok(
            (thrown as Error).message.includes('my-session'),
            `Error message should reference the session name, got: ${(thrown as Error).message}`
        );
    });
});
