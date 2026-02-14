#!/usr/bin/env node
/**
 * Assembles docs/docs.html from docs/docs-shell.html + docs/sections/*.html
 *
 * The shell file contains a <!-- SECTIONS --> placeholder.
 * Each section file in docs/sections/ is inserted in order at that marker.
 *
 * Usage: node scripts/build-docs.js
 */

const fs = require('fs');
const path = require('path');

const docsDir = path.resolve(__dirname, '..');
const shellPath = path.join(docsDir, 'docs-shell.html');
const sectionsDir = path.join(docsDir, 'sections');
const outputPath = path.join(docsDir, 'docs.html');

// Section order (matches sidebar)
const sectionOrder = [
    'create-session',
    'worktrees',
    'permission-modes',
    'git-review',
    'multi-agent',
    'file-attachments',
    'tmux-terminal',
    'local-settings',
    'workflows-intro',
    'workflow-structure',
    'creating-workflow',
    'lanes-mcp',
    'contributing',
];

// Read the shell
const shell = fs.readFileSync(shellPath, 'utf8');

// Read and concatenate sections
const sectionsHtml = sectionOrder.map(id => {
    const filePath = path.join(sectionsDir, `${id}.html`);
    if (!fs.existsSync(filePath)) {
        console.error(`Missing section file: ${filePath}`);
        process.exit(1);
    }
    return fs.readFileSync(filePath, 'utf8');
}).join('\n');

// Replace the placeholder
if (!shell.includes('<!-- SECTIONS -->')) {
    console.error('Shell file missing <!-- SECTIONS --> placeholder');
    process.exit(1);
}

const output = shell.replace('<!-- SECTIONS -->', sectionsHtml);
fs.writeFileSync(outputPath, output, 'utf8');

const lineCount = output.split('\n').length;
console.log(`Built docs.html (${lineCount} lines) from ${sectionOrder.length} sections`);
