import { defineConfig } from '@vscode/test-cli';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const runtimeDir = path.join(os.tmpdir(), 'vscode-test-runtime');
fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Use a shorter path for user data to avoid socket path length issues
	launchArgs: [
		`--user-data-dir=${path.join(os.tmpdir(), 'vscode-test-user-data')}`,
		// Required for restricted/containerized Linux runners where /dev/shm or
		// user namespaces are unavailable.
		'--disable-dev-shm-usage',
		'--no-sandbox',
		'--disable-crash-reporter',
		'--disable-gpu',
		'--ozone-platform=headless'
	],
	// Stabilize test-electron in restricted Linux/container environments.
	env: {
		...process.env,
		XDG_RUNTIME_DIR: runtimeDir,
		DBUS_SESSION_BUS_ADDRESS: 'disabled:',
		ELECTRON_DISABLE_GPU: '1'
	}
});
