import * as path from 'path';

/** Select a Node runtime that can be launched outside the current host. */
export function getNodeExecutable(): string {
    // Editor hosts can expose Node APIs without Electron version metadata.
    // Reusing their executable in an agent's MCP config would launch the editor.
    const executableName = path.win32.basename(process.execPath);
    const isStandaloneNode = !process.versions.electron && /^(node|nodejs)(\.exe)?$/i.test(executableName);
    return isStandaloneNode ? process.execPath : 'node';
}
