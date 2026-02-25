/**
 * Notification Emitter - Sends JSON-RPC 2.0 notifications to the client
 *
 * Notifications are one-way messages (no id field) sent from the server
 * to the client to inform about events like status changes or file modifications.
 */

interface JsonRpcNotification {
    jsonrpc: string;
    method: string;
    params: Record<string, unknown>;
}

/**
 * NotificationEmitter sends notifications to the client via stdout.
 */
export class NotificationEmitter {
    /**
     * Send a notification to the client.
     * Notifications do NOT have an id field (one-way messages).
     */
    sendNotification(method: string, params: Record<string, unknown>): void {
        const notification: JsonRpcNotification = {
            jsonrpc: '2.0',
            method,
            params
        };
        process.stdout.write(JSON.stringify(notification) + '\n');
    }

    /**
     * Emit notification.sessionStatusChanged
     */
    sessionStatusChanged(sessionName: string, status: { status: string; timestamp?: string; message?: string }): void {
        this.sendNotification('notification.sessionStatusChanged', {
            sessionName,
            status
        });
    }

    /**
     * Emit notification.fileChanged
     */
    fileChanged(path: string, eventType: 'created' | 'changed' | 'deleted'): void {
        this.sendNotification('notification.fileChanged', {
            path,
            eventType
        });
    }

    /**
     * Emit notification.sessionCreated
     */
    sessionCreated(sessionName: string, worktreePath: string): void {
        this.sendNotification('notification.sessionCreated', {
            sessionName,
            worktreePath
        });
    }

    /**
     * Emit notification.sessionDeleted
     */
    sessionDeleted(sessionName: string): void {
        this.sendNotification('notification.sessionDeleted', {
            sessionName
        });
    }
}
