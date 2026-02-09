/**
 * Bundle the MCP server with all its dependencies.
 * This creates a standalone server.js that can run without node_modules.
 */
import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function bundle() {
  try {
    await esbuild.build({
      entryPoints: [path.join(projectRoot, 'src/mcp/server.ts')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: path.join(projectRoot, 'out/mcp/server.js'),
      format: 'cjs',
      sourcemap: true,
      // Don't externalize anything - bundle all dependencies
      external: [],
      // Minify for smaller bundle size
      minify: false,
      // Keep names for better stack traces
      keepNames: true,
    });
    console.log('MCP server bundled successfully');
  } catch (error) {
    console.error('Failed to bundle MCP server:', error);
    process.exit(1);
  }
}

bundle();
