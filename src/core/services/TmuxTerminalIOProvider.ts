/**
 * TmuxTerminalIOProvider
 *
 * Implements ITerminalIOProvider using TmuxService functions.
 * This is the default implementation for reading/writing terminal I/O
 * when the terminal mode is set to 'tmux'.
 */

import { ITerminalIOProvider, TerminalOutputData } from '../interfaces/ITerminalIOProvider';
import * as TmuxService from './TmuxService';

export class TmuxTerminalIOProvider implements ITerminalIOProvider {
    /**
     * Read the current output of a tmux session pane, including dimensions.
     *
     * @param terminalName The tmux session name
     * @returns Terminal content and dimensions
     */
    async readOutput(terminalName: string): Promise<TerminalOutputData> {
        const [content, size] = await Promise.all([
            TmuxService.capturePane(terminalName, { escapeSequences: true, start: '-' }),
            TmuxService.getPaneSize(terminalName),
        ]);
        return {
            content,
            rows: size.rows,
            cols: size.cols,
        };
    }

    /**
     * Send input text to a tmux session as raw keys (no Enter appended).
     *
     * @param terminalName The tmux session name
     * @param text The text to send as-is
     */
    async sendInput(terminalName: string, text: string): Promise<void> {
        await TmuxService.sendKeys(terminalName, text);
    }

    /**
     * Resize a tmux session window.
     *
     * @param terminalName The tmux session name
     * @param cols Number of columns
     * @param rows Number of rows
     */
    async resize(terminalName: string, cols: number, rows: number): Promise<void> {
        await TmuxService.resizePane(terminalName, cols, rows);
    }

    /**
     * Check whether a tmux session with the given name exists.
     *
     * @param terminalName The tmux session name
     * @returns True if the session exists, false otherwise
     */
    async isAvailable(terminalName: string): Promise<boolean> {
        return TmuxService.sessionExists(terminalName);
    }
}
