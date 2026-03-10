import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TerminalView } from '../../components/TerminalView';
import type { DaemonApiClient } from '../../api/client';

// ---------------------------------------------------------------------------
// Mock useTerminal so we can control the hook's returned state
// ---------------------------------------------------------------------------

const mockUseTerminal = vi.fn();
vi.mock('../../hooks/useTerminal', () => ({
    useTerminal: (...args: unknown[]) => mockUseTerminal(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UseTerminalState {
    content: string;
    rows: number;
    cols: number;
    connected: boolean;
    error: Error | null;
    sendInput: (text: string) => Promise<void>;
    resize: (cols: number, rows: number) => Promise<void>;
}

function makeTerminalState(overrides: Partial<UseTerminalState> = {}): UseTerminalState {
    return {
        content: '',
        rows: 0,
        cols: 0,
        connected: false,
        error: null,
        sendInput: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function makeApiClient(): DaemonApiClient {
    return {
        streamTerminalOutput: vi.fn().mockReturnValue({ close: vi.fn() }),
        sendToTerminal: vi.fn().mockResolvedValue(undefined),
        resizeTerminal: vi.fn().mockResolvedValue(undefined),
    } as unknown as DaemonApiClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalView component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    // High: renders-connecting
    // -------------------------------------------------------------------------

    it('Given apiClient and terminalName are provided but no SSE event has arrived yet, when TerminalView renders, then it shows a connecting indicator', () => {
        mockUseTerminal.mockReturnValue(makeTerminalState({ connected: false, error: null }));

        const apiClient = makeApiClient();

        render(<TerminalView apiClient={apiClient} terminalName="my-terminal" />);

        // The connecting spinner/status should be present
        expect(screen.getByRole('status', { name: /connecting to terminal/i })).toBeInTheDocument();
        // Status label in toolbar should say "Connecting…"
        expect(screen.getByText('Connecting\u2026')).toBeInTheDocument();
    });

    // -------------------------------------------------------------------------
    // Critical: renders-content
    // -------------------------------------------------------------------------

    it('Given the useTerminal hook returns content, when TerminalView renders, then the content is displayed in a pre element', () => {
        mockUseTerminal.mockReturnValue(
            makeTerminalState({ connected: true, content: 'Hello, terminal!' })
        );

        const apiClient = makeApiClient();

        render(<TerminalView apiClient={apiClient} terminalName="my-terminal" />);

        const pre = screen.getByText('Hello, terminal!');
        expect(pre.tagName.toLowerCase()).toBe('pre');
    });

    // -------------------------------------------------------------------------
    // High: strips-ansi
    // -------------------------------------------------------------------------

    it('Given terminal content contains ANSI escape sequences like \\x1b[32m, when TerminalView renders, then those sequences are removed from the displayed text', () => {
        const rawContent = '\x1b[32mGreen text\x1b[0m and \x1b[1mbold\x1b[0m';
        mockUseTerminal.mockReturnValue(
            makeTerminalState({ connected: true, content: rawContent })
        );

        const apiClient = makeApiClient();

        render(<TerminalView apiClient={apiClient} terminalName="my-terminal" />);

        // The pre element should show stripped text only
        const pre = screen.getByText('Green text and bold');
        expect(pre.tagName.toLowerCase()).toBe('pre');
        expect(pre.textContent).not.toContain('\x1b');
    });

    // -------------------------------------------------------------------------
    // Critical: send-input
    // -------------------------------------------------------------------------

    it('Given a user types text in the input field and presses Enter, when the key event fires, then sendInput is called with the typed text and the input field is cleared', async () => {
        const sendInput = vi.fn().mockResolvedValue(undefined);
        mockUseTerminal.mockReturnValue(
            makeTerminalState({ connected: true, sendInput })
        );

        const apiClient = makeApiClient();

        render(<TerminalView apiClient={apiClient} terminalName="my-terminal" />);

        const input = screen.getByRole('textbox', { name: /terminal input/i });

        // Type into the input
        fireEvent.change(input, { target: { value: 'ls -la' } });
        expect(input).toHaveValue('ls -la');

        // Press Enter
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        // sendInput should be called with the typed text
        await waitFor(() => {
            expect(sendInput).toHaveBeenCalledWith('ls -la');
        });

        // Input should be cleared after send
        await waitFor(() => {
            expect(input).toHaveValue('');
        });
    });

    // -------------------------------------------------------------------------
    // High: error-state
    // -------------------------------------------------------------------------

    it('Given the useTerminal hook returns an error, when TerminalView renders, then an error message is displayed', () => {
        const error = new Error('Connection refused');
        mockUseTerminal.mockReturnValue(
            makeTerminalState({ connected: false, error })
        );

        const apiClient = makeApiClient();

        render(<TerminalView apiClient={apiClient} terminalName="my-terminal" />);

        // Error banner with role="alert" should be present
        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
        expect(alert).toHaveTextContent('Connection refused');

        // Status label should say "Error"
        expect(screen.getByText('Error')).toBeInTheDocument();
    });
});
