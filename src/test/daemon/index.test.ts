/**
 * Tests for src/daemon/index.ts barrel exports.
 *
 * Verifies that all public symbols are exported from the daemon barrel module.
 */

import * as assert from 'assert';
import * as daemonIndex from '../../daemon/index';

suite('daemon index', () => {
    test('Given an import from src/daemon/index, then DaemonConfigStore is exported', () => {
        assert.ok(
            typeof daemonIndex.DaemonConfigStore === 'function',
            'DaemonConfigStore should be exported as a class/constructor'
        );
    });

    test('Given an import from src/daemon/index, then generateToken is exported', () => {
        assert.ok(
            typeof daemonIndex.generateToken === 'function',
            'generateToken should be exported as a function'
        );
    });

    test('Given an import from src/daemon/index, then writeTokenFile is exported', () => {
        assert.ok(
            typeof daemonIndex.writeTokenFile === 'function',
            'writeTokenFile should be exported as a function'
        );
    });

    test('Given an import from src/daemon/index, then readTokenFile is exported', () => {
        assert.ok(
            typeof daemonIndex.readTokenFile === 'function',
            'readTokenFile should be exported as a function'
        );
    });

    test('Given an import from src/daemon/index, then removeTokenFile is exported', () => {
        assert.ok(
            typeof daemonIndex.removeTokenFile === 'function',
            'removeTokenFile should be exported as a function'
        );
    });

    test('Given an import from src/daemon/index, then validateAuthHeader is exported', () => {
        assert.ok(
            typeof daemonIndex.validateAuthHeader === 'function',
            'validateAuthHeader should be exported as a function'
        );
    });

    test('Given an import from src/daemon/index, then startDaemon is exported', () => {
        assert.ok(
            typeof daemonIndex.startDaemon === 'function',
            'startDaemon should be exported as a function'
        );
    });

    test('Given an import from src/daemon/index, then stopDaemon is exported', () => {
        assert.ok(
            typeof daemonIndex.stopDaemon === 'function',
            'stopDaemon should be exported as a function'
        );
    });

    test('Given an import from src/daemon/index, then isDaemonRunning is exported', () => {
        assert.ok(
            typeof daemonIndex.isDaemonRunning === 'function',
            'isDaemonRunning should be exported as a function'
        );
    });

    test('Given an import from src/daemon/index, then getDaemonPort is exported', () => {
        assert.ok(
            typeof daemonIndex.getDaemonPort === 'function',
            'getDaemonPort should be exported as a function'
        );
    });

    test('Given an import from src/daemon/index, then getDaemonPid is exported', () => {
        assert.ok(
            typeof daemonIndex.getDaemonPid === 'function',
            'getDaemonPid should be exported as a function'
        );
    });

    test('Given an import from src/daemon/index, then DaemonNotificationEmitter is exported', () => {
        assert.ok(
            typeof daemonIndex.DaemonNotificationEmitter === 'function',
            'DaemonNotificationEmitter should be exported as a class/constructor'
        );
    });

    test('Given an import from src/daemon/index, then DaemonFileWatchManager is exported', () => {
        assert.ok(
            typeof daemonIndex.DaemonFileWatchManager === 'function',
            'DaemonFileWatchManager should be exported as a class/constructor'
        );
    });
});
