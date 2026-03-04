/**
 * DaemonNotificationEmitter - SSE-based push notifications for the HTTP daemon
 *
 * Maintains a set of active Server-Sent Events client connections and broadcasts
 * structured events to all of them. Implements INotificationEmitter so that
 * SessionHandlerService can use it without knowing about HTTP internals.
 */

import * as http from 'http';
import { INotificationEmitter } from '../core/interfaces/IHandlerContext';

/**
 * DaemonNotificationEmitter sends Server-Sent Events to all connected SSE clients.
 * Implements INotificationEmitter for use with SessionHandlerService.
 */
export class DaemonNotificationEmitter implements INotificationEmitter {
    private clients = new Set<http.ServerResponse>();

    /**
     * Register a new SSE client connection.
     * Automatically removes the client when the connection closes.
     */
    addClient(res: http.ServerResponse): void {
        this.clients.add(res);
        res.on('close', () => {
            this.removeClient(res);
        });
    }

    /**
     * Unregister an SSE client connection.
     */
    removeClient(res: http.ServerResponse): void {
        this.clients.delete(res);
    }

    /**
     * Return the number of currently connected SSE clients.
     */
    getClientCount(): number {
        return this.clients.size;
    }

    /**
     * Broadcast a Server-Sent Event to all connected clients.
     * Format: `event: <event>\ndata: <json>\n\n`
     */
    private broadcast(event: string, data: unknown): void {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const client of this.clients) {
            try {
                client.write(payload);
            } catch (err) {
                // If writing fails the client is probably gone — remove it
                this.removeClient(client);
            }
        }
    }

    // -------------------------------------------------------------------------
    // INotificationEmitter implementation
    // -------------------------------------------------------------------------

    sessionStatusChanged(
        sessionName: string,
        status: { status: string; timestamp?: string; message?: string }
    ): void {
        this.broadcast('sessionStatusChanged', { sessionName, status });
    }

    fileChanged(filePath: string, eventType: 'created' | 'changed' | 'deleted'): void {
        this.broadcast('fileChanged', { path: filePath, eventType });
    }

    sessionCreated(sessionName: string, worktreePath: string): void {
        this.broadcast('sessionCreated', { sessionName, worktreePath });
    }

    sessionDeleted(sessionName: string): void {
        this.broadcast('sessionDeleted', { sessionName });
    }
}
