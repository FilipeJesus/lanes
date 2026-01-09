/**
 * Bundle the main extension with all its dependencies.
 * This creates a standalone extension.js that includes all npm dependencies.
 */
import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function bundle() {
  try {
    await esbuild.build({
      entryPoints: [path.join(projectRoot, 'src/extension.ts')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: path.join(projectRoot, 'out/extension.bundle.js'),
      format: 'cjs',
      sourcemap: true,
      // vscode module is provided by VS Code at runtime
      external: ['vscode'],
      // Don't minify for better debugging
      minify: false,
      // Keep names for better stack traces
      keepNames: true,
    });
    console.log('Extension bundled successfully');
  } catch (error) {
    console.error('Failed to bundle extension:', error);
    process.exit(1);
  }
}

bundle();
