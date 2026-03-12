import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const result = spawnSync(npmCommand, ['run', 'test:vscode'], {
    stdio: 'inherit',
    env: {
        ...process.env,
        // Git hooks should reuse a locally installed VS Code instance instead
        // of triggering a cold download/bootstrap step mid-commit.
        LANES_VSCODE_TEST_USE_MACHINE: '1',
    },
});

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}

process.exit(result.status ?? 1);
