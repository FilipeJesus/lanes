/**
 * TerminalView — displays live terminal output and provides a text input
 * for sending commands to the running agent session.
 *
 * Terminal content is streamed via SSE from the daemon. ANSI escape codes
 * are stripped for clean plain-text display in a <pre> element.
 */

import { useState, useEffect, useRef, useCallback, useMemo, KeyboardEvent } from 'react';
import type { DaemonApiClient } from '../api/client';
import { useTerminal } from '../hooks/useTerminal';
import styles from '../styles/TerminalView.module.css';

// ---------------------------------------------------------------------------
// ANSI stripping
// ---------------------------------------------------------------------------

/**
 * Removes ANSI escape sequences from a string so the content can be safely
 * rendered as plain text. Covers the most common forms:
 *   - CSI sequences: ESC [ ... (letter)
 *   - OSC sequences: ESC ] ... ST or BEL
 *   - Single-char escape sequences: ESC (letter)
 *   - Raw ESC char without a recognised follower
 */
function stripAnsi(text: string): string {
    return text
        // CSI sequences: ESC [ optional params final byte (0x40–0x7E)
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
        // OSC sequences: ESC ] ... ESC \ or ESC ] ... BEL
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        // Single-char escape sequences: ESC followed by a printable char
        .replace(/\x1b[A-Za-z]/g, '')
        // Any remaining lone ESC
        .replace(/\x1b/g, '');
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TerminalViewProps {
    apiClient: DaemonApiClient | null;
    terminalName: string | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TerminalView({ apiClient, terminalName }: TerminalViewProps) {
    const { content, connected, error, sendInput } = useTerminal(apiClient, terminalName);

    const [inputValue, setInputValue] = useState('');
    const [sending, setSending] = useState(false);
    const [timedOut, setTimedOut] = useState(false);

    const outputRef = useRef<HTMLDivElement>(null);

    // Show a helpful message if connection takes too long (no tmux session found)
    useEffect(() => {
        if (connected || error) {
            setTimedOut(false);
            return;
        }
        const timer = setTimeout(() => setTimedOut(true), 5000);
        return () => clearTimeout(timer);
    }, [connected, error, terminalName]);

    // Auto-scroll to the bottom only when the user is already near the bottom.
    // This prevents yanking the view away when the user is reading scrollback.
    useEffect(() => {
        const el = outputRef.current;
        if (el) {
            const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            if (isNearBottom) {
                el.scrollTop = el.scrollHeight;
            }
        }
    }, [content]);

    const handleSend = useCallback(async () => {
        const text = inputValue.trim();
        if (!text || sending || !connected) return;

        setSending(true);
        try {
            await sendInput(text);
            setInputValue('');
        } catch (err) {
            console.error('Failed to send terminal input:', err);
        } finally {
            setSending(false);
        }
    }, [inputValue, sending, connected, sendInput]);

    const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                void handleSend();
            }
        },
        [handleSend]
    );

    // Compute status indicator state
    let statusLabel: string;
    let dotClass: string;
    if (error) {
        statusLabel = 'Error';
        dotClass = styles.statusDotError;
    } else if (connected) {
        statusLabel = 'Connected';
        dotClass = styles.statusDotConnected;
    } else {
        statusLabel = 'Connecting…';
        dotClass = styles.statusDotConnecting;
    }

    const displayContent = useMemo(() => stripAnsi(content), [content]);
    const canSend = connected && !sending && !!apiClient && !!terminalName;

    return (
        <div className={styles.root}>
            {/* Toolbar */}
            <div className={styles.toolbar}>
                <span className={styles.toolbarTitle}>
                    {terminalName ?? 'Terminal'}
                </span>
                <span className={styles.connectionStatus} aria-live="polite">
                    <span className={`${styles.statusDot} ${dotClass}`} aria-hidden="true" />
                    {statusLabel}
                </span>
            </div>

            {/* Error banner */}
            {error && (
                <div className={styles.errorBanner} role="alert">
                    <span className={styles.errorTitle}>Stream error</span>
                    <span className={styles.errorMessage}>{error.message}</span>
                </div>
            )}

            {/* Output */}
            <div
                ref={outputRef}
                className={styles.output}
                aria-label="Terminal output"
                aria-live="off"
            >
                {!connected && !error ? (
                    <div className={styles.connecting} role="status" aria-label="Connecting to terminal">
                        {timedOut ? (
                            <>
                                <span className={styles.connectingTitle}>No terminal session found</span>
                                <span className={styles.connectingHint}>
                                    No tmux session found for this terminal.
                                    Make sure the session was created with terminal mode
                                    set to &ldquo;tmux&rdquo;.
                                </span>
                            </>
                        ) : (
                            <>
                                <div className={styles.spinner} aria-hidden="true" />
                                <span>Connecting to terminal&hellip;</span>
                            </>
                        )}
                    </div>
                ) : (
                    <pre className={styles.pre}>{displayContent}</pre>
                )}
            </div>

            {/* Input row */}
            <div className={styles.inputRow}>
                <span className={styles.inputPrompt} aria-hidden="true">&gt;</span>
                <input
                    type="text"
                    className={styles.input}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={canSend ? 'Send a message… (Enter to send)' : 'Waiting for connection…'}
                    disabled={!canSend}
                    aria-label="Terminal input"
                    autoComplete="off"
                    spellCheck={false}
                />
                <button
                    type="button"
                    className={styles.sendButton}
                    onClick={() => void handleSend()}
                    disabled={!canSend || !inputValue.trim()}
                    aria-label="Send input"
                >
                    Send
                </button>
            </div>
        </div>
    );
}
