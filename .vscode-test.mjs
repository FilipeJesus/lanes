import { defineConfig } from '@vscode/test-cli';
import * as os from 'os';
import * as path from 'path';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Use a shorter path for user data to avoid socket path length issues
	launchArgs: [
		`--user-data-dir=${path.join(os.tmpdir(), 'vscode-test-user-data')}`
	]
});
