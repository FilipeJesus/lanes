/**
 * Bundle the daemon server with all its dependencies.
 * Creates a standalone daemon.js that can run without node_modules.
 */
import * as esbuild from 'esbuild';
import * as path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));

async function bundle() {
  try {
    await esbuild.build({
      entryPoints: [path.join(projectRoot, 'src/daemon/server.ts')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: path.join(projectRoot, 'out/daemon.js'),
      format: 'cjs',
      sourcemap: true,
      external: [],
      minify: false,
      keepNames: true,
      define: {
        'CLI_VERSION': JSON.stringify(pkg.version),
      },
      banner: {
        js: '#!/usr/bin/env node',
      },
    });
    console.log('Daemon bundled successfully');
  } catch (error) {
    console.error('Failed to bundle daemon:', error);
    process.exit(1);
  }
}

bundle();
