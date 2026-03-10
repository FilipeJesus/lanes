/**
 * `lanes web` — Start the Lanes gateway server and optionally serve the web UI.
 *
 * The gateway server:
 * - Reads ~/.lanes/daemons.json to discover running daemon instances
 * - Exposes GET /api/gateway/daemons for the web UI to fetch project list
 * - Optionally serves the web UI static files (production build)
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getErrorMessage } from '../../core/utils';
import { runGatewayServer, DEFAULT_GATEWAY_PORT } from '../../daemon/gateway';

export function registerWebCommand(program: Command): void {
    program
        .command('web')
        .description('Start the Lanes web UI and gateway server')
        .option(
            '--port <port>',
            `Port for the gateway server (default: ${DEFAULT_GATEWAY_PORT})`,
            String(DEFAULT_GATEWAY_PORT)
        )
        .option(
            '--no-ui',
            'Start gateway API only, without serving the web UI static files'
        )
        .action(async (options) => {
            const port = parseInt(options.port, 10);

            if (isNaN(port) || port < 1 || port > 65535) {
                console.error(`Error: Invalid port: ${options.port}. Must be a number between 1 and 65535.`);
                process.exit(1);
            }

            // Locate the web-ui build output. Check the current working directory
            // first (supports worktrees and local dev), then fall back to the
            // installed CLI bundle location.
            let staticDir: string | undefined;
            if (options.ui !== false) {
                const cwdCandidate = path.resolve(process.cwd(), 'out', 'web-ui');
                const bundleCandidate = path.resolve(__dirname, 'web-ui');

                let resolved: string | undefined;
                for (const candidate of [cwdCandidate, bundleCandidate]) {
                    try {
                        await fs.access(path.join(candidate, 'index.html'));
                        resolved = candidate;
                        break;
                    } catch {
                        // not found, try next
                    }
                }

                staticDir = resolved ?? bundleCandidate;
            }

            try {
                await runGatewayServer({ port, staticDir });
            } catch (err) {
                console.error(`Error: ${getErrorMessage(err)}`);
                process.exit(1);
            }
        });
}
