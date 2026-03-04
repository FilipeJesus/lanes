/**
 * Tests for DaemonNotificationEmitter.
 *
 * Covers:
 *  - Broadcasting SSE events to connected clients
 *  - Client management (addClient, removeClient, getClientCount)
 *  - Auto-removal when a client's "close" event fires
 */

import * as assert from 'assert';
import * as http from 'http';
import sinon from 'sinon';
import { DaemonNotificationEmitter } from '../../daemon/notifications';

// ---------------------------------------------------------------------------
// Helper: create a minimal fake http.ServerResponse
// ---------------------------------------------------------------------------

function makeFakeResponse(): http.ServerResponse & {
    written: string[];
    closeHandler?: () => void;
} {
    const written: string[] = [];
    const listeners: Record<string, Array<() => void>> = {};

    const fake = {
        written,
        write: sinon.stub().callsFake((chunk: string) => {
            written.push(chunk);
            return true;
        }),
        on: sinon.stub().callsFake((event: string, handler: () => void) => {
            if (!listeners[event]) { listeners[event] = []; }
            listeners[event].push(handler);
            return fake;
        }),
        emit: sinon.stub().callsFake((event: string) => {
            (listeners[event] ?? []).forEach(h => h());
            return true;
        }),
        // Expose the close handler so tests can trigger it
        get closeHandler(): (() => void) | undefined {
            return (listeners['close'] ?? [])[0];
        },
    } as unknown as http.ServerResponse & { written: string[]; closeHandler?: () => void };

    return fake;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('DaemonNotificationEmitter', () => {
    let emitter: DaemonNotificationEmitter;

    setup(() => {
        emitter = new DaemonNotificationEmitter();
    });

    teardown(() => {
        sinon.restore();
    });

    // -------------------------------------------------------------------------
    // daemon-notifications-client-management
    // -------------------------------------------------------------------------

    test('Given no clients, when getClientCount() is called, then it returns 0', () => {
        assert.strictEqual(emitter.getClientCount(), 0);
    });

    test('Given addClient() is called once, when getClientCount() is called, then it returns 1', () => {
        const client = makeFakeResponse();

        emitter.addClient(client);

        assert.strictEqual(emitter.getClientCount(), 1);
    });

    test('Given two clients are added, when getClientCount() is called, then it returns 2', () => {
        emitter.addClient(makeFakeResponse());
        emitter.addClient(makeFakeResponse());

        assert.strictEqual(emitter.getClientCount(), 2);
    });

    test('Given a client that closes, when the close event fires, then getClientCount() decrements', () => {
        const client = makeFakeResponse();
        emitter.addClient(client);
        assert.strictEqual(emitter.getClientCount(), 1, 'Precondition: should have 1 client');

        // Trigger the "close" event on the fake response
        client.closeHandler?.();

        assert.strictEqual(emitter.getClientCount(), 0, 'Client count should decrement after close');
    });

    test('Given a client is added and manually removed, when getClientCount() is called, then it returns 0', () => {
        const client = makeFakeResponse();
        emitter.addClient(client);

        emitter.removeClient(client);

        assert.strictEqual(emitter.getClientCount(), 0);
    });

    // -------------------------------------------------------------------------
    // daemon-notifications-broadcast
    // -------------------------------------------------------------------------

    test('Given a connected client, when sessionStatusChanged is called, then the client receives an SSE event with event:sessionStatusChanged', () => {
        const client = makeFakeResponse();
        emitter.addClient(client);

        emitter.sessionStatusChanged('my-session', { status: 'working' });

        assert.ok(client.written.length > 0, 'Client should have received data');
        const payload = client.written[0];
        assert.ok(payload.includes('event: sessionStatusChanged'), `Payload should contain event name, got: ${payload}`);
        assert.ok(payload.includes('"sessionName":"my-session"'), `Payload should contain session name, got: ${payload}`);
    });

    test('Given a connected client, when fileChanged is called, then the client receives an SSE event with event:fileChanged', () => {
        const client = makeFakeResponse();
        emitter.addClient(client);

        emitter.fileChanged('/tmp/foo.ts', 'changed');

        assert.ok(client.written.length > 0, 'Client should have received data');
        const payload = client.written[0];
        assert.ok(payload.includes('event: fileChanged'), `Payload should contain event name, got: ${payload}`);
        assert.ok(payload.includes('fileChanged'), `Payload should reference the event type, got: ${payload}`);
    });

    test('Given a connected client, when sessionCreated is called, then the client receives an SSE event with event:sessionCreated', () => {
        const client = makeFakeResponse();
        emitter.addClient(client);

        emitter.sessionCreated('new-session', '/tmp/worktrees/new-session');

        assert.ok(client.written.length > 0, 'Client should have received data');
        const payload = client.written[0];
        assert.ok(payload.includes('event: sessionCreated'), `Payload should contain event name, got: ${payload}`);
        assert.ok(payload.includes('"sessionName":"new-session"'), `Payload should contain session name, got: ${payload}`);
    });

    test('Given a connected client, when sessionDeleted is called, then the client receives an SSE event with event:sessionDeleted', () => {
        const client = makeFakeResponse();
        emitter.addClient(client);

        emitter.sessionDeleted('dead-session');

        assert.ok(client.written.length > 0, 'Client should have received data');
        const payload = client.written[0];
        assert.ok(payload.includes('event: sessionDeleted'), `Payload should contain event name, got: ${payload}`);
        assert.ok(payload.includes('"sessionName":"dead-session"'), `Payload should contain session name, got: ${payload}`);
    });

    test('Given two connected clients, when sessionStatusChanged is called, then both clients receive the event', () => {
        const client1 = makeFakeResponse();
        const client2 = makeFakeResponse();
        emitter.addClient(client1);
        emitter.addClient(client2);

        emitter.sessionStatusChanged('session-a', { status: 'idle' });

        assert.ok(client1.written.length > 0, 'Client 1 should have received data');
        assert.ok(client2.written.length > 0, 'Client 2 should have received data');
    });

    test('Given no connected clients, when sessionStatusChanged is called, then it does not throw', () => {
        assert.doesNotThrow(() => {
            emitter.sessionStatusChanged('x', { status: 'idle' });
        });
    });

    test('Given an SSE payload, when inspected, then it ends with a double newline', () => {
        const client = makeFakeResponse();
        emitter.addClient(client);

        emitter.fileChanged('/some/file.txt', 'deleted');

        const payload = client.written[0];
        assert.ok(payload.endsWith('\n\n'), `SSE payload should end with double newline, got: ${JSON.stringify(payload)}`);
    });

    test('Given a client whose write() throws, when broadcasting, then the client is removed', () => {
        const badClient = makeFakeResponse();
        (badClient.write as sinon.SinonStub).throws(new Error('stream closed'));

        emitter.addClient(badClient);
        assert.strictEqual(emitter.getClientCount(), 1, 'Precondition: 1 client');

        // Broadcasting should catch the write error and remove the bad client
        emitter.sessionDeleted('gone');

        assert.strictEqual(emitter.getClientCount(), 0, 'Bad client should be removed after write failure');
    });
});
