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
