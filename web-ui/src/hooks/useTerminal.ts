/**
 * useTerminal — connects to the daemon's terminal SSE stream for a named terminal.
 *
 * Streams live terminal output via Server-Sent Events and exposes helpers for
 * sending input and resizing. Follows the same pattern as useDiff.ts.
 */

import { useState, useEffect, useCallback } from 'react';
import type { DaemonApiClient } from '../api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseTerminalResult {
    /** Current terminal content (may include ANSI escape codes). */
    content: string;
    /** Terminal rows reported by the daemon. */
    rows: number;
    /** Terminal columns reported by the daemon. */
    cols: number;
    /** True once the first SSE event has been received. */
    connected: boolean;
    /** Set when the SSE stream encounters an error. */
    error: Error | null;
    /** Send a line of text to the terminal (the backend appends Enter). */
    sendInput: (text: string) => Promise<void>;
    /** Resize the terminal to the given dimensions. */
    resize: (cols: number, rows: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTerminal(
    apiClient: DaemonApiClient | null,
    terminalName: string | undefined
): UseTerminalResult {
    const [content, setContent] = useState<string>('');
    const [rows, setRows] = useState<number>(0);
    const [cols, setCols] = useState<number>(0);
    const [connected, setConnected] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (!apiClient || !terminalName) {
            setContent('');
            setRows(0);
            setCols(0);
            setConnected(false);
            setError(null);
            return;
        }

        setError(null);
        setConnected(false);

        let cancelled = false;

        const handle = apiClient.streamTerminalOutput(
            terminalName,
            (data) => {
                if (cancelled) return;
                setContent(data.content);
                setRows(data.rows);
                setCols(data.cols);
                setConnected(true);
            },
            (err) => {
                if (cancelled) return;
                setError(err);
                setConnected(false);
            }
        );

        return () => {
            cancelled = true;
            handle.close();
        };
    }, [apiClient, terminalName]);

    const sendInput = useCallback(
        async (text: string): Promise<void> => {
            if (!apiClient || !terminalName) return;
            await apiClient.sendToTerminal(terminalName, { text });
        },
        [apiClient, terminalName]
    );

    const resize = useCallback(
        async (newCols: number, newRows: number): Promise<void> => {
            if (!apiClient || !terminalName) return;
            await apiClient.resizeTerminal(terminalName, { cols: newCols, rows: newRows });
        },
        [apiClient, terminalName]
    );

    return { content, rows, cols, connected, error, sendInput, resize };
}
