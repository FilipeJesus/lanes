/**
 * Tests for daemon auth module.
 *
 * Covers:
 *  - generateToken() produces a 64-character hex string
 *  - Two calls to generateToken() produce different results
 *  - writeTokenFile / readTokenFile round-trip
 *  - removeTokenFile removes the file; subsequent reads throw
 *  - validateAuthHeader returns true for valid Bearer header, false otherwise
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    generateToken,
    writeTokenFile,
    readTokenFile,
    removeTokenFile,
    validateAuthHeader,
} from '../../daemon/auth';

suite('daemon auth', () => {
    let tempDir: string;
    let originalHome: string | undefined;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-daemon-auth-test-'));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });

    teardown(() => {
        if (originalHome !== undefined) {
            process.env.HOME = originalHome;
        } else {
            delete process.env.HOME;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // -------------------------------------------------------------------------
    // daemon-auth-generate-token
    // -------------------------------------------------------------------------

    test('Given a call to generateToken(), when the result is inspected, then it is a 64-character hex string', () => {
        const token = generateToken();

        assert.strictEqual(typeof token, 'string');
        assert.strictEqual(token.length, 64, `Token should be 64 characters, got ${token.length}`);
        assert.ok(/^[0-9a-f]{64}$/.test(token), `Token should be lowercase hex, got: ${token}`);
    });

    test('Given two calls to generateToken(), the results must be different', () => {
        const token1 = generateToken();
        const token2 = generateToken();

        assert.notStrictEqual(token1, token2, 'Two generated tokens should not be identical');
    });

    // -------------------------------------------------------------------------
    // daemon-auth-write-read-remove-token
    // -------------------------------------------------------------------------

    test('Given a global token file, when writeTokenFile is called, then readTokenFile returns the same token', async () => {
        // Arrange
        const token = generateToken();

        // Act
        await writeTokenFile(tempDir, token);
        const readBack = await readTokenFile(tempDir);

        // Assert
        assert.strictEqual(readBack, token);
    });

    test('Given writeTokenFile is called, then the token file exists at ~/.lanes/daemon.token', async () => {
        // Arrange
        const token = generateToken();
        const expectedPath = path.join(tempDir, '.lanes', 'daemon.token');

        // Act
        await writeTokenFile(tempDir, token);

        // Assert
        assert.ok(fs.existsSync(expectedPath), '.lanes/daemon.token should exist after writeTokenFile');
    });

    test('Given a written global token file, when removeTokenFile is called, then the file no longer exists', async () => {
        // Arrange
        const token = generateToken();
        await writeTokenFile(tempDir, token);
        const tokenPath = path.join(tempDir, '.lanes', 'daemon.token');
        assert.ok(fs.existsSync(tokenPath), 'Precondition: token file should exist before removal');

        // Act
        await removeTokenFile(tempDir);

        // Assert
        assert.ok(!fs.existsSync(tokenPath), 'Token file should not exist after removeTokenFile');
    });

    test('Given no token file exists, when removeTokenFile is called, then it does not throw', async () => {
        // Act & Assert: should not throw even though the file is absent
        await removeTokenFile(tempDir);
    });

    test('Given a removed token file, when readTokenFile is called, then it throws', async () => {
        // Arrange: write then remove
        const token = generateToken();
        await writeTokenFile(tempDir, token);
        await removeTokenFile(tempDir);

        // Act & Assert
        let thrown: unknown;
        try {
            await readTokenFile(tempDir);
        } catch (err) {
            thrown = err;
        }
        assert.ok(thrown instanceof Error, 'readTokenFile should throw after the token file is removed');
    });

    // -------------------------------------------------------------------------
    // daemon-auth-validate-header
    // -------------------------------------------------------------------------

    test('Given a matching "Bearer <token>" header, when validateAuthHeader is called, then it returns true', () => {
        const token = generateToken();
        const header = `Bearer ${token}`;

        const result = validateAuthHeader(header, token);

        assert.strictEqual(result, true);
    });

    test('Given a mismatched token, when validateAuthHeader is called, then it returns false', () => {
        const correctToken = generateToken();
        const wrongToken = generateToken();
        const header = `Bearer ${wrongToken}`;

        const result = validateAuthHeader(header, correctToken);

        assert.strictEqual(result, false);
    });

    test('Given undefined as the header, when validateAuthHeader is called, then it returns false', () => {
        const token = generateToken();

        const result = validateAuthHeader(undefined, token);

        assert.strictEqual(result, false);
    });

    test('Given an empty string as the header, when validateAuthHeader is called, then it returns false', () => {
        const token = generateToken();

        const result = validateAuthHeader('', token);

        assert.strictEqual(result, false);
    });

    test('Given a header without the "Bearer" prefix, when validateAuthHeader is called, then it returns false', () => {
        const token = generateToken();
        const header = `Token ${token}`;

        const result = validateAuthHeader(header, token);

        assert.strictEqual(result, false);
    });

    test('Given a header with "bearer" in lowercase, when validateAuthHeader is called, then it returns true', () => {
        const token = generateToken();
        const header = `bearer ${token}`;

        const result = validateAuthHeader(header, token);

        assert.strictEqual(result, true);
    });

    test('Given a header with only the token (no scheme), when validateAuthHeader is called, then it returns false', () => {
        const token = generateToken();

        const result = validateAuthHeader(token, token);

        assert.strictEqual(result, false);
    });
});
