import * as esbuild from 'esbuild';
import * as path from 'path';
import { chmodSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')).version;
const targets = {
  extension: {
    entryPoints: [path.join(projectRoot, 'src/vscode/extension.ts')],
    outfile: path.join(projectRoot, 'out/extension.bundle.js'),
    external: ['vscode'],
  },
  mcp: {
    entryPoints: [path.join(projectRoot, 'src/mcp/server.ts')],
    outfile: path.join(projectRoot, 'out/mcp/server.js'),
  },
  cli: {
    entryPoints: [path.join(projectRoot, 'src/cli/cli.ts')],
    outfile: path.join(projectRoot, 'out/cli.js'),
    define: { CLI_VERSION: JSON.stringify(version) },
    banner: { js: '#!/usr/bin/env node' },
  },
};

const requestedTarget = process.argv[2];
const selectedTargets = requestedTarget ? [requestedTarget] : Object.keys(targets);

try {
  for (const name of selectedTargets) {
    const options = targets[name];
    if (!options) {
      throw new Error(`Unknown bundle target: ${name}`);
    }
    await esbuild.build({
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      sourcemap: true,
      minify: false,
      keepNames: true,
      external: [],
      ...options,
    });
    if (name === 'cli') {
      chmodSync(options.outfile, 0o755);
    }
    console.log(`${name} bundled successfully`);
  }
} catch (error) {
  console.error('Failed to bundle:', error);
  process.exit(1);
}
