# Phase 4: UI Integration - Research

**Researched:** 2026-02-10
**Domain:** VS Code webview forms, HTML dropdown components, CSS theming, webview state persistence
**Confidence:** HIGH

## Summary

Phase 4 adds agent selection to the session creation webview form and ensures the permission toggle adapts correctly per agent. This is UI work building on the CodeAgent abstraction from Phase 2 and the Codex CLI integration from Phase 3. Terminal differentiation (names, icons, colors) was already implemented in earlier phases via `CodeAgent.getTerminalName()` and `CodeAgent.getTerminalIcon()` methods.

The existing `SessionFormProvider` already demonstrates mature webview patterns: HTML generation with CSP, VS Code theme variables, state persistence via `vscode.getState()/setState()`, and message passing between webview and extension. The workflow dropdown implementation provides a direct template for the agent dropdown.

This phase focuses on three core changes: (1) adding an agent dropdown to the form HTML, (2) passing the selected agent through the submission callback, and (3) using the agent factory to validate CLI availability and render the dropdown accordingly. The user has made specific decisions about placement, behavior, and unavailable agent handling.

**Primary recommendation:** Use standard HTML `<select>` element styled with VS Code CSS variables (matching the existing workflow dropdown). Leverage the factory's `isCliAvailable()` function to determine whether to show/hide the dropdown and whether to render disabled options. Pass agent name (not instance) through the webview message, resolve to CodeAgent instance in the extension context.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Agent selector design:**
- Placement: After session name field (second field in form) — session name is primary, agent is a configuration detail
- Element type: Dropdown select — matches the existing workflow dropdown style, compact, consistent with form
- Default value: Always resets to `lanes.defaultAgent` VS Code setting on form clear — no last-used memory
- Labels: Full names — "Claude Code" and "Codex CLI" in the dropdown options

**Permission mode adaptation:**
- Same toggle for both agents — one toggle button works identically regardless of selected agent
- No extra visual feedback — no tooltips, inline labels, or agent-specific explanations for the permission mode
- Toggle state preserved on agent switch — if bypass was on, it stays on when user changes agent
- Keep 2 modes only — stick with Phase 3 decision (acceptEdits/bypassPermissions), do not expose Codex's read-only mode

**Unavailable agent handling:**
- Show disabled option: "Codex CLI (not installed)" appears grayed out in dropdown when CLI not found
- Hide dropdown entirely when only one agent is available — less clutter for single-agent users
- CLI availability checked once at extension activation, cached result used for form rendering
- Bad default handling: If `lanes.defaultAgent` points to unavailable CLI, fall back to Claude Code AND show a VS Code warning notification

### Claude's Discretion

- Exact CSS styling of the dropdown and disabled option appearance
- How to pass cached CLI availability from factory to the webview form provider
- Whether to add the agent field to webview state persistence
- Label for the dropdown field (e.g., "Agent", "Code Agent", "CLI Agent")

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| VS Code API | 1.75+ | Webview views | Required by extension, already in use |
| HTML5 | Standard | Form elements | Native browser support, accessible |
| CSS3 | Standard | Styling | VS Code provides CSS variables for theming |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | - | - | Phase uses standard web technologies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| HTML `<select>` | vscode-webview-ui-toolkit dropdown | Toolkit is deprecated as of Jan 1 2025, HTML select is stable and well-supported |
| CSS variables | Hardcoded colors | CSS variables automatically adapt to user's theme |
| State persistence with `vscode.getState()` | Custom storage | Built-in API is optimized and automatic |

**Installation:**
```bash
# No new dependencies - uses built-in VS Code and web platform APIs
```

## Architecture Patterns

### Recommended Form Structure
```
SessionFormProvider (webview)
├── Session Name field (existing)
├── Agent dropdown (NEW - second field)
├── Source Branch field (existing)
├── Starting Prompt field (existing)
├── Workflow dropdown (existing)
└── Submit row with bypass toggle (existing)
```

### Pattern 1: Agent Dropdown with Conditional Rendering

**What:** HTML `<select>` element that appears only when multiple agents are available. When Codex CLI is not installed, show as disabled option.

**When to use:** When UI should adapt based on system state (CLI availability) determined at extension activation.

**Example:**
```typescript
// In SessionFormProvider, add agent availability tracking
private _agentAvailability: Map<string, boolean> = new Map();

public setAgentAvailability(availability: Map<string, boolean>): void {
    this._agentAvailability = availability;
    // If webview is already visible, update it
    if (this._view) {
        this._view.webview.postMessage({
            command: 'updateAgentAvailability',
            availability: Object.fromEntries(availability)
        });
    }
}

// Generate agent dropdown HTML based on availability
private _getAgentDropdownHtml(): string {
    const available = Array.from(this._agentAvailability.entries())
        .filter(([_, isAvailable]) => isAvailable);

    // Hide dropdown if only one agent available
    if (available.length <= 1) {
        return ''; // No dropdown needed
    }

    const config = vscode.workspace.getConfiguration('lanes');
    const defaultAgent = config.get<string>('defaultAgent', 'claude');

    let html = '<div class="form-group">';
    html += '<label for="agent">Code Agent</label>';
    html += '<select id="agent" name="agent">';

    // All agents (including unavailable ones shown as disabled)
    const agents = [
        { name: 'claude', label: 'Claude Code' },
        { name: 'codex', label: 'Codex CLI' }
    ];

    for (const agent of agents) {
        const isAvailable = this._agentAvailability.get(agent.name);
        const label = isAvailable ? agent.label : `${agent.label} (not installed)`;
        const disabled = isAvailable ? '' : ' disabled';
        const selected = agent.name === defaultAgent ? ' selected' : '';

        html += `<option value="${agent.name}"${disabled}${selected}>${this._escapeHtml(label)}</option>`;
    }

    html += '</select>';
    html += '<div class="hint">Select which AI assistant to use for this session</div>';
    html += '</div>';

    return html;
}
```

**Source:** VS Code webview API patterns + existing workflow dropdown implementation

### Pattern 2: Webview State Persistence for Agent Selection

**What:** Save and restore agent selection using `vscode.getState()/setState()` so form state persists when webview is hidden/recreated.

**When to use:** For all form fields that should survive webview lifecycle events (tab switching, sidebar collapse).

**Example:**
```html
<!-- JavaScript in webview HTML -->
<script nonce="${nonce}">
    const agentInput = document.getElementById('agent');

    // Restore state when webview is recreated
    const previousState = vscode.getState();
    if (previousState) {
        // Restore agent, fallback to default from server-rendered HTML
        if (agentInput && previousState.agent) {
            agentInput.value = previousState.agent;
        }
        // ... restore other fields
    }

    // Save state whenever agent changes
    function saveState() {
        vscode.setState({
            name: nameInput.value,
            agent: agentInput ? agentInput.value : 'claude',
            sourceBranch: sourceBranchInput.value,
            prompt: promptInput.value,
            bypassPermissions: bypassPermissions,
            workflow: workflowInput.value,
            attachments: attachments
        });
    }

    // Attach change listener
    if (agentInput) {
        agentInput.addEventListener('change', saveState);
    }

    // On form clear (after successful submission)
    function clearForm() {
        // Reset to default agent from config
        if (agentInput) {
            agentInput.value = '${defaultAgent}'; // Server-rendered default
        }
        // ... clear other fields
        vscode.setState({ /* cleared state */ });
    }
</script>
```

**Source:** Existing form state pattern in SessionFormProvider + [VS Code Webview API docs](https://code.visualstudio.com/api/extension-guides/webview)

### Pattern 3: Message Passing for Agent Selection

**What:** Pass agent name (string) through webview message, resolve to CodeAgent instance in extension context using factory.

**When to use:** When webview needs to send data to extension for processing.

**Example:**
```typescript
// Webview -> Extension message
form.addEventListener('submit', (e) => {
    e.preventDefault();

    vscode.postMessage({
        command: 'createSession',
        name: nameInput.value.trim(),
        agent: agentInput ? agentInput.value : 'claude', // NEW field
        sourceBranch: sourceBranchInput.value.trim(),
        prompt: promptInput.value.trim(),
        permissionMode: bypassPermissions ? 'bypassPermissions' : 'acceptEdits',
        workflow: workflowInput.value || null,
        attachments: attachments.map(a => a.path)
    });
});

// Extension-side handler (in SessionFormProvider)
webviewView.webview.onDidReceiveMessage(async message => {
    switch (message.command) {
        case 'createSession':
            if (this._onSubmit) {
                try {
                    await this._onSubmit(
                        message.name,
                        message.agent,        // NEW parameter
                        message.prompt,
                        message.sourceBranch || '',
                        message.permissionMode || 'acceptEdits',
                        message.workflow || null,
                        message.attachments || []
                    );
                } catch (err) {
                    console.error('Lanes: Session creation failed:', err);
                    return; // Don't clear form on error
                }
            }
            this._view?.webview.postMessage({ command: 'clearForm' });
            break;
    }
});
```

**Source:** Existing workflow/attachments message passing pattern

### Pattern 4: CLI Availability Check at Activation

**What:** Check CLI availability once during extension activation, cache results, pass to form provider for rendering.

**When to use:** When availability checks are expensive (shell exec) and result doesn't change during VS Code session.

**Example:**
```typescript
// In extension.ts activate()
import { getAgent, isCliAvailable } from './codeAgents';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // ... existing initialization

    // Check CLI availability for all agents
    const agentAvailability = new Map<string, boolean>();
    const availableAgents = ['claude', 'codex']; // From factory

    for (const agentName of availableAgents) {
        const agent = getAgent(agentName);
        if (!agent) {
            agentAvailability.set(agentName, false);
            continue;
        }

        // Check if CLI command exists on system
        const available = await isCliAvailable(agent.cliCommand);
        agentAvailability.set(agentName, available);

        console.log(`Agent ${agentName} (${agent.cliCommand}): ${available ? 'available' : 'not installed'}`);
    }

    // Validate default agent setting
    const defaultAgent = getDefaultAgent(); // Reads lanes.defaultAgent setting
    const defaultAvailable = agentAvailability.get(defaultAgent);

    if (!defaultAvailable) {
        // User decision: show warning and fall back to Claude
        vscode.window.showWarningMessage(
            `Default agent '${defaultAgent}' is not installed. Falling back to Claude Code.`
        );
        // Update the cached default to 'claude' for this session
        // (Don't modify user's settings.json)
    }

    // Pass availability to form provider
    const sessionFormProvider = new SessionFormProvider(context.extensionUri);
    sessionFormProvider.setAgentAvailability(agentAvailability);

    // ... rest of activation
}
```

**Source:** Phase 2 factory pattern + existing validation patterns in codebase

### Anti-Patterns to Avoid

- **Don't check CLI availability on every form render:** Expensive shell exec, result rarely changes. Check once at activation.

- **Don't pass CodeAgent instances through webview messages:** Webview can't receive complex objects. Pass agent name string, resolve in extension context.

- **Don't hide disabled options:** User decision is to show "Codex CLI (not installed)" as disabled option for awareness.

- **Don't add agent-specific permission mode explanations:** User decision is same toggle for all agents, no extra labels or tooltips.

- **Don't persist agent selection across form clears:** User decision is to always reset to `lanes.defaultAgent` on form clear.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dropdown styling | Custom CSS framework | VS Code CSS variables | Automatically adapts to user's theme, matches VS Code UI |
| State persistence | Custom storage mechanism | vscode.getState()/setState() | Optimized by VS Code, automatic serialization |
| Agent availability check | File system path parsing | factory.isCliAvailable() | Cross-platform, handles shell PATH correctly |
| Webview HTML escaping | Manual string replacement | Existing _escapeHtml() method | Already implemented, tested, prevents XSS |

**Key insight:** VS Code provides optimized APIs for webview state and theming. Don't reinvent these - they handle edge cases and performance better than custom implementations.

## Common Pitfalls

### Pitfall 1: Dropdown Hidden When It Should Be Visible

**What goes wrong:** Logic error causes dropdown to hide when both Claude and Codex are available (e.g., checking wrong condition).

**Why it happens:** User decision is to hide dropdown "when only one agent is available" but logic checks "if Claude is available" instead of counting available agents.

**How to avoid:** Count number of available agents, not whether a specific agent is available. Hide dropdown only if count <= 1.

**Warning signs:**
- Dropdown doesn't appear even when Codex is installed
- Dropdown visibility changes unexpectedly
- Unit tests pass but integration behavior is wrong

**Correct implementation:**
```typescript
// WRONG: checks specific agent
if (agentAvailability.get('claude')) {
    return ''; // Hide dropdown - INCORRECT
}

// CORRECT: counts available agents
const availableCount = Array.from(agentAvailability.values())
    .filter(isAvailable => isAvailable).length;

if (availableCount <= 1) {
    return ''; // Hide dropdown - only one option
}
```

### Pitfall 2: Agent Selection Not Cleared on Form Reset

**What goes wrong:** After successful session creation, agent selection stays on user's last choice instead of resetting to default.

**Why it happens:** clearForm message handler doesn't reset agent dropdown value, or resets to wrong value.

**How to avoid:** In clearForm handler, explicitly reset agent dropdown to server-rendered default (from `lanes.defaultAgent` setting).

**Warning signs:**
- Creating multiple sessions in a row shows last-used agent instead of default
- Form state doesn't match expectation after clear
- Agent selection persists when it shouldn't

**Correct implementation:**
```javascript
// In webview JavaScript clearForm handler
case 'clearForm':
    nameInput.value = '';
    sourceBranchInput.value = '';
    promptInput.value = '';
    bypassPermissions = false;
    updateBypassBtn();
    workflowInput.value = '';

    // IMPORTANT: Reset to server-rendered default, not last value
    if (agentInput) {
        // Default is rendered from lanes.defaultAgent setting
        agentInput.value = '${defaultAgent}';
    }

    attachments = [];
    renderAttachmentChips();
    vscode.setState({ /* all fields cleared */ });
    nameInput.focus();
    break;
```

### Pitfall 3: Disabled Option Not Styled Visibly

**What goes wrong:** "Codex CLI (not installed)" option looks enabled or is hard to distinguish from available options.

**Why it happens:** CSS doesn't style disabled options, or disabled attribute not properly set in HTML.

**How to avoid:** Use CSS `:disabled` pseudo-class with reduced opacity, and ensure HTML `disabled` attribute is present.

**Warning signs:**
- Users try to select unavailable agent and get confused when nothing happens
- No visual distinction between available and unavailable agents
- Accessibility tools don't announce disabled state

**Correct implementation:**
```css
/* In webview CSS */
select option:disabled {
    opacity: 0.5;
    color: var(--vscode-disabledForeground);
    font-style: italic;
}
```

```typescript
// In HTML generation
const disabled = isAvailable ? '' : ' disabled';
html += `<option value="${agent.name}"${disabled}>${label}</option>`;
```

### Pitfall 4: Permission Toggle State Lost on Agent Switch

**What goes wrong:** Changing agent selection from Claude to Codex (or vice versa) resets bypass permissions toggle.

**Why it happens:** Change event handler on agent dropdown clears permission state or form state isn't properly preserved.

**How to avoid:** Don't add logic that clears permission state on agent change. Only clear on explicit form reset.

**Warning signs:**
- User turns on bypass permissions, changes agent, toggle resets
- Permission state doesn't persist as expected
- Tests for "toggle state preserved on agent switch" fail

**Correct implementation:**
```javascript
// Agent change listener should ONLY save state, not modify other fields
agentInput.addEventListener('change', () => {
    saveState(); // Just persist - don't modify bypassPermissions
});

// Permission state is independent of agent selection
bypassPermissionsBtn.addEventListener('click', () => {
    bypassPermissions = !bypassPermissions;
    updateBypassBtn();
    saveState();
});
```

### Pitfall 5: Default Agent Fallback Not Communicated

**What goes wrong:** `lanes.defaultAgent` points to unavailable Codex but user doesn't see a warning, silently falls back to Claude.

**Why it happens:** Validation logic detects the issue but doesn't show notification to user.

**How to avoid:** User decision is to show VS Code warning notification when default agent is unavailable.

**Warning signs:**
- User expects Codex but gets Claude without knowing why
- Configuration issue not surfaced to user
- Silent failures mask configuration problems

**Correct implementation:**
```typescript
// In extension activation
const defaultAgent = getDefaultAgent();
const defaultAvailable = agentAvailability.get(defaultAgent);

if (!defaultAvailable) {
    // REQUIRED: Show warning to user
    vscode.window.showWarningMessage(
        `Default agent '${defaultAgent}' is not installed. ` +
        `Falling back to Claude Code. ` +
        `Install the ${defaultAgent} CLI or change lanes.defaultAgent setting.`
    );
}
```

## Code Examples

Verified patterns from official sources and existing codebase:

### Dropdown with VS Code Theming
```html
<!-- Source: Existing workflow dropdown in SessionFormProvider -->
<div class="form-group">
    <label for="agent">Code Agent</label>
    <select id="agent" name="agent">
        <option value="claude">Claude Code</option>
        <option value="codex" disabled>Codex CLI (not installed)</option>
    </select>
    <div class="hint">Select which AI assistant to use for this session</div>
</div>

<style>
/* Matches existing form styling in SessionFormProvider */
select {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
    border-radius: 2px;
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
}

select:focus {
    outline: 1px solid var(--vscode-focusBorder);
    border-color: var(--vscode-focusBorder);
}

select option:disabled {
    opacity: 0.5;
    color: var(--vscode-disabledForeground);
    font-style: italic;
}
</style>
```

**Source:** Existing workflow dropdown pattern in SessionFormProvider.ts lines 543-552

### Callback Signature Update
```typescript
// Source: Existing SessionFormSubmitCallback in SessionFormProvider.ts

// BEFORE (Phase 3)
export type SessionFormSubmitCallback = (
    name: string,
    prompt: string,
    sourceBranch: string,
    permissionMode: PermissionMode,
    workflow: string | null,
    attachments: string[]
) => void | Promise<void>;

// AFTER (Phase 4)
export type SessionFormSubmitCallback = (
    name: string,
    agent: string,          // NEW: agent name ('claude' or 'codex')
    prompt: string,
    sourceBranch: string,
    permissionMode: PermissionMode,
    workflow: string | null,
    attachments: string[]
) => void | Promise<void>;
```

**Source:** SessionFormProvider.ts lines 38-45 (existing pattern for workflow parameter)

### CLI Availability Check
```typescript
// Source: Phase 2 factory.ts implementation

import { exec } from 'child_process';

/**
 * Check if a CLI command is available on the system.
 * Uses `command -v` (POSIX builtin) instead of `which` for
 * reliable cross-platform behavior.
 */
export async function isCliAvailable(cliCommand: string): Promise<boolean> {
    return new Promise((resolve) => {
        exec(
            `command -v ${cliCommand}`,
            { shell: '/bin/sh', timeout: 5000 },
            (error) => {
                resolve(!error);
            }
        );
    });
}
```

**Source:** src/codeAgents/factory.ts lines 105-111 (from Phase 2 implementation)

### Terminal Differentiation (Already Implemented)
```typescript
// Source: CodeAgent.ts abstract class + TerminalService.ts

// Agent-specific terminal naming
export abstract class CodeAgent {
    abstract getTerminalName(sessionName: string): string;
    abstract getTerminalIcon(): { id: string; color?: string };
}

// ClaudeCodeAgent implementation (Phase 1)
class ClaudeCodeAgent extends CodeAgent {
    getTerminalName(sessionName: string): string {
        return `Claude: ${sessionName}`;
    }

    getTerminalIcon(): { id: string; color?: string } {
        return { id: 'robot', color: 'terminal.ansiGreen' };
    }
}

// CodexAgent implementation (Phase 3)
class CodexAgent extends CodeAgent {
    getTerminalName(sessionName: string): string {
        return `Codex: ${sessionName}`;
    }

    getTerminalIcon(): { id: string; color?: string } {
        return { id: 'terminal-bash', color: 'terminal.ansiBlue' };
    }
}

// Usage in TerminalService (Phase 2)
const terminalName = codeAgent.getTerminalName(taskName);
const iconConfig = codeAgent.getTerminalIcon();

const terminal = vscode.window.createTerminal({
    name: terminalName,
    cwd: worktreePath,
    iconPath: new vscode.ThemeIcon(iconConfig.id),
    color: iconConfig.color ? new vscode.ThemeColor(iconConfig.color) : undefined,
    env: { CLAUDE_CODE_TASK_LIST_ID: taskListId }
});
```

**Source:**
- CodeAgent.ts lines 267-277 (abstract methods)
- TerminalService.ts lines 225-250 (terminal creation)
- Phase 2/3 implementation already satisfies REQ-U3

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| vscode-webview-ui-toolkit | HTML `<select>` with CSS variables | Jan 2025 | Toolkit deprecated, standard HTML is stable and simpler |
| Custom webview state storage | vscode.getState()/setState() | VS Code 1.40+ | Built-in API is faster and automatic |
| Static form that requires reload | Dynamic updates via postMessage | Modern VS Code | Form can update without recreating webview |
| Hardcoded theme colors | CSS variables (--vscode-*) | VS Code 1.30+ | Automatic theme adaptation |

**Deprecated/outdated:**
- vscode-webview-ui-toolkit (deprecated Jan 1, 2025) - use standard HTML elements instead
- Manual state serialization - vscode.getState()/setState() is optimized and automatic
- Polling for state changes - message passing is event-driven and efficient

## Open Questions

1. **Exact dropdown label wording**
   - What we know: User wants full names "Claude Code" and "Codex CLI"
   - What's unclear: Label for the field itself ("Agent", "Code Agent", "CLI Agent")
   - Recommendation: Use "Code Agent" for clarity - indicates it's selecting the AI assistant, not a human agent or other type

2. **State persistence for agent field**
   - What we know: Form state persists via vscode.getState()/setState()
   - What's unclear: Whether agent selection should persist across webview hide/show (within same session, before form clear)
   - Recommendation: YES - persist agent selection for consistency with other form fields (workflow, bypass toggle, etc.)

3. **Agent availability cache invalidation**
   - What we know: Availability checked once at activation
   - What's unclear: Should extension watch for CLI installation/uninstallation during session?
   - Recommendation: NO for Phase 4 - requires extension reload to pick up newly installed CLIs. Could add refresh mechanism in future if needed.

## Sources

### Primary (HIGH confidence)

**Codebase Analysis:**
- `src/SessionFormProvider.ts` - Existing webview form implementation with workflow dropdown, state persistence, message passing
- `src/codeAgents/factory.ts` - Agent factory with isCliAvailable() function
- `src/codeAgents/CodeAgent.ts` - getTerminalName() and getTerminalIcon() already implement REQ-U3
- `src/services/TerminalService.ts` - Terminal creation using CodeAgent methods for names and icons
- `src/test/session/session-form.test.ts` - Test patterns for form HTML generation and message passing

**VS Code Official Documentation:**
- [Webview API](https://code.visualstudio.com/api/extension-guides/webview) - Official webview guide
- [State Persistence](https://code.visualstudio.com/api/extension-guides/webview#persistence) - getState/setState documentation
- [Webview UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews) - Best practices for webview UI

### Secondary (MEDIUM confidence)

**Webview Patterns:**
- [VSCode Webview Lifecycle - Symposium](https://symposium.dev/references/vscode-webview-lifecycle.html) - Webview lifecycle and state management
- [State Persistence - Symposium](https://symposium.dev/design/vscode-extension/state-persistence.html) - State persistence patterns

**Theming:**
- [Code-driven theming](https://www.eliostruyf.com/code-driven-approach-theme-vscode-webview/) - Using VS Code CSS variables in webviews

### Tertiary (LOW confidence)

None - all patterns verified with existing codebase or official documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses existing VS Code webview APIs and HTML/CSS standards
- Architecture: HIGH - Patterns verified against existing SessionFormProvider implementation
- Pitfalls: HIGH - Based on user decisions and common webview gotchas
- Terminal differentiation: HIGH - Already implemented in Phase 2/3 via CodeAgent methods

**Research date:** 2026-02-10
**Valid until:** 30 days (stable domain - VS Code webview APIs, HTML/CSS standards)
