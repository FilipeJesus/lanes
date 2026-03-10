import { describe, it, expect, vi } from 'vitest';
import { DaemonSseClient } from '../../api/sse';

function emitSessionCreated(client: DaemonSseClient): void {
    const anyClient = client as unknown as {
        processLine: (line: string) => void;
    };
    anyClient.processLine('event: session_created');
    anyClient.processLine('data: {"sessionName":"s1","worktreePath":"/tmp/s1"}');
    anyClient.processLine('');
}

describe('DaemonSseClient subscriptions', () => {
    it('Given two subscribers, when an event is dispatched, then both subscribers receive it', () => {
        const client = new DaemonSseClient({ baseUrl: 'http://127.0.0.1:3942', token: 'test' });
        const onCreatedA = vi.fn();
        const onCreatedB = vi.fn();

        client.subscribe({ onSessionCreated: onCreatedA });
        client.subscribe({ onSessionCreated: onCreatedB });

        emitSessionCreated(client);

        expect(onCreatedA).toHaveBeenCalledTimes(1);
        expect(onCreatedB).toHaveBeenCalledTimes(1);
    });

    it('Given a subscriber is unsubscribed, when an event is dispatched, then it no longer receives callbacks', () => {
        const client = new DaemonSseClient({ baseUrl: 'http://127.0.0.1:3942', token: 'test' });
        const onCreatedA = vi.fn();
        const onCreatedB = vi.fn();

        const unsubscribeA = client.subscribe({ onSessionCreated: onCreatedA });
        client.subscribe({ onSessionCreated: onCreatedB });

        emitSessionCreated(client);
        unsubscribeA();
        emitSessionCreated(client);

        expect(onCreatedA).toHaveBeenCalledTimes(1);
        expect(onCreatedB).toHaveBeenCalledTimes(2);
    });

    it('Given setCallbacks is called after subscribe(), when an event is dispatched, then prior subscribers are replaced', () => {
        const client = new DaemonSseClient({ baseUrl: 'http://127.0.0.1:3942', token: 'test' });
        const oldSubscriber = vi.fn();
        const replacement = vi.fn();

        client.subscribe({ onSessionCreated: oldSubscriber });
        client.setCallbacks({ onSessionCreated: replacement });

        emitSessionCreated(client);

        expect(oldSubscriber).not.toHaveBeenCalled();
        expect(replacement).toHaveBeenCalledTimes(1);
    });
});
