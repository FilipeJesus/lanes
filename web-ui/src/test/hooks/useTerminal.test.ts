import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTerminal } from '../../hooks/useTerminal';
import type { DaemonApiClient } from '../../api/client';
import type { TerminalOutputData } from '../../api/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a fake stream handle whose callbacks can be invoked in tests. */
function makeStreamHandle() {
    let storedOnData: ((data: TerminalOutputData) => void) | undefined;
    let storedOnError: ((err: Error) => void) | undefined;
    const closeFn = vi.fn();

    const streamTerminalOutput = vi.fn(
        (
            _name: string,
            onData: (data: TerminalOutputData) => void,
            onError?: (err: Error) => void
        ) => {
            storedOnData = onData;
            storedOnError = onError;
            return { close: closeFn };
        }
    );

    return {
        streamTerminalOutput,
        closeFn,
        emitData: (data: TerminalOutputData) => storedOnData?.(data),
        emitError: (err: Error) => storedOnError?.(err),
    };
}

function makeApiClient(overrides: Partial<DaemonApiClient> = {}): DaemonApiClient {
    return {
        streamTerminalOutput: vi.fn().mockReturnValue({ close: vi.fn() }),
        sendToTerminal: vi.fn().mockResolvedValue(undefined),
        resizeTerminal: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as DaemonApiClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTerminal hook', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    // Critical: no-client
    // -------------------------------------------------------------------------

    it('Given apiClient is null, when useTerminal is called, then content is empty string, rows and cols are 0, connected is false, error is null', () => {
        const { result } = renderHook(() => useTerminal(null, 'my-terminal'));

        expect(result.current.content).toBe('');
        expect(result.current.rows).toBe(0);
        expect(result.current.cols).toBe(0);
        expect(result.current.connected).toBe(false);
        expect(result.current.error).toBeNull();
    });

    // -------------------------------------------------------------------------
    // Critical: no-name
    // -------------------------------------------------------------------------

    it('Given terminalName is undefined, when useTerminal is called, then content is empty string, connected is false', () => {
        const apiClient = makeApiClient();

        const { result } = renderHook(() => useTerminal(apiClient, undefined));

        expect(result.current.content).toBe('');
        expect(result.current.connected).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Critical: stream-data
    // -------------------------------------------------------------------------

    it('Given apiClient and terminalName are provided, when streamTerminalOutput calls onData callback with TerminalOutputData, then content, rows, cols are updated and connected becomes true', async () => {
        const handle = makeStreamHandle();
        const apiClient = makeApiClient({ streamTerminalOutput: handle.streamTerminalOutput });

        const { result } = renderHook(() => useTerminal(apiClient, 'my-terminal'));

        // Stream should have been started
        expect(handle.streamTerminalOutput).toHaveBeenCalledWith(
            'my-terminal',
            expect.any(Function),
            expect.any(Function)
        );

        act(() => {
            handle.emitData({ content: 'Hello world', rows: 24, cols: 80 });
        });

        await waitFor(() => {
            expect(result.current.content).toBe('Hello world');
            expect(result.current.rows).toBe(24);
            expect(result.current.cols).toBe(80);
            expect(result.current.connected).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // High: stream-error
    // -------------------------------------------------------------------------

    it('Given apiClient and terminalName are provided, when streamTerminalOutput calls onError callback, then error state is set and connected is false', async () => {
        const handle = makeStreamHandle();
        const apiClient = makeApiClient({ streamTerminalOutput: handle.streamTerminalOutput });

        const { result } = renderHook(() => useTerminal(apiClient, 'my-terminal'));

        act(() => {
            handle.emitError(new Error('Stream disconnected'));
        });

        await waitFor(() => {
            expect(result.current.error).toBeInstanceOf(Error);
            expect(result.current.error?.message).toBe('Stream disconnected');
            expect(result.current.connected).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // High: send-input
    // -------------------------------------------------------------------------

    it('Given apiClient and terminalName are provided, when sendInput is called with text, then apiClient.sendToTerminal is called with the terminal name and the text', async () => {
        const apiClient = makeApiClient();

        const { result } = renderHook(() => useTerminal(apiClient, 'my-terminal'));

        await act(async () => {
            await result.current.sendInput('ls -la');
        });

        expect(apiClient.sendToTerminal).toHaveBeenCalledWith('my-terminal', { text: 'ls -la' });
    });

    // -------------------------------------------------------------------------
    // Medium: resize
    // -------------------------------------------------------------------------

    it('Given apiClient and terminalName are provided, when resize is called with cols and rows, then apiClient.resizeTerminal is called with correct params', async () => {
        const apiClient = makeApiClient();

        const { result } = renderHook(() => useTerminal(apiClient, 'my-terminal'));

        await act(async () => {
            await result.current.resize(120, 40);
        });

        expect(apiClient.resizeTerminal).toHaveBeenCalledWith('my-terminal', { cols: 120, rows: 40 });
    });

    // -------------------------------------------------------------------------
    // High: cleanup
    // -------------------------------------------------------------------------

    it('Given the hook has started a stream, when the component unmounts, then the close() method on the stream handle is called', () => {
        const handle = makeStreamHandle();
        const apiClient = makeApiClient({ streamTerminalOutput: handle.streamTerminalOutput });

        const { unmount } = renderHook(() => useTerminal(apiClient, 'my-terminal'));

        expect(handle.streamTerminalOutput).toHaveBeenCalled();
        expect(handle.closeFn).not.toHaveBeenCalled();

        unmount();

        expect(handle.closeFn).toHaveBeenCalledOnce();
    });
});
