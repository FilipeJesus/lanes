/**
 * Build the web UI using Vite.
 * Runs `npm run build` inside the web-ui/ directory.
 * Output goes to out/web-ui/ (configured in web-ui/vite.config.ts).
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const webUiDir = path.join(projectRoot, 'web-ui');
const npmCacheDir = path.join(projectRoot, '.npm-cache');
const prismJsPackageJson = path.join(webUiDir, 'node_modules', 'prismjs', 'package.json');

function ensureWebUiDependenciesInstalled() {
    if (existsSync(prismJsPackageJson)) {
        return;
    }

    if (process.env.LANES_NO_INSTALL_IN_HOOKS === '1') {
        console.error('web-ui dependencies are missing. Run `npm --prefix web-ui install` before committing.');
        process.exit(1);
    }

    console.log('Installing missing web UI dependencies...');
    execSync('npm install --force', {
        cwd: webUiDir,
        stdio: 'inherit',
        env: { ...process.env, npm_config_cache: npmCacheDir },
    });
}

try {
    ensureWebUiDependenciesInstalled();
    console.log('Building web UI...');
    execSync('npm run build', {
        cwd: webUiDir,
        stdio: 'inherit',
        env: { ...process.env, npm_config_cache: npmCacheDir },
    });
    console.log('Web UI built successfully');
} catch (error) {
    console.error('Failed to build web UI:', error);
    process.exit(1);
}
