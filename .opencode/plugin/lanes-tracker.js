// Lanes session tracker plugin for OpenCode
// This plugin captures session IDs and tracks status changes

import fs from 'fs';

const SESSION_FILE = "/home/node/.vscode-server/data/User/globalStorage/filipemarquesjesus.claude-lanes/claude-orchestra-c92b9a0e/feat-opencode-support/.claude-session";
const STATUS_FILE = "/home/node/.vscode-server/data/User/globalStorage/filipemarquesjesus.claude-lanes/claude-orchestra-c92b9a0e/feat-opencode-support/.claude-status";

// Write status to file
function writeStatus(status) {
    const data = {
        status: status,
        timestamp: new Date().toISOString()
    };
    fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
}

// Write session ID to file (merge with existing data)
function writeSessionId(sessionId) {
    let existingData = {};
    try {
        const content = fs.readFileSync(SESSION_FILE, 'utf8');
        existingData = JSON.parse(content);
    } catch (err) {
        // File doesn't exist or is invalid, start fresh
    }

    const data = {
        ...existingData,
        sessionId: sessionId,
        timestamp: new Date().toISOString()
    };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
}

// OpenCode plugin: named async export with context parameter
export const LanesTrackerPlugin = async ({ project, client, $, directory, worktree }) => {
    return {
        // Capture session ID when session is created
        'session.created': async (input) => {
            if (input && input.session && input.session.id) {
                writeSessionId(input.session.id);
            }
        },

        // Track status changes
        'session.status': async (input) => {
            if (input && input.status) {
                // Map OpenCode status to Lanes status
                let status = 'idle';
                if (input.status === 'thinking' || input.status === 'running') {
                    status = 'working';
                } else if (input.status === 'waiting' || input.status === 'prompt') {
                    status = 'waiting_for_user';
                } else if (input.status === 'error') {
                    status = 'error';
                }
                writeStatus(status);
            }
        },

        // Mark as idle when session is idle
        'session.idle': async (input) => {
            writeStatus('idle');
        }
    };
};
