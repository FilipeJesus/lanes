import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import sinon from 'sinon';
import { PiAgent } from '../../core/codeAgents/PiAgent';

suite('PiAgent', () => {
    let agent: PiAgent;
    let tempDir: string;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        agent = new PiAgent();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-pi-'));
        sandbox = sinon.createSandbox();
    });
    teardown(() => {
        sandbox.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // Execute the generated shell command with an argv-recording function, never an AI CLI.
    function argv(command: string): string[] {
        const result = execFileSync('/bin/sh', ['-c', `pi() { printf '%s\\0' "$@"; }; ${command}`]);
        return result.toString().split('\0').slice(0, -1);
    }

    // Native Pi classification after -- still treats @ as a file argument.
    // Fixture source (unchanged in both supported releases):
    // https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/src/cli/args.ts#L78-L84
    // https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/cli/args.ts
    function classifyPiPositionals(args: string[]): { messages: string[]; fileArgs: string[] } {
        const delimiter = args.indexOf('--');
        assert.ok(delimiter >= 0, 'Generated prompt command must terminate option parsing');
        const result = { messages: [] as string[], fileArgs: [] as string[] };
        for (const positionalArg of args.slice(delimiter + 1)) {
            if (positionalArg.startsWith('@')) {
                result.fileArgs.push(positionalArg.slice(1));
            } else {
                result.messages.push(positionalArg);
            }
        }
        return result;
    }

    test('start safely transports leading dashes, quotes, dollars, backticks and newlines', () => {
        const prompt = '- Fix "quotes", apostrophes\' and $HOME\n`echo unsafe` $(echo unsafe)';
        assert.deepStrictEqual(argv(agent.buildStartCommand({ prompt })), ['--', ` ${prompt}`]);
    });

    test('raw shell substitution remains prompt data', () => {
        const marker = path.join(tempDir, 'must-not-exist');
        const prompt = `"$(touch '${marker}')"`;
        assert.deepStrictEqual(argv(agent.buildStartCommand({ prompt })), ['--', ` ${prompt}`]);
        assert.strictEqual(fs.existsSync(marker), false);
    });

    test('only explicit promptFilePath loads a file with unusual characters', () => {
        const promptFilePath = path.join(tempDir, 'prompt space\'s $(echo no).md');
        const prompt = '- actual prompt\nwith $dollars, "quotes" and an apostrophe\'';
        fs.writeFileSync(promptFilePath, prompt);
        const sessionPath = path.join(tempDir, 'session space\'s.jsonl');
        assert.deepStrictEqual(argv(agent.buildStartCommand({ prompt: 'ignored', promptFilePath, sessionPath })),
            ['--session', sessionPath, '--', ` ${prompt}`]);
        assert.throws(() => agent.buildStartCommand({ promptFilePath: 'relative.md' }), /absolute prompt/);
    });

    test('raw @-prefixed prompts remain messages under native Pi positional classification', () => {
        const prompt = '@README.md explain this';
        // Negative control: -- alone does not prevent native attachment interpretation.
        assert.deepStrictEqual(classifyPiPositionals(['--', prompt]),
            { messages: [], fileArgs: ['README.md explain this'] });
        const transported = argv(agent.buildStartCommand({ prompt }));
        assert.deepStrictEqual(transported, ['--', ` ${prompt}`]);
        const parsed = classifyPiPositionals(transported);
        assert.deepStrictEqual(parsed.fileArgs, []);
        assert.deepStrictEqual(parsed.messages, [` ${prompt}`]);
        assert.strictEqual(parsed.messages[0].trimStart(), prompt);
    });

    test('prompt files beginning with @, a dash or ordinary text remain single native Pi messages', () => {
        const promptFilePath = path.join(tempDir, 'prompt space\'s $(echo no).md');
        for (const prompt of ['@README.md explain this', '- List the files', 'Explain this code']) {
            fs.writeFileSync(promptFilePath, prompt);
            const transported = argv(agent.buildStartCommand({ promptFilePath }));
            assert.deepStrictEqual(transported, ['--', ` ${prompt}`]);
            const parsed = classifyPiPositionals(transported);
            assert.deepStrictEqual(parsed.fileArgs, []);
            assert.deepStrictEqual(parsed.messages, [` ${prompt}`]);
            assert.strictEqual(parsed.messages[0].trimStart(), prompt);
        }
    });

    test('resume accepts IDs and escaped absolute JSONL paths, preferring saved logPath', () => {
        assert.deepStrictEqual(argv(agent.buildResumeCommand('abc-123', {})), ['--session', 'abc-123']);
        const sessionPath = path.join(tempDir, 'session\'s $(echo nope).jsonl');
        assert.deepStrictEqual(argv(agent.buildResumeCommand('abc-123', { sessionPath })), ['--session', sessionPath]);
        assert.deepStrictEqual(argv(agent.buildResumeCommand(sessionPath, {})), ['--session', sessionPath]);
    });

    test('resume rejects malformed IDs, relative files and control characters', () => {
        for (const value of ['', '-option', '../session.jsonl', 'id; touch /tmp/unsafe', '$(echo unsafe)', '/tmp/a\n.jsonl']) {
            assert.throws(() => agent.buildResumeCommand(value, {}), /Invalid Pi session/);
        }
        assert.throws(() => agent.buildResumeCommand('abc', { sessionPath: '/tmp/a.txt' }), /absolute JSONL/);
        assert.throws(() => agent.buildStartCommand({ sessionPath: 'relative.jsonl' }), /absolute JSONL/);
    });

    test('permission and integration options emit no unsupported CLI flags', () => {
        const options = { permissionMode: 'bypassPermissions', settingsPath: '/unused/settings.json',
            mcpConfigPath: '/unused/mcp.json', mcpConfigOverrides: ['unused'] };
        assert.strictEqual(agent.buildStartCommand(options), 'pi');
        assert.deepStrictEqual(argv(agent.buildResumeCommand('abc', options)), ['--session', 'abc']);
        assert.deepStrictEqual(agent.getPermissionModes().map(mode => mode.id), ['bypassPermissions']);
        assert.strictEqual(agent.validatePermissionMode('acceptEdits'), false);
        assert.strictEqual(agent.supportsHooks(), false);
    });

    test('prompt improvement passes one literal argv prompt to print without saving a session', () => {
        const prompt = '- Hello $HOME\n"$(echo unsafe)"';
        const result = agent.buildPromptImproveCommand(prompt);
        assert.strictEqual(result.command, 'pi');
        assert.deepStrictEqual(result.args.slice(0, 3), ['--print', '--no-session', '--']);
        assert.strictEqual(result.args.length, 4);
        assert.ok(result.args[3].endsWith(prompt));
    });

    test('reserved identity is a unique resumable path even before a log exists', () => {
        const first = agent.createSessionIdentity(tempDir);
        const second = agent.createSessionIdentity(tempDir);
        assert.strictEqual(first.sessionId, first.logPath);
        assert.notStrictEqual(first.logPath, second.logPath);
        assert.strictEqual(path.dirname(first.logPath!), tempDir);
        assert.strictEqual(fs.existsSync(first.logPath!), false);
        assert.ok(agent.parseSessionData(JSON.stringify(first)));
    });

    test('session and status parsing validate input and preserve Pi identity', () => {
        assert.strictEqual(agent.parseSessionData('{"sessionId":"bad;cmd"}'), null);
        assert.strictEqual(agent.parseSessionData('{"sessionId":123}'), null);
        assert.strictEqual(agent.parseSessionData('broken'), null);
        const parsed = agent.parseSessionData(JSON.stringify({ sessionId: 'abc', workflow: 'feature', isChimeEnabled: true }));
        assert.strictEqual(parsed?.agentName, 'pi');
        assert.strictEqual(parsed?.workflow, 'feature');
        assert.strictEqual(parsed?.isChimeEnabled, true);
        assert.strictEqual(agent.parseStatus('{"status":"working"}')?.status, 'working');
        assert.strictEqual(agent.parseStatus('{"status":"unknown"}'), null);
    });

    suite('session capture', () => {
        let previousAgentDir: string | undefined;
        let previousSessionDir: string | undefined;
        const before = new Date('2026-10-18T00:00:00Z');
        setup(() => {
            previousAgentDir = process.env.PI_CODING_AGENT_DIR;
            previousSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
            delete process.env.PI_CODING_AGENT_DIR;
            delete process.env.PI_CODING_AGENT_SESSION_DIR;
        });
        teardown(() => {
            if (previousAgentDir === undefined) { delete process.env.PI_CODING_AGENT_DIR; }
            else { process.env.PI_CODING_AGENT_DIR = previousAgentDir; }
            if (previousSessionDir === undefined) { delete process.env.PI_CODING_AGENT_SESSION_DIR; }
            else { process.env.PI_CODING_AGENT_SESSION_DIR = previousSessionDir; }
        });
        function writeHeader(directory: string, filename: string, header: Record<string, unknown>): string {
            fs.mkdirSync(directory, { recursive: true });
            const file = path.join(directory, filename);
            fs.writeFileSync(file, JSON.stringify({ type: 'session', id: 'valid-id', cwd: tempDir,
                timestamp: '2026-10-18T00:00:01Z', ...header }) + '\n{"type":"message"}\n');
            return file;
        }
        function scopedDirectory(agentDir: string): string {
            return path.join(agentDir, 'sessions', `--${tempDir.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`);
        }

        test('default storage uses home/.pi/agent and exact worktree scope', async () => {
            sandbox.stub(require('os'), 'homedir').returns(tempDir);
            const expected = writeHeader(scopedDirectory(path.join(tempDir, '.pi', 'agent')), 'native.jsonl', {});
            assert.deepStrictEqual(await agent.captureSessionIdForWorktree(before, tempDir, 0),
                { sessionId: 'valid-id', logPath: expected });
        });

        test('configured agent directory ignores stale, malformed and foreign headers and chooses newest valid', async () => {
            process.env.PI_CODING_AGENT_DIR = path.join(tempDir, 'custom-agent');
            const directory = scopedDirectory(process.env.PI_CODING_AGENT_DIR);
            const expected = writeHeader(directory, 'new.jsonl', { id: 'newest', timestamp: '2026-10-18T00:00:05Z' });
            writeHeader(directory, 'old.jsonl', { timestamp: '2026-10-17T23:59:59Z' });
            writeHeader(directory, 'older-valid.jsonl', {});
            writeHeader(directory, 'foreign.jsonl', { cwd: path.join(tempDir, 'other') });
            writeHeader(directory, 'invalid-id.jsonl', { id: 'bad;command' });
            writeHeader(directory, 'relative.jsonl', { cwd: '.' });
            writeHeader(directory, 'not-session.jsonl', { type: 'message' });
            writeHeader(directory, 'timestamp.jsonl', { timestamp: 'invalid' });
            fs.writeFileSync(path.join(directory, 'truncated.jsonl'), '{"type":"session",');
            writeHeader(directory, 'ignore.txt', { id: 'wrong-extension' });
            assert.deepStrictEqual(await agent.captureSessionIdForWorktree(before, tempDir, 0),
                { sessionId: 'newest', logPath: expected });
        });

        test('configured session directory still validates the launching worktree', async () => {
            process.env.PI_CODING_AGENT_SESSION_DIR = 'custom-sessions';
            const directory = path.join(tempDir, 'custom-sessions');
            writeHeader(directory, 'foreign.jsonl', { cwd: path.join(tempDir, 'other') });
            assert.strictEqual(await agent.captureSessionIdForWorktree(before, tempDir, 0), null);
            const expected = writeHeader(directory, 'correct.jsonl', {});
            assert.deepStrictEqual(await agent.captureSessionIdForWorktree(before, tempDir, 0),
                { sessionId: 'valid-id', logPath: expected });
        });

        test('missing session directories return null without throwing', async () => {
            process.env.PI_CODING_AGENT_DIR = path.join(tempDir, 'missing');
            assert.strictEqual(await agent.captureSessionIdForWorktree(before, tempDir, 0), null);
        });
    });
});
