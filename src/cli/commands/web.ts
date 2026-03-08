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

            // Attempt to locate the web-ui build output relative to this CLI bundle.
            // Both the CLI bundle and web-ui are built to out/:
            //   CLI    -> out/cli.js
            //   Web UI -> out/web-ui/  (index.html, assets/)
            let staticDir: string | undefined;
            if (options.ui !== false) {
                const candidateStaticDir = path.resolve(__dirname, 'web-ui');
                // We'll pass it to the gateway; it handles missing directories gracefully
                // by falling back to API-only mode.
                staticDir = candidateStaticDir;
            }

            try {
                await runGatewayServer({ port, staticDir });
            } catch (err) {
                console.error(`Error: ${getErrorMessage(err)}`);
                process.exit(1);
            }
        });
}
