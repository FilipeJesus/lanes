import * as assert from 'assert';
import * as sinon from 'sinon';
import * as FileService from '../../core/services/FileService';
import {
    parseConversationFile,
    generateInsights,
    formatInsightsReport,
    ConversationData,
    SessionInsights
} from '../../core/services/InsightsService';
import { AnalysisResult } from '../../core/services/InsightsAnalyzer';

suite('InsightsService', () => {
    let readFileStub: sinon.SinonStub;
    let readDirStub: sinon.SinonStub;

    setup(() => {
        readFileStub = sinon.stub(FileService, 'readFile');
        readDirStub = sinon.stub(FileService, 'readDir');
    });

    teardown(() => {
        sinon.restore();
    });

    suite('Tool Error Extraction', () => {
        test('should extract tool errors from tool_result entries with is_error: true', async () => {
            const conversationContent = [
                // User message with tool use
                JSON.stringify({
                    type: 'user',
                    timestamp: '2024-01-01T10:00:00Z',
                    message: {
                        content: 'Read the file'
                    }
                }),
                // Assistant response with tool use
                JSON.stringify({
                    type: 'assistant',
                    timestamp: '2024-01-01T10:00:01Z',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Read',
                                input: { file_path: '/nonexistent.txt' }
                            }
                        ],
                        usage: {
                            input_tokens: 100,
                            output_tokens: 50
                        }
                    }
                }),
                // User message with tool result containing error
                JSON.stringify({
                    type: 'user',
                    timestamp: '2024-01-01T10:00:02Z',
                    message: {
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: 'tool_001',
                                is_error: true,
                                content: 'File not found: /nonexistent.txt'
                            }
                        ]
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.strictEqual(result.toolErrors.length, 1);
            assert.strictEqual(result.toolErrors[0].tool, 'Read');
            assert.strictEqual(result.toolErrors[0].error, 'File not found: /nonexistent.txt');
        });

        test('should handle tool errors with array content', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            { type: 'tool_use', id: 'tool_002', name: 'Edit', input: {} }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                }),
                JSON.stringify({
                    type: 'user',
                    message: {
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: 'tool_002',
                                is_error: true,
                                content: [
                                    { type: 'text', text: 'Invalid edit operation' }
                                ]
                            }
                        ]
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.strictEqual(result.toolErrors.length, 1);
            assert.strictEqual(result.toolErrors[0].tool, 'Edit');
            assert.strictEqual(result.toolErrors[0].error, 'Invalid edit operation');
        });
    });

    suite('Tool Sequence Extraction', () => {
        test('should capture tool sequence in order of execution', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            { type: 'tool_use', id: 'tool_001', name: 'Glob', input: {} }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                }),
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        content: [
                            { type: 'tool_use', id: 'tool_002', name: 'Read', input: {} }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                }),
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        content: [
                            { type: 'tool_use', id: 'tool_003', name: 'Edit', input: {} },
                            { type: 'tool_use', id: 'tool_004', name: 'Write', input: {} }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.deepStrictEqual(result.toolSequence, ['Glob', 'Read', 'Edit', 'Write']);
        });

        test('should include duplicate tool names in sequence', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            { type: 'tool_use', id: 'tool_001', name: 'Read', input: {} }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                }),
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        content: [
                            { type: 'tool_use', id: 'tool_002', name: 'Read', input: {} }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.deepStrictEqual(result.toolSequence, ['Read', 'Read']);
        });
    });

    suite('File Operations Extraction', () => {
        test('should extract Read operations with file paths', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Read',
                                input: { file_path: '/path/to/file.ts' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.strictEqual(result.fileOperations.length, 1);
            assert.strictEqual(result.fileOperations[0].file, '/path/to/file.ts');
            assert.strictEqual(result.fileOperations[0].operation, 'Read');
            assert.strictEqual(result.fileOperations[0].count, 1);
        });

        test('should extract Edit operations with file paths', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Edit',
                                input: { file_path: '/path/to/file.ts' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.strictEqual(result.fileOperations.length, 1);
            assert.strictEqual(result.fileOperations[0].file, '/path/to/file.ts');
            assert.strictEqual(result.fileOperations[0].operation, 'Edit');
            assert.strictEqual(result.fileOperations[0].count, 1);
        });

        test('should extract Write operations with file paths', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Write',
                                input: { file_path: '/path/to/newfile.ts' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.strictEqual(result.fileOperations.length, 1);
            assert.strictEqual(result.fileOperations[0].file, '/path/to/newfile.ts');
            assert.strictEqual(result.fileOperations[0].operation, 'Write');
            assert.strictEqual(result.fileOperations[0].count, 1);
        });

        test('should extract Glob operations with patterns', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Glob',
                                input: { pattern: '**/*.ts' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.strictEqual(result.fileOperations.length, 1);
            assert.strictEqual(result.fileOperations[0].file, '**/*.ts');
            assert.strictEqual(result.fileOperations[0].operation, 'Glob');
            assert.strictEqual(result.fileOperations[0].count, 1);
        });

        test('should extract Grep operations with patterns', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Grep',
                                input: { pattern: 'searchterm' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.strictEqual(result.fileOperations.length, 1);
            assert.strictEqual(result.fileOperations[0].file, 'searchterm');
            assert.strictEqual(result.fileOperations[0].operation, 'Grep');
            assert.strictEqual(result.fileOperations[0].count, 1);
        });

        test('should count multiple operations on the same file', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Read',
                                input: { file_path: '/path/to/file.ts' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                }),
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_002',
                                name: 'Read',
                                input: { file_path: '/path/to/file.ts' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.strictEqual(result.fileOperations.length, 1);
            assert.strictEqual(result.fileOperations[0].file, '/path/to/file.ts');
            assert.strictEqual(result.fileOperations[0].operation, 'Read');
            assert.strictEqual(result.fileOperations[0].count, 2);
        });

        test('should handle different operations on the same file', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Read',
                                input: { file_path: '/path/to/file.ts' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                }),
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_002',
                                name: 'Edit',
                                input: { file_path: '/path/to/file.ts' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            // Should create separate entries for different operations on same file
            assert.strictEqual(result.fileOperations.length, 2);
            assert.strictEqual(result.fileOperations[0].file, '/path/to/file.ts');
            assert.strictEqual(result.fileOperations[0].operation, 'Read');
            assert.strictEqual(result.fileOperations[1].file, '/path/to/file.ts');
            assert.strictEqual(result.fileOperations[1].operation, 'Edit');
        });
    });

    suite('SubAgent Delegation Extraction', () => {
        test('should extract Task tool invocations with subagent type and description', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Task',
                                input: {
                                    subagent_type: 'shell-ops',
                                    description: 'Check git status before committing'
                                }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.strictEqual(result.subAgentDelegations.length, 1);
            assert.strictEqual(result.subAgentDelegations[0].type, 'shell-ops');
            assert.strictEqual(result.subAgentDelegations[0].description, 'Check git status before committing');
        });

        test('should extract multiple Task invocations', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Task',
                                input: {
                                    subagent_type: 'shell-ops',
                                    description: 'Run git status'
                                }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                }),
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_002',
                                name: 'Task',
                                input: {
                                    subagent_type: 'vscode-expert',
                                    description: 'Verify API usage'
                                }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.strictEqual(result.subAgentDelegations.length, 2);
            assert.strictEqual(result.subAgentDelegations[0].type, 'shell-ops');
            assert.strictEqual(result.subAgentDelegations[1].type, 'vscode-expert');
        });

        test('should ignore Task invocations without subagent_type or description', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Task',
                                input: {
                                    description: 'Task without subagent_type'
                                }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                }),
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_002',
                                name: 'Task',
                                input: {
                                    subagent_type: 'shell-ops'
                                    // Missing description
                                }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            assert.strictEqual(result.subAgentDelegations.length, 0);
        });
    });

    suite('Cost Estimation', () => {
        test('should calculate cost for claude-sonnet-4', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4-20250514',
                        content: [],
                        usage: {
                            input_tokens: 1_000_000,
                            output_tokens: 1_000_000
                        }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            // claude-sonnet-4: $3/MTok input, $15/MTok output
            assert.strictEqual(result.costEstimate.inputCost, 3);
            assert.strictEqual(result.costEstimate.outputCost, 15);
            assert.strictEqual(result.costEstimate.totalCost, 18);
        });

        test('should calculate cost for claude-opus-4', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-opus-4-20250514',
                        content: [],
                        usage: {
                            input_tokens: 1_000_000,
                            output_tokens: 1_000_000
                        }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            // claude-opus-4: $15/MTok input, $75/MTok output
            assert.strictEqual(result.costEstimate.inputCost, 15);
            assert.strictEqual(result.costEstimate.outputCost, 75);
            assert.strictEqual(result.costEstimate.totalCost, 90);
        });

        test('should calculate cost for claude-haiku-3-5', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-haiku-3-5-20250107',
                        content: [],
                        usage: {
                            input_tokens: 1_000_000,
                            output_tokens: 1_000_000
                        }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            // claude-haiku-3-5: $0.80/MTok input, $4/MTok output
            assert.strictEqual(result.costEstimate.inputCost, 0.80);
            assert.strictEqual(result.costEstimate.outputCost, 4);
            assert.strictEqual(result.costEstimate.totalCost, 4.80);
        });

        test('should calculate cost with fractional tokens', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [],
                        usage: {
                            input_tokens: 500_000,
                            output_tokens: 250_000
                        }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            // claude-sonnet-4: $3/MTok input, $15/MTok output
            assert.strictEqual(result.costEstimate.inputCost, 1.5);
            assert.strictEqual(result.costEstimate.outputCost, 3.75);
            assert.strictEqual(result.costEstimate.totalCost, 5.25);
        });
    });

    suite('SessionInsights Aggregation', () => {
        test('should aggregate tool errors across conversations', async () => {
            const conv1 = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            { type: 'tool_use', id: 'tool_001', name: 'Read', input: {} }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                }),
                JSON.stringify({
                    type: 'user',
                    message: {
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: 'tool_001',
                                is_error: true,
                                content: 'Error 1'
                            }
                        ]
                    }
                })
            ].join('\n');

            const conv2 = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            { type: 'tool_use', id: 'tool_002', name: 'Write', input: {} }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                }),
                JSON.stringify({
                    type: 'user',
                    message: {
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: 'tool_002',
                                is_error: true,
                                content: 'Error 2'
                            }
                        ]
                    }
                })
            ].join('\n');

            readDirStub.resolves(['session1.jsonl', 'session2.jsonl']);
            readFileStub.onFirstCall().resolves(conv1);
            readFileStub.onSecondCall().resolves(conv2);

            const insights = await generateInsights('/worktree/path');

            assert.strictEqual(insights.totalToolErrors.length, 2);
            assert.strictEqual(insights.totalToolErrors[0].tool, 'Read');
            assert.strictEqual(insights.totalToolErrors[0].error, 'Error 1');
            assert.strictEqual(insights.totalToolErrors[1].tool, 'Write');
            assert.strictEqual(insights.totalToolErrors[1].error, 'Error 2');
        });

        test('should aggregate file operations by file path', async () => {
            const conv1 = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Read',
                                input: { file_path: '/file1.ts' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            const conv2 = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_002',
                                name: 'Read',
                                input: { file_path: '/file1.ts' }
                            },
                            {
                                type: 'tool_use',
                                id: 'tool_003',
                                name: 'Edit',
                                input: { file_path: '/file1.ts' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readDirStub.resolves(['session1.jsonl', 'session2.jsonl']);
            readFileStub.onFirstCall().resolves(conv1);
            readFileStub.onSecondCall().resolves(conv2);

            const insights = await generateInsights('/worktree/path');

            const fileStats = insights.totalFileOperations.get('/file1.ts');
            assert.ok(fileStats, 'Should have stats for /file1.ts');
            assert.strictEqual(fileStats.reads, 2);
            assert.strictEqual(fileStats.edits, 1);
            assert.strictEqual(fileStats.writes, 0);
        });

        test('should count Glob and Grep as reads in aggregation', async () => {
            const conv1 = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Glob',
                                input: { pattern: '**/*.ts' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            const conv2 = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_002',
                                name: 'Grep',
                                input: { pattern: 'searchterm' }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readDirStub.resolves(['session1.jsonl', 'session2.jsonl']);
            readFileStub.onFirstCall().resolves(conv1);
            readFileStub.onSecondCall().resolves(conv2);

            const insights = await generateInsights('/worktree/path');

            const globStats = insights.totalFileOperations.get('**/*.ts');
            const grepStats = insights.totalFileOperations.get('searchterm');
            assert.ok(globStats);
            assert.strictEqual(globStats.reads, 1);
            assert.ok(grepStats);
            assert.strictEqual(grepStats.reads, 1);
        });

        test('should aggregate subagent delegations by type with counts', async () => {
            const conv1 = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Task',
                                input: {
                                    subagent_type: 'shell-ops',
                                    description: 'Task 1'
                                }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            const conv2 = [
                JSON.stringify({
                    type: 'assistant',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_002',
                                name: 'Task',
                                input: {
                                    subagent_type: 'shell-ops',
                                    description: 'Task 2'
                                }
                            },
                            {
                                type: 'tool_use',
                                id: 'tool_003',
                                name: 'Task',
                                input: {
                                    subagent_type: 'vscode-expert',
                                    description: 'Task 3'
                                }
                            }
                        ],
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }
                })
            ].join('\n');

            readDirStub.resolves(['session1.jsonl', 'session2.jsonl']);
            readFileStub.onFirstCall().resolves(conv1);
            readFileStub.onSecondCall().resolves(conv2);

            const insights = await generateInsights('/worktree/path');

            assert.strictEqual(insights.totalSubAgentDelegations.length, 2);

            const shellOps = insights.totalSubAgentDelegations.find(d => d.type === 'shell-ops');
            const vscodeExpert = insights.totalSubAgentDelegations.find(d => d.type === 'vscode-expert');

            assert.ok(shellOps);
            assert.strictEqual(shellOps.count, 2);
            assert.ok(vscodeExpert);
            assert.strictEqual(vscodeExpert.count, 1);
        });
    });

    suite('Backward Compatibility', () => {
        test('should maintain existing functionality with new fields', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'user',
                    timestamp: '2024-01-01T10:00:00Z',
                    message: {
                        content: 'Test prompt'
                    }
                }),
                JSON.stringify({
                    type: 'assistant',
                    timestamp: '2024-01-01T10:00:01Z',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            {
                                type: 'tool_use',
                                id: 'tool_001',
                                name: 'Bash',
                                input: { command: 'ls' }
                            }
                        ],
                        usage: {
                            input_tokens: 1000,
                            output_tokens: 500
                        }
                    }
                }),
                JSON.stringify({
                    type: 'system',
                    timestamp: '2024-01-01T10:00:02Z',
                    subtype: 'turn_duration',
                    durationMs: 5000
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            // Verify existing fields still work
            assert.strictEqual(result.sessionId, 'session');
            assert.strictEqual(result.firstTimestamp, '2024-01-01T10:00:00Z');
            assert.strictEqual(result.lastTimestamp, '2024-01-01T10:00:02Z');
            assert.strictEqual(result.userMessageCount, 1);
            assert.strictEqual(result.assistantTurnCount, 1);
            assert.strictEqual(result.toolUses.get('Bash'), 1);
            assert.strictEqual(result.totalInputTokens, 1000);
            assert.strictEqual(result.totalOutputTokens, 500);
            assert.strictEqual(result.totalDurationMs, 5000);
            assert.strictEqual(result.userPromptPreviews.length, 1);
            assert.strictEqual(result.userPromptPreviews[0], 'Test prompt');
            assert.strictEqual(result.model, 'claude-sonnet-4');

            // Verify new fields are empty/zero when no relevant data
            assert.strictEqual(result.toolErrors.length, 0);
            assert.strictEqual(result.toolSequence.length, 1); // Bash tool
            assert.strictEqual(result.fileOperations.length, 0);
            assert.strictEqual(result.subAgentDelegations.length, 0);
            assert.ok(result.costEstimate);
            assert.strictEqual(result.costEstimate.totalCost, (1000 / 1_000_000) * 3 + (500 / 1_000_000) * 15);
        });

        test('should handle conversations without errors or special operations', async () => {
            const conversationContent = [
                JSON.stringify({
                    type: 'user',
                    timestamp: '2024-01-01T10:00:00Z',
                    message: {
                        content: 'Simple question'
                    }
                }),
                JSON.stringify({
                    type: 'assistant',
                    timestamp: '2024-01-01T10:00:01Z',
                    message: {
                        model: 'claude-sonnet-4',
                        content: [
                            { type: 'text', text: 'Simple answer' }
                        ],
                        usage: {
                            input_tokens: 100,
                            output_tokens: 50
                        }
                    }
                })
            ].join('\n');

            readFileStub.resolves(conversationContent);

            const result = await parseConversationFile('/path/to/session.jsonl');

            // Existing fields
            assert.strictEqual(result.userMessageCount, 1);
            assert.strictEqual(result.assistantTurnCount, 1);
            assert.strictEqual(result.totalInputTokens, 100);
            assert.strictEqual(result.totalOutputTokens, 50);

            // New fields should be empty
            assert.strictEqual(result.toolErrors.length, 0);
            assert.strictEqual(result.toolSequence.length, 0);
            assert.strictEqual(result.fileOperations.length, 0);
            assert.strictEqual(result.subAgentDelegations.length, 0);
            assert.ok(result.costEstimate);
            // Use approximate comparison for floating-point values
            assert.ok(Math.abs(result.costEstimate.inputCost - 0.0003) < 0.0000001, `Expected inputCost ~0.0003, got ${result.costEstimate.inputCost}`);
            assert.ok(Math.abs(result.costEstimate.outputCost - 0.00075) < 0.0000001, `Expected outputCost ~0.00075, got ${result.costEstimate.outputCost}`);
        });
    });

    suite('InsightsService - Report Formatting', () => {
        // Helper function to create minimal test data
        function createMinimalInsights(): SessionInsights {
            return {
                sessionCount: 1,
                conversations: [{
                    sessionId: 'test-session',
                    firstTimestamp: '2024-01-01T10:00:00Z',
                    lastTimestamp: '2024-01-01T11:00:00Z',
                    userMessageCount: 2,
                    assistantTurnCount: 3,
                    toolUses: new Map([['Read', 5]]),
                    skillUses: new Map(),
                    mcpUses: new Map(),
                    totalInputTokens: 10000,
                    totalOutputTokens: 5000,
                    totalCacheReadTokens: 2000,
                    totalDurationMs: 30000,
                    userPromptPreviews: ['Test prompt'],
                    model: 'claude-sonnet-4',
                    toolErrors: [],
                    toolSequence: ['Read'],
                    fileOperations: [],
                    subAgentDelegations: [],
                    costEstimate: { inputCost: 0.03, outputCost: 0.075, totalCost: 0.105 }
                }],
                totalUserMessages: 2,
                totalAssistantTurns: 3,
                totalToolUses: new Map([['Read', 5]]),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 10000,
                totalOutputTokens: 5000,
                totalCacheReadTokens: 2000,
                totalDurationMs: 30000,
                earliestTimestamp: '2024-01-01T10:00:00Z',
                latestTimestamp: '2024-01-01T11:00:00Z',
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };
        }

        test('should format report without analysis parameter (backward compatibility)', () => {
            const insights = createMinimalInsights();
            const report = formatInsightsReport('test-session', insights);

            // Should have basic sections
            assert.ok(report.includes('# Session Insights: test-session'));
            assert.ok(report.includes('## Summary'));
            assert.ok(report.includes('## Token Usage'));
            assert.ok(report.includes('## Tool Usage'));
            assert.ok(report.includes('## Conversations'));

            // Should NOT have analysis sections
            assert.ok(!report.includes('## Recommendations'));
            assert.ok(!report.includes('## Efficiency'));
            assert.ok(!report.includes('## Workflow Patterns'));
            assert.ok(!report.includes('## Error Analysis'));
        });

        test('should include cost and complexity in Summary when analysis provided', () => {
            const insights = createMinimalInsights();
            const analysis: AnalysisResult = {
                efficiency: {
                    totalCost: 5.50,
                    inputCost: 2.00,
                    outputCost: 3.50,
                    cacheHitRate: 45.0,
                    tokensPerUserMessage: 5000,
                    outputInputRatio: 1.5,
                    averageTurnDurationMs: 3000,
                    averageTurnsPerConversation: 12,
                    averageUserMessagesPerConversation: 6
                },
                patterns: {
                    topToolChains: [],
                    fileHotspots: [],
                    delegationSummary: [],
                    conversationComplexity: 'moderate',
                    readEditRatio: 2.5
                },
                errorAnalysis: {
                    totalErrors: 0,
                    errorRate: 0,
                    errorsByTool: [],
                    mostFailedTool: null
                },
                recommendations: []
            };

            const report = formatInsightsReport('test-session', insights, analysis);

            assert.ok(report.includes('**Estimated cost**: $5.50'));
            assert.ok(report.includes('**Complexity**: moderate'));
        });

        test('should render Recommendations section with correct severity icons', () => {
            const insights = createMinimalInsights();
            const analysis: AnalysisResult = {
                efficiency: {
                    totalCost: 5.50,
                    inputCost: 2.00,
                    outputCost: 3.50,
                    cacheHitRate: 45.0,
                    tokensPerUserMessage: 5000,
                    outputInputRatio: 1.5,
                    averageTurnDurationMs: 3000,
                    averageTurnsPerConversation: 12,
                    averageUserMessagesPerConversation: 6
                },
                patterns: {
                    topToolChains: [],
                    fileHotspots: [],
                    delegationSummary: [],
                    conversationComplexity: 'moderate',
                    readEditRatio: 2.5
                },
                errorAnalysis: {
                    totalErrors: 0,
                    errorRate: 0,
                    errorsByTool: [],
                    mostFailedTool: null
                },
                recommendations: [
                    { severity: 'warning', category: 'efficiency', title: 'Test Warning', detail: 'Warning detail' },
                    { severity: 'suggestion', category: 'patterns', title: 'Test Suggestion', detail: 'Suggestion detail' },
                    { severity: 'info', category: 'errors', title: 'Test Info', detail: 'Info detail' }
                ]
            };

            const report = formatInsightsReport('test-session', insights, analysis);

            assert.ok(report.includes('## Recommendations'));
            assert.ok(report.includes('⚠️ **Test Warning** — Warning detail'));
            assert.ok(report.includes('💡 **Test Suggestion** — Suggestion detail'));
            assert.ok(report.includes('ℹ️ **Test Info** — Info detail'));
        });

        test('should not include Recommendations section when no recommendations', () => {
            const insights = createMinimalInsights();
            const analysis: AnalysisResult = {
                efficiency: {
                    totalCost: 5.50,
                    inputCost: 2.00,
                    outputCost: 3.50,
                    cacheHitRate: 45.0,
                    tokensPerUserMessage: 5000,
                    outputInputRatio: 1.5,
                    averageTurnDurationMs: 3000,
                    averageTurnsPerConversation: 12,
                    averageUserMessagesPerConversation: 6
                },
                patterns: {
                    topToolChains: [],
                    fileHotspots: [],
                    delegationSummary: [],
                    conversationComplexity: 'moderate',
                    readEditRatio: 2.5
                },
                errorAnalysis: {
                    totalErrors: 0,
                    errorRate: 0,
                    errorsByTool: [],
                    mostFailedTool: null
                },
                recommendations: []
            };

            const report = formatInsightsReport('test-session', insights, analysis);

            assert.ok(!report.includes('## Recommendations'));
        });

        test('should render Efficiency section with metrics and cost breakdown', () => {
            const insights = createMinimalInsights();
            const analysis: AnalysisResult = {
                efficiency: {
                    totalCost: 5.50,
                    inputCost: 2.00,
                    outputCost: 3.50,
                    cacheHitRate: 45.0,
                    tokensPerUserMessage: 5000,
                    outputInputRatio: 1.5,
                    averageTurnDurationMs: 65000, // 1m 5s
                    averageTurnsPerConversation: 12.3,
                    averageUserMessagesPerConversation: 6.5
                },
                patterns: {
                    topToolChains: [],
                    fileHotspots: [],
                    delegationSummary: [],
                    conversationComplexity: 'moderate',
                    readEditRatio: 2.5
                },
                errorAnalysis: {
                    totalErrors: 0,
                    errorRate: 0,
                    errorsByTool: [],
                    mostFailedTool: null
                },
                recommendations: []
            };

            const report = formatInsightsReport('test-session', insights, analysis);

            assert.ok(report.includes('## Efficiency'));
            assert.ok(report.includes('Cache hit rate'));
            assert.ok(report.includes('45.0%'));
            assert.ok(report.includes('Tokens per message'));
            assert.ok(report.includes('5,000'));
            assert.ok(report.includes('Output/Input ratio'));
            assert.ok(report.includes('1.50'));
            assert.ok(report.includes('Avg turn duration'));
            assert.ok(report.includes('1m 5s'));
            assert.ok(report.includes('Avg turns/conversation'));
            assert.ok(report.includes('12.3'));
            assert.ok(report.includes('Avg messages/conversation'));
            assert.ok(report.includes('6.5'));

            assert.ok(report.includes('### Cost Breakdown'));
            assert.ok(report.includes('Input | $2.00'));
            assert.ok(report.includes('Output | $3.50'));
            assert.ok(report.includes('**Total** | **$5.50**'));
        });

        test('should render percentage bar correctly in Efficiency metrics', () => {
            const insights = createMinimalInsights();
            const analysis: AnalysisResult = {
                efficiency: {
                    totalCost: 5.50,
                    inputCost: 2.00,
                    outputCost: 3.50,
                    cacheHitRate: 40.0,
                    tokensPerUserMessage: 5000,
                    outputInputRatio: 1.5,
                    averageTurnDurationMs: 3000,
                    averageTurnsPerConversation: 12,
                    averageUserMessagesPerConversation: 6
                },
                patterns: {
                    topToolChains: [],
                    fileHotspots: [],
                    delegationSummary: [],
                    conversationComplexity: 'moderate',
                    readEditRatio: 2.5
                },
                errorAnalysis: {
                    totalErrors: 0,
                    errorRate: 0,
                    errorsByTool: [],
                    mostFailedTool: null
                },
                recommendations: []
            };

            const report = formatInsightsReport('test-session', insights, analysis);

            // Check that percentage bar is present (contains both filled and empty blocks)
            assert.ok(report.includes('█'));
            assert.ok(report.includes('░'));
            assert.ok(report.includes('40.0%'));
        });

        test('should render Workflow Patterns with tool chains', () => {
            const insights = createMinimalInsights();
            const analysis: AnalysisResult = {
                efficiency: {
                    totalCost: 5.50,
                    inputCost: 2.00,
                    outputCost: 3.50,
                    cacheHitRate: 45.0,
                    tokensPerUserMessage: 5000,
                    outputInputRatio: 1.5,
                    averageTurnDurationMs: 3000,
                    averageTurnsPerConversation: 12,
                    averageUserMessagesPerConversation: 6
                },
                patterns: {
                    topToolChains: [
                        { sequence: ['Read', 'Edit', 'Bash'], count: 5 },
                        { sequence: ['Glob', 'Read'], count: 3 }
                    ],
                    fileHotspots: [],
                    delegationSummary: [],
                    conversationComplexity: 'moderate',
                    readEditRatio: 2.5
                },
                errorAnalysis: {
                    totalErrors: 0,
                    errorRate: 0,
                    errorsByTool: [],
                    mostFailedTool: null
                },
                recommendations: []
            };

            const report = formatInsightsReport('test-session', insights, analysis);

            assert.ok(report.includes('## Workflow Patterns'));
            assert.ok(report.includes('### Tool Chains'));
            assert.ok(report.includes('Read → Edit → Bash (×5)'));
            assert.ok(report.includes('Glob → Read (×3)'));
        });

        test('should render Workflow Patterns with file hotspots', () => {
            const insights = createMinimalInsights();
            const analysis: AnalysisResult = {
                efficiency: {
                    totalCost: 5.50,
                    inputCost: 2.00,
                    outputCost: 3.50,
                    cacheHitRate: 45.0,
                    tokensPerUserMessage: 5000,
                    outputInputRatio: 1.5,
                    averageTurnDurationMs: 3000,
                    averageTurnsPerConversation: 12,
                    averageUserMessagesPerConversation: 6
                },
                patterns: {
                    topToolChains: [],
                    fileHotspots: [
                        { file: '/very/long/path/to/src/services/InsightsService.ts', totalOperations: 15, reads: 10, edits: 4, writes: 1 },
                        { file: 'src/extension.ts', totalOperations: 8, reads: 5, edits: 3, writes: 0 }
                    ],
                    delegationSummary: [],
                    conversationComplexity: 'moderate',
                    readEditRatio: 2.5
                },
                errorAnalysis: {
                    totalErrors: 0,
                    errorRate: 0,
                    errorsByTool: [],
                    mostFailedTool: null
                },
                recommendations: []
            };

            const report = formatInsightsReport('test-session', insights, analysis);

            assert.ok(report.includes('## Workflow Patterns'));
            assert.ok(report.includes('### File Hotspots'));
            // File path should be truncated
            assert.ok(report.includes('services/InsightsService.ts'));
            assert.ok(report.includes('| 15 | 10 | 4 | 1 |'));
            assert.ok(report.includes('src/extension.ts'));
            assert.ok(report.includes('| 8 | 5 | 3 | 0 |'));
        });

        test('should render Workflow Patterns with delegation summary', () => {
            const insights = createMinimalInsights();
            const analysis: AnalysisResult = {
                efficiency: {
                    totalCost: 5.50,
                    inputCost: 2.00,
                    outputCost: 3.50,
                    cacheHitRate: 45.0,
                    tokensPerUserMessage: 5000,
                    outputInputRatio: 1.5,
                    averageTurnDurationMs: 3000,
                    averageTurnsPerConversation: 12,
                    averageUserMessagesPerConversation: 6
                },
                patterns: {
                    topToolChains: [],
                    fileHotspots: [],
                    delegationSummary: [
                        { type: 'coder', count: 3, percentage: 75 },
                        { type: 'shell-ops', count: 1, percentage: 25 }
                    ],
                    conversationComplexity: 'moderate',
                    readEditRatio: 2.5
                },
                errorAnalysis: {
                    totalErrors: 0,
                    errorRate: 0,
                    errorsByTool: [],
                    mostFailedTool: null
                },
                recommendations: []
            };

            const report = formatInsightsReport('test-session', insights, analysis);

            assert.ok(report.includes('## Workflow Patterns'));
            assert.ok(report.includes('### Sub-Agent Delegations'));
            assert.ok(report.includes('coder'));
            assert.ok(report.includes('| 3 | 75.0% |'));
            assert.ok(report.includes('shell-ops'));
            assert.ok(report.includes('| 1 | 25.0% |'));
        });

        test('should not include Workflow Patterns section when no patterns', () => {
            const insights = createMinimalInsights();
            const analysis: AnalysisResult = {
                efficiency: {
                    totalCost: 5.50,
                    inputCost: 2.00,
                    outputCost: 3.50,
                    cacheHitRate: 45.0,
                    tokensPerUserMessage: 5000,
                    outputInputRatio: 1.5,
                    averageTurnDurationMs: 3000,
                    averageTurnsPerConversation: 12,
                    averageUserMessagesPerConversation: 6
                },
                patterns: {
                    topToolChains: [],
                    fileHotspots: [],
                    delegationSummary: [],
                    conversationComplexity: 'moderate',
                    readEditRatio: 2.5
                },
                errorAnalysis: {
                    totalErrors: 0,
                    errorRate: 0,
                    errorsByTool: [],
                    mostFailedTool: null
                },
                recommendations: []
            };

            const report = formatInsightsReport('test-session', insights, analysis);

            assert.ok(!report.includes('## Workflow Patterns'));
        });

        test('should render Error Analysis when errors exist', () => {
            const insights = createMinimalInsights();
            const analysis: AnalysisResult = {
                efficiency: {
                    totalCost: 5.50,
                    inputCost: 2.00,
                    outputCost: 3.50,
                    cacheHitRate: 45.0,
                    tokensPerUserMessage: 5000,
                    outputInputRatio: 1.5,
                    averageTurnDurationMs: 3000,
                    averageTurnsPerConversation: 12,
                    averageUserMessagesPerConversation: 6
                },
                patterns: {
                    topToolChains: [],
                    fileHotspots: [],
                    delegationSummary: [],
                    conversationComplexity: 'moderate',
                    readEditRatio: 2.5
                },
                errorAnalysis: {
                    totalErrors: 5,
                    errorRate: 10.5,
                    errorsByTool: [
                        { tool: 'Bash', count: 3, percentage: 60 },
                        { tool: 'Read', count: 2, percentage: 40 }
                    ],
                    mostFailedTool: 'Bash'
                },
                recommendations: []
            };

            const report = formatInsightsReport('test-session', insights, analysis);

            assert.ok(report.includes('## Error Analysis'));
            assert.ok(report.includes('**Total errors**: 5 (10.5% of tool calls)'));
            assert.ok(report.includes('**Most failed tool**: Bash'));
            assert.ok(report.includes('| Bash | 3 | 60.0% |'));
            assert.ok(report.includes('| Read | 2 | 40.0% |'));
        });

        test('should not include Error Analysis when no errors', () => {
            const insights = createMinimalInsights();
            const analysis: AnalysisResult = {
                efficiency: {
                    totalCost: 5.50,
                    inputCost: 2.00,
                    outputCost: 3.50,
                    cacheHitRate: 45.0,
                    tokensPerUserMessage: 5000,
                    outputInputRatio: 1.5,
                    averageTurnDurationMs: 3000,
                    averageTurnsPerConversation: 12,
                    averageUserMessagesPerConversation: 6
                },
                patterns: {
                    topToolChains: [],
                    fileHotspots: [],
                    delegationSummary: [],
                    conversationComplexity: 'moderate',
                    readEditRatio: 2.5
                },
                errorAnalysis: {
                    totalErrors: 0,
                    errorRate: 0,
                    errorsByTool: [],
                    mostFailedTool: null
                },
                recommendations: []
            };

            const report = formatInsightsReport('test-session', insights, analysis);

            assert.ok(!report.includes('## Error Analysis'));
        });

        test('should display conversation cost in Conversations section', () => {
            const insights = createMinimalInsights();
            insights.conversations[0].costEstimate = { inputCost: 1.50, outputCost: 2.25, totalCost: 3.75 };

            const report = formatInsightsReport('test-session', insights);

            assert.ok(report.includes('## Conversations'));
            assert.ok(report.includes('**Cost**: $3.75'));
        });
    });
});
