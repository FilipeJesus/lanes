/**
 * Build the web UI using Vite.
 * Runs `npm run build` inside the web-ui/ directory.
 * Output goes to out/web-ui/ (configured in web-ui/vite.config.ts).
 */
import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const webUiDir = path.join(projectRoot, 'web-ui');

try {
    console.log('Building web UI...');
    execSync('npm run build', {
        cwd: webUiDir,
        stdio: 'inherit',
        env: { ...process.env },
    });
    console.log('Web UI built successfully');
} catch (error) {
    console.error('Failed to build web UI:', error);
    process.exit(1);
}
