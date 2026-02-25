package com.lanes.intellij.bridge

import com.google.gson.JsonElement
import com.google.gson.JsonObject

/**
 * JSON-RPC 2.0 Bridge Protocol for Lanes IntelliJ Plugin
 *
 * This file defines the complete protocol specification for communication between
 * the IntelliJ plugin (Kotlin) and the Node.js bridge process (wrapping src/core/ and src/mcp/).
 *
 * The protocol uses JSON-RPC 2.0 over stdio. All messages are newline-delimited JSON.
 *
 * Architecture:
 * - IntelliJ Plugin (Kotlin) <--> Node.js Bridge Process <--> Core Services
 * - Communication: stdio (stdin/stdout)
 * - Format: JSON-RPC 2.0
 * - Transport: Newline-delimited JSON
 */

// =============================================================================
// JSON-RPC 2.0 Base Types
// =============================================================================

/**
 * JSON-RPC 2.0 Request
 * Sent from client to server to invoke a method.
 */
data class JsonRpcRequest(
    val jsonrpc: String = "2.0",
    val id: Int,
    val method: String,
    val params: JsonObject? = null
)

/**
 * JSON-RPC 2.0 Response
 * Sent from server to client as a reply to a request.
 */
data class JsonRpcResponse(
    val jsonrpc: String = "2.0",
    val id: Int? = null,
    val result: JsonElement? = null,
    val error: JsonRpcError? = null
)

/**
 * JSON-RPC 2.0 Error
 * Included in response when an error occurs.
 */
data class JsonRpcError(
    val code: Int,
    val message: String,
    val data: JsonElement? = null
)

/**
 * JSON-RPC 2.0 Notification
 * Sent from server to client without expecting a response.
 */
data class JsonRpcNotification(
    val jsonrpc: String = "2.0",
    val method: String,
    val params: JsonObject? = null
)

// =============================================================================
// Standard JSON-RPC Error Codes
// =============================================================================

object JsonRpcErrorCode {
    const val PARSE_ERROR = -32700
    const val INVALID_REQUEST = -32600
    const val METHOD_NOT_FOUND = -32601
    const val INVALID_PARAMS = -32602
    const val INTERNAL_ERROR = -32603

    // Application-specific error codes (outside JSON-RPC reserved range)
    const val GIT_ERROR = 1001
    const val VALIDATION_ERROR = 1002
    const val SESSION_NOT_FOUND = 1003
    const val WORKFLOW_ERROR = 1004
    const val AGENT_NOT_AVAILABLE = 1005
}

// =============================================================================
// Core Type Definitions (mirrored from TypeScript)
// =============================================================================

/**
 * Agent status states
 */
enum class AgentStatusState(val value: String) {
    WORKING("working"),
    WAITING_FOR_USER("waiting_for_user"),
    ACTIVE("active"),
    IDLE("idle"),
    ERROR("error");

    companion object {
        fun fromString(value: String): AgentStatusState? {
            return entries.find { it.value == value }
        }
    }
}

/**
 * Terminal mode options
 */
enum class TerminalMode(val value: String) {
    CODE("code"),
    TMUX("tmux");

    companion object {
        fun fromString(value: String): TerminalMode? {
            return entries.find { it.value == value }
        }
    }
}

/**
 * Agent session data
 */
data class AgentSessionData(
    val sessionId: String,
    val timestamp: String? = null,
    val workflow: String? = null,
    val permissionMode: String? = null,
    val agentName: String? = null,
    val isChimeEnabled: Boolean? = null,
    val taskListId: String? = null,
    val terminal: String? = null, // "code" or "tmux"
    val logPath: String? = null
)

/**
 * Agent session status
 */
data class AgentSessionStatus(
    val status: String,
    val timestamp: String? = null,
    val message: String? = null
) {
    /** Parse status string to enum for type-safe comparisons */
    fun statusEnum(): AgentStatusState? = AgentStatusState.fromString(status)
}

/**
 * Workflow status information
 */
data class WorkflowStatus(
    val active: Boolean,
    val workflow: String? = null,
    val step: String? = null,
    val progress: String? = null,
    val summary: String? = null
)

/**
 * Session information (combines data and status)
 */
data class SessionInfo(
    val name: String,
    val worktreePath: String,
    val branch: String,
    val data: AgentSessionData?,
    val status: AgentSessionStatus?,
    val workflowStatus: WorkflowStatus?,
    val isPinned: Boolean = false
)

/**
 * Workflow template metadata
 */
data class WorkflowTemplate(
    val name: String,
    val path: String,
    val description: String? = null,
    val isBuiltin: Boolean = false
)

/**
 * Code agent configuration
 */
data class CodeAgentConfig(
    val name: String,
    val displayName: String,
    val cliCommand: String,
    val sessionFileExtension: String? = null,
    val statusFileExtension: String? = null,
    val logoSvg: String? = null,
    val permissionModes: List<PermissionMode> = emptyList()
)

/**
 * Permission mode configuration
 */
data class PermissionMode(
    val id: String,
    val label: String,
    val flag: String? = null
)

/**
 * Git branch information
 */
data class BranchInfo(
    val name: String,
    val isCurrent: Boolean = false
)

/**
 * Git worktree information
 */
data class WorktreeInfo(
    val path: String,
    val branch: String,
    val commit: String? = null
)

/**
 * Broken worktree information
 */
data class BrokenWorktreeInfo(
    val sessionName: String,
    val worktreePath: String,
    val reason: String
)

/**
 * Repair result
 */
data class RepairResult(
    val successCount: Int,
    val failures: List<RepairFailure>
)

/**
 * Repair failure
 */
data class RepairFailure(
    val sessionName: String,
    val error: String
)

/**
 * Terminal information
 */
data class TerminalInfo(
    val name: String,
    val sessionName: String,
    val cwd: String
)

// =============================================================================
// Session Management Methods
// =============================================================================

object SessionMethods {
    const val LIST = "session.list"
    const val CREATE = "session.create"
    const val DELETE = "session.delete"
    const val CLEAR = "session.clear"
    const val GET_STATUS = "session.getStatus"
    const val OPEN = "session.open"
    const val PIN = "session.pin"
    const val UNPIN = "session.unpin"
}

/**
 * session.list - List all sessions (active + previous)
 */
data class SessionListParams(
    val includeInactive: Boolean = true
)

data class SessionListResult(
    val sessions: List<SessionInfo>
)

/**
 * session.create - Create new session
 */
data class SessionCreateParams(
    val name: String,
    val branch: String,
    val workflow: String? = null,
    val agent: String? = null,
    val prompt: String? = null,
    val attachments: List<String>? = null,
    val permissionMode: String? = null
)

data class SessionCreateResult(
    val sessionName: String,
    val worktreePath: String,
    val sessionId: String
)

/**
 * session.delete - Delete session and optionally its worktree
 */
data class SessionDeleteParams(
    val sessionName: String,
    val deleteWorktree: Boolean = true
)

data class SessionDeleteResult(
    val success: Boolean
)

/**
 * session.clear - Clear session conversation
 */
data class SessionClearParams(
    val sessionName: String
)

data class SessionClearResult(
    val success: Boolean
)

/**
 * session.getStatus - Get session status
 */
data class SessionGetStatusParams(
    val sessionName: String
)

data class SessionGetStatusResult(
    val status: AgentSessionStatus?,
    val workflowStatus: WorkflowStatus?
)

/**
 * session.open - Open/resume a session
 */
data class SessionOpenParams(
    val sessionName: String
)

data class SessionOpenResult(
    val success: Boolean
)

/**
 * session.pin - Pin a session
 */
data class SessionPinParams(
    val sessionName: String
)

data class SessionPinResult(
    val success: Boolean
)

/**
 * session.unpin - Unpin a session
 */
data class SessionUnpinParams(
    val sessionName: String
)

data class SessionUnpinResult(
    val success: Boolean
)

// =============================================================================
// Git Operations Methods
// =============================================================================

object GitMethods {
    const val LIST_BRANCHES = "git.listBranches"
    const val GET_DIFF = "git.getDiff"
    const val GET_WORKTREE_INFO = "git.getWorktreeInfo"
    const val REPAIR_WORKTREES = "git.repairWorktrees"
}

/**
 * git.listBranches - List available branches
 */
data class GitListBranchesParams(
    val includeRemote: Boolean = false
)

data class GitListBranchesResult(
    val branches: List<BranchInfo>
)

/**
 * git.getDiff - Get diff for a session vs base branch
 */
data class GitGetDiffParams(
    val sessionName: String,
    val includeUncommitted: Boolean = true
)

data class GitGetDiffResult(
    val diff: String
)

/**
 * git.getWorktreeInfo - Get worktree path and status
 */
data class GitGetWorktreeInfoParams(
    val sessionName: String
)

data class GitGetWorktreeInfoResult(
    val worktree: WorktreeInfo?
)

/**
 * git.repairWorktrees - Repair broken worktrees
 */
data class GitRepairWorktreesParams(
    val detectOnly: Boolean = false
)

data class GitRepairWorktreesResult(
    val broken: List<BrokenWorktreeInfo>,
    val repairResult: RepairResult? = null
)

// =============================================================================
// Workflow Methods
// =============================================================================

object WorkflowMethods {
    const val LIST = "workflow.list"
    const val VALIDATE = "workflow.validate"
    const val CREATE = "workflow.create"
    const val GET_STATE = "workflow.getState"
}

/**
 * workflow.list - List available workflow templates
 */
data class WorkflowListParams(
    val includeBuiltin: Boolean = true,
    val includeCustom: Boolean = true
)

data class WorkflowListResult(
    val workflows: List<WorkflowTemplate>
)

/**
 * workflow.validate - Validate a workflow template
 */
data class WorkflowValidateParams(
    val workflowPath: String
)

data class WorkflowValidateResult(
    val isValid: Boolean,
    val errors: List<String> = emptyList()
)

/**
 * workflow.create - Create new workflow template
 */
data class WorkflowCreateParams(
    val name: String,
    val content: String
)

data class WorkflowCreateResult(
    val path: String
)

/**
 * workflow.getState - Get workflow state for a session
 */
data class WorkflowGetStateParams(
    val sessionName: String
)

data class WorkflowGetStateResult(
    val state: JsonObject? = null
)

// =============================================================================
// Agent Methods
// =============================================================================

object AgentMethods {
    const val LIST = "agent.list"
    const val GET_CONFIG = "agent.getConfig"
}

/**
 * agent.list - List available code agents
 */
data class AgentListParams(
    val checkAvailability: Boolean = false
)

data class AgentListResult(
    val agents: List<CodeAgentConfig>
)

/**
 * agent.getConfig - Get agent configuration
 */
data class AgentGetConfigParams(
    val agentName: String
)

data class AgentGetConfigResult(
    val config: CodeAgentConfig?
)

// =============================================================================
// Configuration Methods
// =============================================================================

object ConfigMethods {
    const val GET = "config.get"
    const val SET = "config.set"
    const val GET_ALL = "config.getAll"
}

/**
 * Configuration keys (from package.json)
 */
object ConfigKeys {
    const val WORKTREES_FOLDER = "lanes.worktreesFolder"
    const val PROMPTS_FOLDER = "lanes.promptsFolder"
    const val DEFAULT_AGENT = "lanes.defaultAgent"
    const val BASE_BRANCH = "lanes.baseBranch"
    const val INCLUDE_UNCOMMITTED_CHANGES = "lanes.includeUncommittedChanges"
    const val USE_GLOBAL_STORAGE = "lanes.useGlobalStorage"
    const val LOCAL_SETTINGS_PROPAGATION = "lanes.localSettingsPropagation"
    const val WORKFLOWS_ENABLED = "lanes.workflowsEnabled"
    const val CUSTOM_WORKFLOWS_FOLDER = "lanes.customWorkflowsFolder"
    const val CHIME_SOUND = "lanes.chimeSound"
    const val POLLING_QUIET_THRESHOLD_MS = "lanes.polling.quietThresholdMs"
    const val TERMINAL_MODE = "lanes.terminalMode"
}

/**
 * config.get - Get configuration value
 */
data class ConfigGetParams(
    val key: String
)

data class ConfigGetResult(
    val value: JsonElement?
)

/**
 * config.set - Set configuration value
 */
data class ConfigSetParams(
    val key: String,
    val value: JsonElement
)

data class ConfigSetResult(
    val success: Boolean
)

/**
 * config.getAll - Get all configuration
 */
data class ConfigGetAllParams(
    val prefix: String? = null // e.g., "lanes." to get all lanes settings
)

data class ConfigGetAllResult(
    val config: JsonObject
)

// =============================================================================
// Terminal Methods
// =============================================================================

object TerminalMethods {
    const val CREATE = "terminal.create"
    const val SEND = "terminal.send"
    const val LIST = "terminal.list"
}

/**
 * terminal.create - Create tmux terminal for session
 */
data class TerminalCreateParams(
    val sessionName: String,
    val command: String? = null
)

data class TerminalCreateResult(
    val terminalName: String,
    val attachCommand: String? = null // Only for tmux mode
)

/**
 * terminal.send - Send text to terminal
 */
data class TerminalSendParams(
    val terminalName: String,
    val text: String
)

data class TerminalSendResult(
    val success: Boolean
)

/**
 * terminal.list - List active terminals
 */
data class TerminalListParams(
    val sessionName: String? = null // Filter by session
)

data class TerminalListResult(
    val terminals: List<TerminalInfo>
)

// =============================================================================
// UI Methods (Bridge -> Plugin, reverse RPC)
// =============================================================================

/**
 * UI methods are "reverse RPC" — requests sent FROM the Node.js bridge TO the
 * IntelliJ plugin when the core needs to show a dialog or collect user input.
 */
object UIMethods {
    const val SHOW_INFO = "ui.showInfo"
    const val SHOW_WARNING = "ui.showWarning"
    const val SHOW_ERROR = "ui.showError"
    const val SHOW_QUICK_PICK = "ui.showQuickPick"
    const val SHOW_INPUT_BOX = "ui.showInputBox"
}

/**
 * ui.showInfo / ui.showWarning / ui.showError - Show message dialog
 */
data class UIShowMessageParams(
    val message: String,
    val actions: List<String> = emptyList()
)

data class UIShowMessageResult(
    val selectedAction: String? = null
)

/**
 * Quick pick item (mirrors IUIProvider.QuickPickItem)
 */
data class QuickPickItem(
    val label: String,
    val description: String? = null,
    val detail: String? = null,
    val picked: Boolean = false
)

/**
 * ui.showQuickPick - Show selection dialog
 */
data class UIShowQuickPickParams(
    val items: List<QuickPickItem>,
    val placeHolder: String? = null,
    val title: String? = null,
    val canPickMany: Boolean = false
)

data class UIShowQuickPickResult(
    val selectedItem: QuickPickItem? = null
)

/**
 * ui.showInputBox - Show input dialog
 */
data class UIShowInputBoxParams(
    val prompt: String? = null,
    val placeHolder: String? = null,
    val value: String? = null,
    val title: String? = null
)

data class UIShowInputBoxResult(
    val value: String? = null
)

// =============================================================================
// Storage Methods (Bridge -> Plugin, reverse RPC)
// =============================================================================

/**
 * Storage methods are "reverse RPC" — the Node.js bridge asks the IntelliJ
 * plugin to read/write persistent state.
 */
object StorageMethods {
    const val GET_GLOBAL_PATH = "storage.getGlobalPath"
    const val GET_STATE = "storage.getState"
    const val SET_STATE = "storage.setState"
}

data class StorageGetGlobalPathResult(
    val path: String
)

data class StorageGetStateParams(
    val key: String,
    val defaultValue: JsonElement? = null
)

data class StorageGetStateResult(
    val value: JsonElement?
)

data class StorageSetStateParams(
    val key: String,
    val value: JsonElement
)

data class StorageSetStateResult(
    val success: Boolean
)

// =============================================================================
// File Watcher Methods (Bridge -> Plugin, reverse RPC)
// =============================================================================

/**
 * File watcher methods are "reverse RPC" — the Node.js bridge asks the
 * IntelliJ plugin to set up file system watches.
 */
object FileWatcherMethods {
    const val WATCH = "fileWatcher.watch"
    const val UNWATCH = "fileWatcher.unwatch"
}

data class FileWatcherWatchParams(
    val basePath: String,
    val pattern: String
)

data class FileWatcherWatchResult(
    val watchId: String
)

data class FileWatcherUnwatchParams(
    val watchId: String
)

data class FileWatcherUnwatchResult(
    val success: Boolean
)

// =============================================================================
// Notification Methods (Server -> Client)
// =============================================================================

object NotificationMethods {
    const val SESSION_STATUS_CHANGED = "notification.sessionStatusChanged"
    const val FILE_CHANGED = "notification.fileChanged"
    const val SESSION_CREATED = "notification.sessionCreated"
    const val SESSION_DELETED = "notification.sessionDeleted"
}

/**
 * notification.sessionStatusChanged - Session status update
 */
data class SessionStatusChangedNotification(
    val sessionName: String,
    val status: AgentSessionStatus
)

/**
 * File event types for file watcher notifications
 */
enum class FileEventType(val value: String) {
    CREATED("created"),
    CHANGED("changed"),
    DELETED("deleted");

    companion object {
        fun fromString(value: String): FileEventType? {
            return entries.find { it.value == value }
        }
    }
}

/**
 * notification.fileChanged - File watcher event
 */
data class FileChangedNotification(
    val path: String,
    val eventType: String
) {
    fun eventTypeEnum(): FileEventType? = FileEventType.fromString(eventType)
}

/**
 * notification.sessionCreated - New session was created (from MCP)
 */
data class SessionCreatedNotification(
    val sessionName: String,
    val worktreePath: String
)

/**
 * notification.sessionDeleted - Session was deleted
 */
data class SessionDeletedNotification(
    val sessionName: String
)

// =============================================================================
// Protocol Version and Initialization
// =============================================================================

object BridgeProtocol {
    const val VERSION = "0.1.0"

    /**
     * Initialize request - First message from client to server
     * Server responds with its capabilities and version
     */
    const val INITIALIZE = "initialize"

    data class InitializeParams(
        val clientVersion: String,
        val workspaceRoot: String
    )

    data class InitializeResult(
        val serverVersion: String,
        val protocolVersion: String,
        val capabilities: ServerCapabilities
    )

    data class ServerCapabilities(
        val supportsWorkflows: Boolean = true,
        val supportsTmux: Boolean = false, // Detected at runtime
        val supportedAgents: List<String> = emptyList()
    )

    /**
     * Shutdown request - Client notifies server it's shutting down
     */
    const val SHUTDOWN = "shutdown"

    data class ShutdownParams(
        val reason: String? = null
    )

    data class ShutdownResult(
        val success: Boolean
    )
}
