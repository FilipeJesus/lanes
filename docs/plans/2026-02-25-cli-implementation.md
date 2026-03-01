# Lanes CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI (`lanes-cli` npm package) that manages Lanes sessions from the terminal, reusing the existing `src/core/` layer.

**Architecture:** Monorepo approach — `src/cli/` sits alongside `src/vscode/` as a peer consumer of `src/core/`. CLI adapters implement the core interfaces. esbuild bundles to a single `out/cli.js`. Commander.js parses arguments.

**Tech Stack:** TypeScript, Commander.js (arg parsing), esbuild (bundling), Node.js `child_process.execSync/exec` for `exec` behavior.

**Design doc:** `docs/plans/2026-02-25-cli-design.md`

---

### Task 1: Add Commander.js dependency and create bundle script

**Files:**
- Modify: `package.json` (add commander dependency + bundle:cli script)
- Create: `scripts/bundle-cli.mjs`

**Step 1: Install commander**

Run: `cd /Users/filipejesus/Documents/repos/lanes && npm install commander`

**Step 2: Add bundle:cli script to package.json**

In `package.json`, add to the `"scripts"` section:

```json
"bundle:cli": "node scripts/bundle-cli.mjs"
```

And update the `"compile"` script to include CLI bundling:

```json
"compile": "tsc -p ./ && npm run bundle:extension && npm run bundle:mcp && npm run bundle:cli"
```

**Step 3: Create the bundle script**

Create `scripts/bundle-cli.mjs`:

```javascript
/**
 * Bundle the CLI with all its dependencies.
 * Creates a standalone cli.js that can run without node_modules.
 */
import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function bundle() {
  try {
    await esbuild.build({
      entryPoints: [path.join(projectRoot, 'src/cli/cli.ts')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: path.join(projectRoot, 'out/cli.js'),
      format: 'cjs',
      sourcemap: true,
      external: [],
      minify: false,
      keepNames: true,
      banner: {
        js: '#!/usr/bin/env node',
      },
    });
    console.log('CLI bundled successfully');
  } catch (error) {
    console.error('Failed to bundle CLI:', error);
    process.exit(1);
  }
}

bundle();
```

**Step 4: Add bin entry to package.json**

Add to root `package.json`:

```json
"bin": {
  "lanes": "./out/cli.js"
}
```

**Step 5: Verify it compiles**

Run: `npm run bundle:cli`

Expected: "CLI bundled successfully" (will fail until cli.ts exists — that's fine, just verify the script itself runs)

**Step 6: Commit**

```bash
git add package.json package-lock.json scripts/bundle-cli.mjs
git commit -m "chore: add CLI build infrastructure and commander dependency"
```

---

### Task 2: Create CLI adapters

**Files:**
- Create: `src/cli/adapters/CliConfigProvider.ts`
- Create: `src/cli/adapters/CliStorageProvider.ts`
- Create: `src/cli/adapters/CliGitPathResolver.ts`
- Create: `src/cli/adapters/index.ts`

**Step 1: Create CliConfigProvider**

Create `src/cli/adapters/CliConfigProvider.ts`:

```typescript
/**
 * CLI implementation of IConfigProvider.
 * Reads configuration from .lanes/config.json in the repo root.
 */

import * as path from 'path';
import type { IConfigProvider } from '../../core/interfaces/IConfigProvider';
import type { IDisposable } from '../../core/interfaces/IDisposable';
import { readJson } from '../../core/services/FileService';

/** Default config values matching VS Code extension defaults */
const DEFAULTS: Record<string, Record<string, unknown>> = {
    lanes: {
        worktreesFolder: '.worktrees',
        defaultAgent: 'claude',
        baseBranch: '',
        includeUncommittedChanges: true,
        localSettingsPropagation: 'copy',
        customWorkflowsFolder: '.lanes/workflows',
        terminalMode: 'vscode',
        useGlobalStorage: false,  // CLI always uses local storage
        promptsFolder: '',
        permissionMode: 'acceptEdits',
    },
};

export class CliConfigProvider implements IConfigProvider {
    private config: Record<string, unknown> | null = null;
    private readonly repoRoot: string;

    constructor(repoRoot: string) {
        this.repoRoot = repoRoot;
    }

    /**
     * Load config from .lanes/config.json. Called once at startup.
     */
    async load(): Promise<void> {
        const configPath = path.join(this.repoRoot, '.lanes', 'config.json');
        this.config = await readJson<Record<string, unknown>>(configPath);
    }

    get<T>(section: string, key: string, defaultValue: T): T {
        // Try loaded config first
        if (this.config && key in this.config) {
            return this.config[key] as T;
        }
        // Fall back to defaults
        const sectionDefaults = DEFAULTS[section];
        if (sectionDefaults && key in sectionDefaults) {
            return sectionDefaults[key] as T;
        }
        return defaultValue;
    }

    onDidChange(_section: string, _callback: () => void): IDisposable {
        // CLI is single-run — config changes don't happen mid-execution
        return { dispose: () => {} };
    }
}
```

**Step 2: Create CliStorageProvider**

Create `src/cli/adapters/CliStorageProvider.ts`:

```typescript
/**
 * CLI implementation of IStorageProvider.
 * Uses .lanes/ directory in the repo for all storage.
 */

import * as path from 'path';
import type { IStorageProvider } from '../../core/interfaces';

export class CliStorageProvider implements IStorageProvider {
    private readonly repoRoot: string;
    private readonly state: Map<string, unknown> = new Map();

    constructor(repoRoot: string) {
        this.repoRoot = repoRoot;
    }

    getGlobalStoragePath(): string {
        // CLI uses repo-local storage instead of VS Code global storage
        return path.join(this.repoRoot, '.lanes');
    }

    getWorkspaceState<T>(key: string, defaultValue: T): T {
        if (this.state.has(key)) {
            return this.state.get(key) as T;
        }
        return defaultValue;
    }

    async setWorkspaceState<T>(key: string, value: T): Promise<void> {
        this.state.set(key, value);
    }
}
```

**Step 3: Create CliGitPathResolver**

Create `src/cli/adapters/CliGitPathResolver.ts`:

```typescript
/**
 * CLI implementation of IGitPathResolver.
 * Resolves git from $PATH using 'command -v'.
 */

import { execFile } from 'child_process';
import type { IGitPathResolver } from '../../core/interfaces';

export class CliGitPathResolver implements IGitPathResolver {
    async resolveGitPath(): Promise<string> {
        return new Promise((resolve) => {
            execFile('command', ['-v', 'git'], { shell: true, timeout: 5000 }, (error, stdout) => {
                if (error || !stdout.trim()) {
                    // Fall back to 'git' and let it fail later with a clear error
                    resolve('git');
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }
}
```

**Step 4: Create adapter index**

Create `src/cli/adapters/index.ts`:

```typescript
export { CliConfigProvider } from './CliConfigProvider';
export { CliStorageProvider } from './CliStorageProvider';
export { CliGitPathResolver } from './CliGitPathResolver';
```

**Step 5: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No errors related to CLI adapter files (may have errors about missing cli.ts — that's OK)

**Step 6: Commit**

```bash
git add src/cli/adapters/
git commit -m "feat(cli): add CLI adapter implementations for core interfaces"
```

---

### Task 3: Create CLI entry point and argument parser

**Files:**
- Create: `src/cli/cli.ts`
- Create: `src/cli/utils.ts`

**Step 1: Create utility helpers**

Create `src/cli/utils.ts`:

```typescript
/**
 * CLI utility functions shared across commands.
 */

import * as path from 'path';
import { execGit, initializeGitPath } from '../core/gitService';
import { fileExists } from '../core/services/FileService';
import * as SettingsService from '../core/services/SettingsService';
import { CliConfigProvider } from './adapters/CliConfigProvider';
import { CliGitPathResolver } from './adapters/CliGitPathResolver';
import { setConfigCallbacks, initializeGlobalStorageContext } from '../core/session/SessionDataService';

/**
 * Resolve the base repo root from the current working directory.
 * Handles being run from inside a worktree.
 */
export async function resolveRepoRoot(): Promise<string> {
    const cwd = process.cwd();

    // Check if we're in a git repo
    if (!await fileExists(path.join(cwd, '.git'))) {
        // Maybe we're deeper in the tree — try git rev-parse
        try {
            const toplevel = await execGit(['rev-parse', '--show-toplevel'], cwd);
            return toplevel.trim();
        } catch {
            throw new Error('Not a git repository. Run from inside a git repo or run "git init" first.');
        }
    }

    // Check if we're inside a worktree and resolve to base repo
    return SettingsService.getBaseRepoPath(cwd);
}

/**
 * Initialize the CLI environment: git path, config, session data service.
 * Returns the config provider and repo root for use by commands.
 */
export async function initCli(): Promise<{ config: CliConfigProvider; repoRoot: string }> {
    // Resolve git path
    const gitResolver = new CliGitPathResolver();
    const gitPath = await gitResolver.resolveGitPath();
    initializeGitPath(gitPath);

    // Resolve repo root
    const repoRoot = await resolveRepoRoot();

    // Load config
    const config = new CliConfigProvider(repoRoot);
    await config.load();

    // Wire up SessionDataService config callbacks
    setConfigCallbacks({
        getUseGlobalStorage: () => false,  // CLI always uses local storage
        getWorktreesFolder: () => config.get('lanes', 'worktreesFolder', '.worktrees'),
        getPromptsFolder: () => config.get('lanes', 'promptsFolder', ''),
    });

    // Initialize storage context (CLI uses repo-local paths)
    initializeGlobalStorageContext(
        path.join(repoRoot, '.lanes'),
        repoRoot,
        undefined  // Agent set per-command
    );

    return { config, repoRoot };
}

/**
 * Print an error message and exit with code 1.
 */
export function exitWithError(message: string): never {
    console.error(`Error: ${message}`);
    process.exit(1);
}
```

**Step 2: Create the main CLI entry point**

Create `src/cli/cli.ts`:

```typescript
#!/usr/bin/env node

/**
 * Lanes CLI — manage isolated AI coding sessions via Git worktrees.
 */

import { Command } from 'commander';
import { registerCreateCommand } from './commands/create';
import { registerOpenCommand } from './commands/open';
import { registerListCommand } from './commands/list';
import { registerDeleteCommand } from './commands/delete';
import { registerClearCommand } from './commands/clear';
import { registerStatusCommand } from './commands/status';
import { registerDiffCommand } from './commands/diff';
import { registerInsightsCommand } from './commands/insights';
import { registerHooksCommand } from './commands/hooks';
import { registerWorkflowCommand } from './commands/workflow';
import { registerRepairCommand } from './commands/repair';
import { registerConfigCommand } from './commands/config';

const program = new Command();

program
    .name('lanes')
    .description('Manage isolated AI coding sessions via Git worktrees')
    .version('0.0.0'); // Replaced at build time or read from package.json

registerCreateCommand(program);
registerOpenCommand(program);
registerListCommand(program);
registerDeleteCommand(program);
registerClearCommand(program);
registerStatusCommand(program);
registerDiffCommand(program);
registerInsightsCommand(program);
registerHooksCommand(program);
registerWorkflowCommand(program);
registerRepairCommand(program);
registerConfigCommand(program);

program.parse();
```

**Step 3: Verify compilation**

Run: `npx tsc --noEmit`

Expected: Errors about missing command files (expected — we create those next)

**Step 4: Commit**

```bash
git add src/cli/cli.ts src/cli/utils.ts
git commit -m "feat(cli): add CLI entry point and utility helpers"
```

---

### Task 4: Implement `lanes list` and `lanes status` commands

These are read-only commands that exercise the core layer without modifying anything. Good starting point.

**Files:**
- Create: `src/cli/commands/list.ts`
- Create: `src/cli/commands/status.ts`

**Step 1: Create list command**

Create `src/cli/commands/list.ts`:

```typescript
/**
 * `lanes list` — List active sessions with their status.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { execGit } from '../../core/gitService';
import {
    getAgentStatus,
    getSessionAgentName,
    getWorkflowStatus,
} from '../../core/session/SessionDataService';
import { getErrorMessage } from '../../core/utils';

export function registerListCommand(program: Command): void {
    program
        .command('list')
        .alias('ls')
        .description('List active sessions')
        .option('--json', 'Output as JSON')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreesDir = path.join(repoRoot, worktreesFolder);

                // Get worktree list from git
                let output: string;
                try {
                    output = await execGit(['worktree', 'list', '--porcelain'], repoRoot);
                } catch {
                    exitWithError('Failed to list worktrees. Is this a git repository?');
                }

                // Parse porcelain output
                const sessions: Array<{
                    name: string;
                    branch: string;
                    path: string;
                    status: string;
                    agent: string;
                    workflow?: string;
                }> = [];

                const blocks = output.split('\n\n').filter(Boolean);
                for (const block of blocks) {
                    const lines = block.split('\n');
                    const worktreeLine = lines.find(l => l.startsWith('worktree '));
                    const branchLine = lines.find(l => l.startsWith('branch '));

                    if (!worktreeLine || !branchLine) continue;

                    const worktreePath = worktreeLine.replace('worktree ', '').trim();

                    // Only show worktrees under the configured worktrees folder
                    if (!worktreePath.startsWith(worktreesDir)) continue;

                    const branch = branchLine.replace('branch refs/heads/', '').trim();
                    const name = path.basename(worktreePath);

                    // Get session status
                    const agentStatus = await getAgentStatus(worktreePath);
                    const agentName = await getSessionAgentName(worktreePath);
                    const workflowStatus = await getWorkflowStatus(worktreePath);

                    sessions.push({
                        name,
                        branch,
                        path: worktreePath,
                        status: agentStatus?.status || 'idle',
                        agent: agentName,
                        workflow: workflowStatus?.workflow,
                    });
                }

                if (options.json) {
                    console.log(JSON.stringify(sessions, null, 2));
                    return;
                }

                if (sessions.length === 0) {
                    console.log('No active sessions.');
                    return;
                }

                // Table output
                console.log(`${'NAME'.padEnd(25)} ${'STATUS'.padEnd(12)} ${'AGENT'.padEnd(10)} ${'BRANCH'.padEnd(30)} WORKFLOW`);
                console.log('-'.repeat(90));
                for (const s of sessions) {
                    console.log(
                        `${s.name.padEnd(25)} ${s.status.padEnd(12)} ${s.agent.padEnd(10)} ${s.branch.padEnd(30)} ${s.workflow || ''}`
                    );
                }
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
```

**Step 2: Create status command**

Create `src/cli/commands/status.ts`:

```typescript
/**
 * `lanes status [session-name]` — Show session status details.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import {
    getAgentStatus,
    getSessionAgentName,
    getSessionId,
    getWorkflowStatus,
} from '../../core/session/SessionDataService';
import { getErrorMessage } from '../../core/utils';
import { fileExists } from '../../core/services/FileService';

export function registerStatusCommand(program: Command): void {
    program
        .command('status [session-name]')
        .description('Show session status')
        .option('--json', 'Output as JSON')
        .action(async (sessionName: string | undefined, options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');

                if (!sessionName) {
                    // Show summary of all sessions — delegate to list
                    console.log('Tip: Use "lanes list" to see all sessions, or "lanes status <name>" for details.');
                    return;
                }

                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                const agentStatus = await getAgentStatus(worktreePath);
                const agentName = await getSessionAgentName(worktreePath);
                const sessionData = await getSessionId(worktreePath);
                const workflowStatus = await getWorkflowStatus(worktreePath);

                const result = {
                    name: sessionName,
                    agent: agentName,
                    status: agentStatus?.status || 'idle',
                    sessionId: sessionData?.sessionId || null,
                    timestamp: sessionData?.timestamp || null,
                    workflow: workflowStatus,
                };

                if (options.json) {
                    console.log(JSON.stringify(result, null, 2));
                    return;
                }

                console.log(`Session:   ${result.name}`);
                console.log(`Agent:     ${result.agent}`);
                console.log(`Status:    ${result.status}`);
                if (result.sessionId) {
                    console.log(`Session ID: ${result.sessionId}`);
                }
                if (result.timestamp) {
                    console.log(`Updated:   ${result.timestamp}`);
                }
                if (result.workflow) {
                    console.log(`Workflow:  ${result.workflow.workflow || 'active'}`);
                    if (result.workflow.step) {
                        console.log(`Step:      ${result.workflow.step}`);
                    }
                    if (result.workflow.summary) {
                        console.log(`Summary:   ${result.workflow.summary}`);
                    }
                }
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
```

**Step 3: Compile and verify**

Run: `npx tsc --noEmit`

Expected: Errors only about the remaining unimplemented command files (create, open, etc.)

**Step 4: Commit**

```bash
git add src/cli/commands/list.ts src/cli/commands/status.ts
git commit -m "feat(cli): add list and status commands"
```

---

### Task 5: Implement `lanes create` command

This is the most complex command. It creates a worktree, seeds session data, sets up the agent, and execs into it.

**Files:**
- Create: `src/cli/commands/create.ts`

**Step 1: Create the create command**

Create `src/cli/commands/create.ts`:

```typescript
/**
 * `lanes create` — Create a new session and exec into the agent.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { initCli, exitWithError } from '../utils';
import { execGit } from '../../core/gitService';
import { fileExists, ensureDir, writeJson } from '../../core/services/FileService';
import { validateSessionName } from '../../core/validation';
import { validateBranchName, sanitizeSessionName, getErrorMessage } from '../../core/utils';
import { getAgent, getDefaultAgent, validateAndGetAgent, getAvailableAgents } from '../../core/codeAgents';
import { propagateLocalSettings, LocalSettingsPropagationMode } from '../../core/localSettings';
import * as SettingsService from '../../core/services/SettingsService';
import * as BrokenWorktreeService from '../../core/services/BrokenWorktreeService';
import { getBranchesInWorktrees } from '../../core/session/SessionDataService';
import {
    getSessionFilePath,
    getWorktreesFolder,
    saveSessionWorkflow,
    initializeGlobalStorageContext,
} from '../../core/session/SessionDataService';
import { execIntoAgent } from './open';

export function registerCreateCommand(program: Command): void {
    program
        .command('create')
        .description('Create a new session and open it')
        .requiredOption('--name <name>', 'Session name (used as branch name)')
        .option('--branch <source>', 'Source branch to create from', '')
        .option('--agent <agent>', 'AI agent to use (claude, codex, cortex, gemini, opencode)')
        .option('--prompt <text>', 'Starting prompt for the agent')
        .option('--workflow <name>', 'Workflow template name')
        .option('--permission-mode <mode>', 'Permission mode for the agent', 'acceptEdits')
        .option('--tmux', 'Use tmux backend')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');

                // Resolve agent
                const agentName = options.agent || config.get('lanes', 'defaultAgent', 'claude');
                const { agent: codeAgent, warning } = await validateAndGetAgent(agentName);
                if (warning) {
                    exitWithError(warning);
                }
                if (!codeAgent) {
                    exitWithError(`Unknown agent '${agentName}'. Available: ${getAvailableAgents().join(', ')}`);
                }

                // Re-initialize storage context with the resolved agent
                initializeGlobalStorageContext(
                    path.join(repoRoot, '.lanes'),
                    repoRoot,
                    codeAgent
                );

                // Sanitize and validate name
                const sanitizedName = sanitizeSessionName(options.name);
                if (!sanitizedName) {
                    exitWithError('Session name contains no valid characters.');
                }

                const nameValidation = validateSessionName(sanitizedName);
                if (!nameValidation.valid) {
                    exitWithError(nameValidation.error || 'Invalid session name.');
                }

                const branchValidation = validateBranchName(sanitizedName);
                if (!branchValidation.valid) {
                    exitWithError(branchValidation.error || 'Invalid branch name.');
                }

                const worktreePath = path.join(repoRoot, worktreesFolder, sanitizedName);

                // Ensure worktrees directory exists
                await fsPromises.mkdir(path.join(repoRoot, worktreesFolder), { recursive: true });

                // Check if branch already exists
                const branchAlreadyExists = await BrokenWorktreeService.branchExists(repoRoot, sanitizedName);

                if (branchAlreadyExists) {
                    const branchesInUse = await getBranchesInWorktrees(repoRoot);
                    if (branchesInUse.has(sanitizedName)) {
                        exitWithError(
                            `Branch '${sanitizedName}' is already checked out in another worktree. ` +
                            `Git does not allow the same branch in multiple worktrees.`
                        );
                    }
                    // Use existing branch
                    console.log(`Using existing branch '${sanitizedName}'...`);
                    await execGit(['worktree', 'add', worktreePath, sanitizedName], repoRoot);
                } else {
                    // Create new branch
                    const sourceBranch = options.branch.trim();
                    if (sourceBranch) {
                        const sourceValidation = validateBranchName(sourceBranch);
                        if (!sourceValidation.valid) {
                            exitWithError(sourceValidation.error || 'Invalid source branch name.');
                        }

                        // Fetch from remote
                        let remote = 'origin';
                        let branchName = sourceBranch;
                        if (sourceBranch.includes('/')) {
                            const parts = sourceBranch.split('/');
                            remote = parts[0];
                            branchName = parts.slice(1).join('/');
                        }

                        try {
                            await execGit(['fetch', remote, branchName], repoRoot);
                        } catch {
                            console.warn(`Warning: Could not fetch '${sourceBranch}'. Using local data.`);
                        }

                        // Verify source exists
                        const sourceExists = await BrokenWorktreeService.branchExists(repoRoot, sourceBranch);
                        let remoteExists = false;
                        if (!sourceExists) {
                            try {
                                await execGit(['show-ref', '--verify', '--quiet', `refs/remotes/${sourceBranch}`], repoRoot);
                                remoteExists = true;
                            } catch { /* not found */ }
                        }

                        if (!sourceExists && !remoteExists) {
                            exitWithError(`Source branch '${sourceBranch}' does not exist.`);
                        }

                        console.log(`Creating session '${sanitizedName}' from '${sourceBranch}'...`);
                        await execGit(['worktree', 'add', worktreePath, '-b', sanitizedName, sourceBranch], repoRoot);
                    } else {
                        console.log(`Creating session '${sanitizedName}'...`);
                        await execGit(['worktree', 'add', worktreePath, '-b', sanitizedName], repoRoot);
                    }
                }

                // Propagate local settings
                try {
                    const propagationMode = config.get<LocalSettingsPropagationMode>('lanes', 'localSettingsPropagation', 'copy');
                    await propagateLocalSettings(repoRoot, worktreePath, propagationMode, codeAgent);
                } catch (err) {
                    console.warn(`Warning: Failed to propagate local settings: ${getErrorMessage(err)}`);
                }

                // Seed session file
                const sessionFilePath = getSessionFilePath(worktreePath);
                await ensureDir(path.dirname(sessionFilePath));
                await writeJson(sessionFilePath, {
                    agentName: codeAgent.name,
                    timestamp: new Date().toISOString(),
                });

                // Save workflow if specified
                if (options.workflow) {
                    await saveSessionWorkflow(worktreePath, options.workflow);
                }

                console.log(`Session '${sanitizedName}' created.`);

                // Exec into the agent
                await execIntoAgent({
                    sessionName: sanitizedName,
                    worktreePath,
                    repoRoot,
                    codeAgent,
                    config,
                    prompt: options.prompt,
                    permissionMode: options.permissionMode,
                    workflow: options.workflow,
                    useTmux: options.tmux || false,
                    isNewSession: true,
                });
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') throw err;
                exitWithError(getErrorMessage(err));
            }
        });
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit`

Expected: Error about missing `execIntoAgent` in `./open` (expected — created in next task)

**Step 3: Commit**

```bash
git add src/cli/commands/create.ts
git commit -m "feat(cli): add create command"
```

---

### Task 6: Implement `lanes open` command with exec-into-agent

This is the core command that replaces the CLI process with the agent. Used by both `open` and `create`.

**Files:**
- Create: `src/cli/commands/open.ts`

**Step 1: Create the open command**

Create `src/cli/commands/open.ts`:

```typescript
/**
 * `lanes open <session-name>` — Open/resume a session by exec-ing into the agent.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { execSync } from 'child_process';
import { initCli, exitWithError } from '../utils';
import { CliConfigProvider } from '../adapters/CliConfigProvider';
import { fileExists, ensureDir, writeJson } from '../../core/services/FileService';
import { getErrorMessage } from '../../core/utils';
import {
    getSessionId,
    getSessionAgentName,
    getSessionWorkflow,
    getSessionPermissionMode,
    getOrCreateTaskListId,
    saveSessionPermissionMode,
    initializeGlobalStorageContext,
} from '../../core/session/SessionDataService';
import { getAgent, validateAndGetAgent } from '../../core/codeAgents';
import { CodeAgent, McpConfig } from '../../core/codeAgents/CodeAgent';
import * as SettingsService from '../../core/services/SettingsService';
import * as TmuxService from '../../core/services/TmuxService';

/**
 * Shared function used by both `lanes open` and `lanes create` to exec into an agent.
 */
export async function execIntoAgent(opts: {
    sessionName: string;
    worktreePath: string;
    repoRoot: string;
    codeAgent: CodeAgent;
    config: CliConfigProvider;
    prompt?: string;
    permissionMode?: string;
    workflow?: string | null;
    useTmux: boolean;
    isNewSession: boolean;
}): Promise<void> {
    const {
        sessionName, worktreePath, repoRoot, codeAgent, config,
        prompt, permissionMode, workflow, useTmux, isNewSession,
    } = opts;

    // Determine effective workflow
    let effectiveWorkflow = workflow;
    if (!effectiveWorkflow) {
        const savedWorkflow = await getSessionWorkflow(worktreePath);
        if (savedWorkflow) effectiveWorkflow = savedWorkflow;
    }

    // Determine effective permission mode
    let effectivePermissionMode = permissionMode;
    if (!effectivePermissionMode) {
        const savedMode = await getSessionPermissionMode(worktreePath);
        if (savedMode) effectivePermissionMode = savedMode;
    }
    effectivePermissionMode = effectivePermissionMode || 'acceptEdits';

    // Get or create task list ID
    const taskListId = await getOrCreateTaskListId(worktreePath, sessionName);

    // Set up settings file and hooks
    let settingsPath: string | undefined;
    let mcpConfigPath: string | undefined;
    let mcpConfigOverrides: string[] | undefined;

    try {
        let mcpConfigForSettings: McpConfig | undefined;
        let mcpConfig: McpConfig | null = null;

        if (effectiveWorkflow && codeAgent.supportsMcp()) {
            mcpConfig = codeAgent.getMcpConfig(worktreePath, effectiveWorkflow, repoRoot);
            const delivery = codeAgent.getMcpConfigDelivery();
            if (mcpConfig && delivery === 'settings') {
                mcpConfigForSettings = mcpConfig;
            }
        }

        settingsPath = await SettingsService.getOrCreateExtensionSettingsFile(
            worktreePath, effectiveWorkflow ?? undefined, codeAgent, mcpConfigForSettings
        );

        // Set up MCP config for CLI or override delivery
        if (effectiveWorkflow && mcpConfig) {
            const delivery = codeAgent.getMcpConfigDelivery();
            if (delivery === 'cli-overrides') {
                mcpConfigOverrides = codeAgent.buildMcpOverrides(mcpConfig);
            } else if (delivery === 'cli') {
                mcpConfigPath = path.join(path.dirname(settingsPath), 'mcp-config.json');
                await fsPromises.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
            }
        }
    } catch (err) {
        console.warn(`Warning: Failed to create settings file: ${getErrorMessage(err)}`);
    }

    // For agents that load settings from project paths, clear settingsPath
    if (codeAgent.getProjectSettingsPath(worktreePath)) {
        settingsPath = undefined;
    }

    // Build the command
    let command: string;

    const sessionData = await getSessionId(worktreePath, codeAgent);

    if (!isNewSession && sessionData?.sessionId) {
        // Resume existing session
        command = codeAgent.buildResumeCommand(sessionData.sessionId, {
            settingsPath,
            mcpConfigPath,
            mcpConfigOverrides,
        });
    } else {
        // Start fresh session
        await saveSessionPermissionMode(worktreePath, effectivePermissionMode);

        command = codeAgent.buildStartCommand({
            permissionMode: effectivePermissionMode,
            settingsPath,
            mcpConfigPath,
            mcpConfigOverrides,
            prompt: prompt || undefined,
        });
    }

    // Set up environment
    const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        CLAUDE_CODE_TASK_LIST_ID: taskListId,
    };

    if (useTmux) {
        // Tmux mode: create/attach to tmux session
        if (!await TmuxService.isTmuxInstalled()) {
            exitWithError('Tmux is not installed. Install tmux or omit --tmux.');
        }

        const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(sessionName);
        const tmuxSessionExists = await TmuxService.sessionExists(tmuxSessionName);

        if (tmuxSessionExists) {
            // Attach to existing session
            execSync(`tmux attach-session -t ${tmuxSessionName}`, {
                cwd: worktreePath,
                stdio: 'inherit',
                env,
            });
        } else {
            // Create new tmux session and send the agent command
            await TmuxService.createSession(tmuxSessionName, worktreePath);
            await TmuxService.sendCommand(tmuxSessionName, `export CLAUDE_CODE_TASK_LIST_ID='${taskListId}'`);
            await TmuxService.sendCommand(tmuxSessionName, command);

            // Attach to the session
            execSync(`tmux attach-session -t ${tmuxSessionName}`, {
                cwd: worktreePath,
                stdio: 'inherit',
                env,
            });
        }
    } else {
        // Default mode: exec into the agent process directly
        // Use execSync with stdio: 'inherit' so the agent takes over the terminal
        try {
            execSync(command, {
                cwd: worktreePath,
                stdio: 'inherit',
                env,
            });
        } catch {
            // Agent exited — this is normal (user quit the agent)
        }
    }
}

export function registerOpenCommand(program: Command): void {
    program
        .command('open <session-name>')
        .description('Open/resume a session')
        .option('--tmux', 'Use tmux backend')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                // Resolve agent from session metadata
                const agentName = await getSessionAgentName(worktreePath);
                const { agent: codeAgent, warning } = await validateAndGetAgent(agentName);
                if (warning) exitWithError(warning);
                if (!codeAgent) exitWithError(`Agent '${agentName}' not available.`);

                // Re-initialize storage context with session's agent
                initializeGlobalStorageContext(
                    path.join(repoRoot, '.lanes'),
                    repoRoot,
                    codeAgent
                );

                await execIntoAgent({
                    sessionName,
                    worktreePath,
                    repoRoot,
                    codeAgent,
                    config,
                    useTmux: options.tmux || false,
                    isNewSession: false,
                });
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') throw err;
                exitWithError(getErrorMessage(err));
            }
        });
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/cli/commands/open.ts
git commit -m "feat(cli): add open command with exec-into-agent"
```

---

### Task 7: Implement `lanes delete` and `lanes clear` commands

**Files:**
- Create: `src/cli/commands/delete.ts`
- Create: `src/cli/commands/clear.ts`

**Step 1: Create delete command**

Create `src/cli/commands/delete.ts`:

```typescript
/**
 * `lanes delete <session-name>` — Delete a session and its worktree.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { initCli, exitWithError } from '../utils';
import { execGit } from '../../core/gitService';
import { fileExists } from '../../core/services/FileService';
import * as TmuxService from '../../core/services/TmuxService';
import { getSessionTerminalMode, getSessionAgentName } from '../../core/session/SessionDataService';
import { getAgent } from '../../core/codeAgents';
import { getErrorMessage } from '../../core/utils';

export function registerDeleteCommand(program: Command): void {
    program
        .command('delete <session-name>')
        .alias('rm')
        .description('Delete a session and its worktree')
        .option('--force', 'Force deletion without confirmation')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                if (!options.force) {
                    console.log(`This will delete session '${sessionName}' and its worktree.`);
                    console.log(`Use --force to skip this message.`);
                    exitWithError('Deletion cancelled. Use --force to confirm.');
                }

                // Kill tmux session if applicable
                const terminalMode = await getSessionTerminalMode(worktreePath);
                if (terminalMode === 'tmux') {
                    const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(sessionName);
                    await TmuxService.killSession(tmuxSessionName).catch(() => {});
                }

                // Remove worktree
                await execGit(['worktree', 'remove', worktreePath, '--force'], repoRoot);

                // Clean up session management files
                const sessionMgmtDir = path.join(repoRoot, '.lanes', 'session_management', sessionName);
                await fsPromises.rm(sessionMgmtDir, { recursive: true, force: true }).catch(() => {});

                console.log(`Session '${sessionName}' deleted.`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') throw err;
                exitWithError(getErrorMessage(err));
            }
        });
}
```

**Step 2: Create clear command**

Create `src/cli/commands/clear.ts`:

```typescript
/**
 * `lanes clear <session-name>` — Clear a session and restart fresh.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { fileExists } from '../../core/services/FileService';
import {
    clearSessionId,
    getSessionAgentName,
    initializeGlobalStorageContext,
} from '../../core/session/SessionDataService';
import { getAgent, validateAndGetAgent } from '../../core/codeAgents';
import * as TmuxService from '../../core/services/TmuxService';
import { getSessionTerminalMode } from '../../core/session/SessionDataService';
import { getErrorMessage } from '../../core/utils';
import { execIntoAgent } from './open';

export function registerClearCommand(program: Command): void {
    program
        .command('clear <session-name>')
        .description('Clear a session and restart with fresh context')
        .option('--tmux', 'Use tmux backend')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                // Kill tmux session if applicable
                const terminalMode = await getSessionTerminalMode(worktreePath);
                if (terminalMode === 'tmux') {
                    const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(sessionName);
                    await TmuxService.killSession(tmuxSessionName).catch(() => {});
                }

                // Clear session ID
                await clearSessionId(worktreePath);

                // Resolve agent
                const agentName = await getSessionAgentName(worktreePath);
                const { agent: codeAgent, warning } = await validateAndGetAgent(agentName);
                if (warning) exitWithError(warning);
                if (!codeAgent) exitWithError(`Agent '${agentName}' not available.`);

                initializeGlobalStorageContext(
                    path.join(repoRoot, '.lanes'),
                    repoRoot,
                    codeAgent
                );

                console.log(`Session '${sessionName}' cleared. Starting fresh...`);

                // Exec into agent with fresh session
                await execIntoAgent({
                    sessionName,
                    worktreePath,
                    repoRoot,
                    codeAgent,
                    config,
                    useTmux: options.tmux || false,
                    isNewSession: true,
                });
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') throw err;
                exitWithError(getErrorMessage(err));
            }
        });
}
```

**Step 3: Commit**

```bash
git add src/cli/commands/delete.ts src/cli/commands/clear.ts
git commit -m "feat(cli): add delete and clear commands"
```

---

### Task 8: Implement `lanes diff`, `lanes insights`, and `lanes hooks` commands

**Files:**
- Create: `src/cli/commands/diff.ts`
- Create: `src/cli/commands/insights.ts`
- Create: `src/cli/commands/hooks.ts`

**Step 1: Create diff command**

Create `src/cli/commands/diff.ts`:

```typescript
/**
 * `lanes diff <session-name>` — Show git diff for a session.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { fileExists } from '../../core/services/FileService';
import * as DiffService from '../../core/services/DiffService';
import { getErrorMessage } from '../../core/utils';

export function registerDiffCommand(program: Command): void {
    program
        .command('diff <session-name>')
        .description('Show git diff for a session')
        .option('--base <branch>', 'Base branch to diff against')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                const baseBranch = options.base ||
                    await DiffService.getBaseBranch(
                        worktreePath,
                        config.get('lanes', 'baseBranch', '')
                    );

                const includeUncommitted = config.get('lanes', 'includeUncommittedChanges', true);

                const diffContent = await DiffService.generateDiffContent(
                    worktreePath,
                    baseBranch,
                    new Set(),
                    {
                        includeUncommitted,
                        onWarning: (msg) => console.warn(`Warning: ${msg}`),
                    }
                );

                if (!diffContent || diffContent.trim() === '') {
                    console.log(`No changes found when comparing to '${baseBranch}'.`);
                    return;
                }

                console.log(diffContent);
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
```

**Step 2: Create insights command**

Create `src/cli/commands/insights.ts`:

```typescript
/**
 * `lanes insights <session-name>` — Generate conversation insights.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { fileExists } from '../../core/services/FileService';
import { generateInsights, formatInsightsReport } from '../../core/services/InsightsService';
import { analyzeInsights } from '../../core/services/InsightsAnalyzer';
import { getSessionAgentName } from '../../core/session/SessionDataService';
import { getAgent } from '../../core/codeAgents';
import { getErrorMessage } from '../../core/utils';

export function registerInsightsCommand(program: Command): void {
    program
        .command('insights <session-name>')
        .description('Generate conversation insights for a session')
        .option('--json', 'Output as JSON')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                const agentName = await getSessionAgentName(worktreePath);
                const agent = getAgent(agentName);
                if (!agent?.supportsFeature('insights')) {
                    exitWithError(`Insights are not supported by ${agent?.displayName ?? agentName}.`);
                }

                const insights = await generateInsights(worktreePath);

                if (insights.sessionCount === 0) {
                    console.log(`No conversation data found for session '${sessionName}'.`);
                    return;
                }

                if (options.json) {
                    console.log(JSON.stringify(insights, null, 2));
                    return;
                }

                const analysis = analyzeInsights(insights);
                const report = formatInsightsReport(sessionName, insights, analysis);
                console.log(report);
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
```

**Step 3: Create hooks command**

Create `src/cli/commands/hooks.ts`:

```typescript
/**
 * `lanes hooks <session-name>` — Setup status hooks for a session.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { fileExists } from '../../core/services/FileService';
import { getSessionAgentName, initializeGlobalStorageContext } from '../../core/session/SessionDataService';
import { getAgent } from '../../core/codeAgents';
import * as SettingsService from '../../core/services/SettingsService';
import { getErrorMessage } from '../../core/utils';

export function registerHooksCommand(program: Command): void {
    program
        .command('hooks <session-name>')
        .description('Setup status hooks for a session')
        .action(async (sessionName: string) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                const agentName = await getSessionAgentName(worktreePath);
                const codeAgent = getAgent(agentName);

                if (codeAgent) {
                    initializeGlobalStorageContext(
                        path.join(repoRoot, '.lanes'),
                        repoRoot,
                        codeAgent
                    );
                }

                const settingsPath = await SettingsService.getOrCreateExtensionSettingsFile(
                    worktreePath, undefined, codeAgent ?? undefined
                );

                console.log(`Status hooks configured for '${sessionName}' at ${settingsPath}`);
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
```

**Step 4: Commit**

```bash
git add src/cli/commands/diff.ts src/cli/commands/insights.ts src/cli/commands/hooks.ts
git commit -m "feat(cli): add diff, insights, and hooks commands"
```

---

### Task 9: Implement `lanes workflow`, `lanes repair`, and `lanes config` commands

**Files:**
- Create: `src/cli/commands/workflow.ts`
- Create: `src/cli/commands/repair.ts`
- Create: `src/cli/commands/config.ts`

**Step 1: Create workflow command**

Create `src/cli/commands/workflow.ts`:

```typescript
/**
 * `lanes workflow` — Workflow template management.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { initCli, exitWithError } from '../utils';
import { discoverWorkflows, loadWorkflowTemplateFromString, WorkflowValidationError } from '../../core/workflow';
import { BLANK_WORKFLOW_TEMPLATE } from '../../core/services/WorkflowService';
import { getErrorMessage } from '../../core/utils';

export function registerWorkflowCommand(program: Command): void {
    const workflow = program
        .command('workflow')
        .description('Manage workflow templates');

    workflow
        .command('list')
        .description('List available workflow templates')
        .option('--json', 'Output as JSON')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();
                const customWorkflowsFolder = config.get('lanes', 'customWorkflowsFolder', '.lanes/workflows');

                // Extension path not available in CLI — pass empty string for built-in templates
                const templates = await discoverWorkflows({
                    extensionPath: '',
                    workspaceRoot: repoRoot,
                    customWorkflowsFolder,
                });

                if (options.json) {
                    console.log(JSON.stringify(templates, null, 2));
                    return;
                }

                if (templates.length === 0) {
                    console.log('No workflow templates found.');
                    console.log(`Create one in ${customWorkflowsFolder}/`);
                    return;
                }

                console.log(`${'NAME'.padEnd(25)} ${'SOURCE'.padEnd(12)} DESCRIPTION`);
                console.log('-'.repeat(70));
                for (const t of templates) {
                    const source = t.isBuiltIn ? 'built-in' : 'custom';
                    console.log(`${t.name.padEnd(25)} ${source.padEnd(12)} ${t.description || ''}`);
                }
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });

    workflow
        .command('create')
        .description('Create a new workflow template')
        .requiredOption('--name <name>', 'Workflow name')
        .option('--from <template>', 'Base template to copy from')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();
                const customWorkflowsFolder = config.get('lanes', 'customWorkflowsFolder', '.lanes/workflows');

                // Validate name
                if (!/^[a-zA-Z0-9_-]+$/.test(options.name)) {
                    exitWithError('Workflow name must contain only letters, numbers, hyphens, and underscores.');
                }

                const customPath = path.join(repoRoot, customWorkflowsFolder);
                await fsPromises.mkdir(customPath, { recursive: true });

                const targetPath = path.join(customPath, `${options.name}.yaml`);

                // Check if already exists
                try {
                    await fsPromises.access(targetPath);
                    exitWithError(`Workflow '${options.name}' already exists at ${targetPath}`);
                } catch { /* doesn't exist — good */ }

                let content: string;
                if (options.from) {
                    // Copy from existing template
                    const templates = await discoverWorkflows({
                        extensionPath: '',
                        workspaceRoot: repoRoot,
                        customWorkflowsFolder,
                    });
                    const source = templates.find(t => t.name === options.from);
                    if (!source) {
                        exitWithError(`Template '${options.from}' not found. Run 'lanes workflow list' to see available templates.`);
                    }
                    const sourceContent = await fsPromises.readFile(source.path, 'utf-8');
                    content = sourceContent.replace(/^name:\s*.+$/m, `name: ${options.name}`);
                } else {
                    content = BLANK_WORKFLOW_TEMPLATE.replace('name: my-workflow', `name: ${options.name}`);
                }

                await fsPromises.writeFile(targetPath, content, 'utf-8');
                console.log(`Created workflow template: ${targetPath}`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') throw err;
                exitWithError(getErrorMessage(err));
            }
        });

    workflow
        .command('validate <file>')
        .description('Validate a workflow YAML file')
        .action(async (file: string) => {
            try {
                const content = await fsPromises.readFile(file, 'utf-8');
                const template = loadWorkflowTemplateFromString(content);
                console.log(`Workflow "${template.name}" is valid.`);
            } catch (error) {
                if (error instanceof WorkflowValidationError) {
                    exitWithError(`Validation failed: ${error.message}`);
                } else {
                    exitWithError(`Invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        });
}
```

**Step 2: Create repair command**

Create `src/cli/commands/repair.ts`:

```typescript
/**
 * `lanes repair` — Repair broken worktrees.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import * as BrokenWorktreeService from '../../core/services/BrokenWorktreeService';
import { getErrorMessage } from '../../core/utils';

export function registerRepairCommand(program: Command): void {
    program
        .command('repair')
        .description('Detect and repair broken worktrees')
        .option('--dry-run', 'Only detect broken worktrees, do not repair')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');

                const broken = await BrokenWorktreeService.detectBrokenWorktrees(repoRoot, worktreesFolder);

                if (broken.length === 0) {
                    console.log('No broken worktrees found.');
                    return;
                }

                console.log(`Found ${broken.length} broken worktree(s):`);
                for (const wt of broken) {
                    console.log(`  - ${wt.sessionName} (branch: ${wt.expectedBranch})`);
                }

                if (options.dryRun) {
                    return;
                }

                console.log('\nRepairing...');
                const results = await BrokenWorktreeService.repairBrokenWorktrees(repoRoot, broken);

                let repaired = 0;
                let failed = 0;
                for (const result of results) {
                    if (result.success) {
                        console.log(`  Repaired: ${result.sessionName}`);
                        repaired++;
                    } else {
                        console.error(`  Failed: ${result.sessionName} — ${result.error}`);
                        failed++;
                    }
                }

                console.log(`\nDone: ${repaired} repaired, ${failed} failed.`);
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
```

**Step 3: Create config command**

Create `src/cli/commands/config.ts`:

```typescript
/**
 * `lanes config` — Get/set CLI configuration.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { initCli, exitWithError } from '../utils';
import { readJson, ensureDir } from '../../core/services/FileService';
import { getErrorMessage } from '../../core/utils';

const VALID_KEYS = [
    'worktreesFolder',
    'defaultAgent',
    'baseBranch',
    'includeUncommittedChanges',
    'localSettingsPropagation',
    'customWorkflowsFolder',
    'terminalMode',
    'permissionMode',
];

export function registerConfigCommand(program: Command): void {
    program
        .command('config')
        .description('Get or set configuration values')
        .option('--key <key>', 'Configuration key to get or set')
        .option('--value <value>', 'Value to set (omit to get current value)')
        .option('--list', 'List all configuration values')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();
                const configPath = path.join(repoRoot, '.lanes', 'config.json');

                if (options.list || (!options.key && !options.value)) {
                    // List all config
                    console.log('Configuration (.lanes/config.json):');
                    console.log('');
                    for (const key of VALID_KEYS) {
                        const value = config.get('lanes', key, '(default)');
                        console.log(`  ${key}: ${JSON.stringify(value)}`);
                    }
                    return;
                }

                if (!options.key) {
                    exitWithError('--key is required when setting a value.');
                }

                if (!VALID_KEYS.includes(options.key)) {
                    exitWithError(`Unknown key '${options.key}'. Valid keys: ${VALID_KEYS.join(', ')}`);
                }

                if (options.value === undefined) {
                    // Get single value
                    const value = config.get('lanes', options.key, null);
                    console.log(JSON.stringify(value));
                    return;
                }

                // Set value
                let existing = await readJson<Record<string, unknown>>(configPath) || {};
                let parsedValue: unknown = options.value;

                // Parse boolean and number values
                if (options.value === 'true') parsedValue = true;
                else if (options.value === 'false') parsedValue = false;
                else if (!isNaN(Number(options.value)) && options.value.trim() !== '') {
                    parsedValue = Number(options.value);
                }

                existing[options.key] = parsedValue;

                await ensureDir(path.dirname(configPath));
                await fsPromises.writeFile(configPath, JSON.stringify(existing, null, 2), 'utf-8');

                console.log(`Set ${options.key} = ${JSON.stringify(parsedValue)}`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') throw err;
                exitWithError(getErrorMessage(err));
            }
        });
}
```

**Step 4: Commit**

```bash
git add src/cli/commands/workflow.ts src/cli/commands/repair.ts src/cli/commands/config.ts
git commit -m "feat(cli): add workflow, repair, and config commands"
```

---

### Task 10: Fix compilation, fix imports, and verify full build

At this point all files exist. This task is about making sure everything compiles and builds.

**Files:**
- Modify: Various — fix any import issues found during compilation

**Step 1: Run TypeScript compiler**

Run: `npx tsc --noEmit`

Fix any errors. Common issues to expect:
- `getBranchesInWorktrees` is in `SessionService.ts` (VS Code layer), not `SessionDataService`. It needs to be moved to core or reimplemented in the create command using `execGit` directly.
- `SettingsService` imports from `../../gitService` (the VS Code wrapper) — the CLI needs to import from `../../core/gitService` instead. This may require adjusting SettingsService's import or creating a CLI-specific version.
- `DiffService` also imports from `../../gitService`.

For each issue: determine if it's a missing core export, a VS Code dependency leak, or a CLI-specific adapter gap. Fix at the appropriate layer.

**Step 2: Run full build**

Run: `npm run compile`

Expected: All three bundles succeed (extension, MCP server, CLI).

**Step 3: Make CLI executable**

Run: `chmod +x out/cli.js`

**Step 4: Smoke test**

Run: `node out/cli.js --help`

Expected: Help output showing all commands.

Run: `node out/cli.js list`

Expected: Either a list of sessions or "No active sessions."

**Step 5: Commit**

```bash
git add -A
git commit -m "fix(cli): resolve compilation issues and verify full build"
```

---

### Task 11: Add `--json` output to all read commands and verify end-to-end

**Files:**
- Modify: `src/cli/commands/list.ts` (already has --json)
- Modify: `src/cli/commands/status.ts` (already has --json)
- Modify: Other commands as needed

**Step 1: End-to-end test of each command**

Run through each command manually:

```bash
# List sessions
node out/cli.js list
node out/cli.js list --json

# Config
node out/cli.js config --list
node out/cli.js config --key worktreesFolder
node out/cli.js config --key defaultAgent --value claude

# Create a test session
node out/cli.js create --name test-cli-session

# After exiting the agent:
node out/cli.js status test-cli-session
node out/cli.js diff test-cli-session

# Open the session
node out/cli.js open test-cli-session

# Clear and reopen
node out/cli.js clear test-cli-session

# Delete
node out/cli.js delete test-cli-session --force

# Workflows
node out/cli.js workflow list
node out/cli.js workflow create --name test-wf
node out/cli.js workflow validate .lanes/workflows/test-wf.yaml

# Repair
node out/cli.js repair --dry-run
```

**Step 2: Fix any runtime issues discovered**

Address errors found during manual testing.

**Step 3: Commit**

```bash
git add -A
git commit -m "fix(cli): resolve runtime issues from end-to-end testing"
```

---

### Task 12: Add CLI tests

**Files:**
- Create: `src/test/cli/cli.test.ts` (or appropriate test location)

**Step 1: Write unit tests for CLI adapters**

Test `CliConfigProvider`:
- Returns defaults when no config file exists
- Reads values from config file when present
- Falls back to defaults for missing keys

Test `CliGitPathResolver`:
- Resolves git path from PATH

**Step 2: Write integration tests for command parsing**

Test that Commander correctly parses:
- `lanes create --name test --agent claude`
- `lanes list --json`
- `lanes delete test --force`
- Unknown commands show help

**Step 3: Run tests**

Run: `npm test`

Expected: All existing tests pass + new CLI tests pass.

**Step 4: Commit**

```bash
git add src/test/cli/
git commit -m "test(cli): add unit and integration tests for CLI"
```

---

### Task 13: Final cleanup and documentation

**Files:**
- Modify: `package.json` (verify bin entry, version)
- Modify: `AGENT.md` (add CLI section)

**Step 1: Update AGENT.md with CLI information**

Add a section to AGENT.md documenting:
- How to build the CLI: `npm run bundle:cli`
- How to run locally: `node out/cli.js <command>`
- Command reference (brief)

**Step 2: Verify .gitignore covers CLI output**

Ensure `out/cli.js` and `out/cli.js.map` are covered by existing gitignore patterns.

**Step 3: Final build and test**

Run: `npm run compile && npm test`

**Step 4: Commit**

```bash
git add AGENT.md package.json
git commit -m "docs: add CLI documentation to AGENT.md"
```
