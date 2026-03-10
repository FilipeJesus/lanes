/**
 * Platform-agnostic terminal I/O provider interface.
 * Abstracts reading output from and writing input to a running terminal session.
 */

export interface TerminalOutputData {
    /** Terminal content (may include ANSI escape codes). */
    content: string;
    /** Number of terminal rows. */
    rows: number;
    /** Number of terminal columns. */
    cols: number;
}

export interface ITerminalIOProvider {
    /** Read current terminal output. */
    readOutput(terminalName: string): Promise<TerminalOutputData>;
    /** Send input text to the terminal. */
    sendInput(terminalName: string, text: string): Promise<void>;
    /** Resize the terminal. */
    resize(terminalName: string, cols: number, rows: number): Promise<void>;
    /** Check if the terminal exists and is available. */
    isAvailable(terminalName: string): Promise<boolean>;
}
