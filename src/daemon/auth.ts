/**
 * Daemon Authentication - Token-based authentication for the HTTP daemon
 *
 * Generates and validates bearer tokens for securing the daemon HTTP endpoints.
 * Tokens are stored in `.lanes/daemon.token` in the workspace root.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';

const TOKEN_FILE_NAME = 'daemon.token';
const LANES_DIR = '.lanes';

/**
 * Generate a cryptographically secure random token.
 * Returns a 64-character lowercase hex string (32 bytes).
 */
export function generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Write the authentication token to `.lanes/daemon.token` in the workspace root.
 */
export async function writeTokenFile(workspaceRoot: string, token: string): Promise<void> {
    const lanesDir = path.join(workspaceRoot, LANES_DIR);
    await fs.mkdir(lanesDir, { recursive: true });
    const tokenPath = path.join(lanesDir, TOKEN_FILE_NAME);
    await fs.writeFile(tokenPath, token, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Read the authentication token from `.lanes/daemon.token` in the workspace root.
 * Throws if the file does not exist or cannot be read.
 */
export async function readTokenFile(workspaceRoot: string): Promise<string> {
    const tokenPath = path.join(workspaceRoot, LANES_DIR, TOKEN_FILE_NAME);
    const content = await fs.readFile(tokenPath, 'utf-8');
    return content.trim();
}

/**
 * Remove the token file from `.lanes/daemon.token`.
 * Does not throw if the file does not exist.
 */
export async function removeTokenFile(workspaceRoot: string): Promise<void> {
    const tokenPath = path.join(workspaceRoot, LANES_DIR, TOKEN_FILE_NAME);
    try {
        await fs.unlink(tokenPath);
    } catch (err) {
        // Ignore ENOENT (file already removed)
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
        }
    }
}

/**
 * Validate an Authorization header against the expected token.
 * Expects the header format: `Bearer <token>`.
 * Returns true if the header is valid and the token matches.
 */
export function validateAuthHeader(header: string | undefined, expectedToken: string): boolean {
    if (!header) {
        return false;
    }
    const parts = header.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        return false;
    }
    const providedToken = parts[1];
    // Hash both tokens to normalize lengths, then compare in constant time.
    // This prevents leaking information about the expected token length.
    const providedHash = crypto.createHash('sha256').update(providedToken).digest();
    const expectedHash = crypto.createHash('sha256').update(expectedToken).digest();
    return crypto.timingSafeEqual(providedHash, expectedHash);
}
