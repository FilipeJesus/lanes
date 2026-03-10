import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
    bash: 'bash',
    cjs: 'javascript',
    conf: 'bash',
    css: 'css',
    go: 'go',
    htm: 'markup',
    html: 'markup',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'jsx',
    md: 'markdown',
    markdown: 'markdown',
    mjs: 'javascript',
    py: 'python',
    rs: 'rust',
    sh: 'bash',
    sql: 'sql',
    svg: 'markup',
    ts: 'typescript',
    tsx: 'tsx',
    xml: 'markup',
    yaml: 'yaml',
    yml: 'yaml',
};

const LANGUAGE_BY_FILENAME: Record<string, string> = {
    dockerfile: 'bash',
    makefile: 'bash',
};

function getPrismLanguage(filePath: string): string | null {
    const normalized = filePath.toLowerCase();
    const fileName = normalized.split('/').pop() ?? normalized;

    if (fileName in LANGUAGE_BY_FILENAME) {
        return LANGUAGE_BY_FILENAME[fileName];
    }

    const extension = fileName.includes('.') ? fileName.split('.').pop() : null;
    if (!extension) {
        return null;
    }

    return LANGUAGE_BY_EXTENSION[extension] ?? null;
}

export interface HighlightedDiffLine {
    language: string;
    html: string;
}

export function highlightDiffLine(content: string, filePath: string): HighlightedDiffLine | null {
    if (!content) {
        return null;
    }

    const language = getPrismLanguage(filePath);
    if (!language) {
        return null;
    }

    const grammar = Prism.languages[language];
    if (!grammar) {
        return null;
    }

    return {
        language,
        html: Prism.highlight(content, grammar, language),
    };
}
