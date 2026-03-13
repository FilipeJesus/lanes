/**
 * Daemon Authentication - Token-based authentication for the HTTP daemon
 *
 * Generates and validates bearer tokens for securing the daemon HTTP endpoints.
 * Tokens are stored in `~/.lanes/daemon.token` for the machine-wide daemon.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

const TOKEN_FILE_NAME = 'daemon.token';
const LANES_DIR = '.lanes';

function getHomeDir(): string {
    return process.env.HOME || os.homedir();
}

function getGlobalLanesDir(): string {
    return path.join(getHomeDir(), LANES_DIR);
}

export function getGlobalTokenPath(): string {
    return path.join(getGlobalLanesDir(), TOKEN_FILE_NAME);
}

/**
 * Generate a cryptographically secure random token.
 * Returns a 64-character lowercase hex string (32 bytes).
 */
export function generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Write the authentication token to `~/.lanes/daemon.token`.
 */
export async function writeTokenFile(token: string): Promise<void> {
    const lanesDir = getGlobalLanesDir();
    await fs.mkdir(lanesDir, { recursive: true });
    await fs.writeFile(getGlobalTokenPath(), token, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Read the authentication token from `~/.lanes/daemon.token`.
 * Throws if the file does not exist or cannot be read.
 */
export async function readTokenFile(): Promise<string> {
    const content = await fs.readFile(getGlobalTokenPath(), 'utf-8');
    return content.trim();
}

/**
 * Remove the token file from `~/.lanes/daemon.token`.
 * Does not throw if the file does not exist.
 */
export async function removeTokenFile(): Promise<void> {
    try {
        await fs.unlink(getGlobalTokenPath());
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
