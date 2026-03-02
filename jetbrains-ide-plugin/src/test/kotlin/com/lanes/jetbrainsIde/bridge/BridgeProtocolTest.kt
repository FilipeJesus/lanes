package com.lanes.jetbrainsIde.bridge

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import com.google.gson.Gson
import com.google.gson.JsonObject

/**
 * Unit tests for the Bridge Protocol types.
 * Validates JSON serialization/deserialization of protocol messages.
 */
class BridgeProtocolTest {

    private val gson = Gson()

    @Test
    fun `test JsonRpcRequest serialization`() {
        val params = JsonObject().apply {
            addProperty("includeInactive", true)
        }

        val request = JsonRpcRequest(
            id = 1,
            method = SessionMethods.LIST,
            params = params
        )

        val json = gson.toJson(request)
        assertNotNull(json)
        assertTrue(json.contains("\"method\":\"session.list\""))
        assertTrue(json.contains("\"jsonrpc\":\"2.0\""))
    }

    @Test
    fun `test JsonRpcResponse with result`() {
        val result = gson.toJsonTree(SessionListResult(
            sessions = listOf(
                SessionInfo(
                    name = "test-session",
                    worktreePath = "/path/to/worktree",
                    branch = "feat/test",
                    data = null,
                    status = null,
                    workflowStatus = null,
                    isPinned = false
                )
            )
        ))

        val response = JsonRpcResponse(
            id = 1,
            result = result
        )

        val json = gson.toJson(response)
        assertNotNull(json)
        assertTrue(json.contains("\"result\""))
    }

    @Test
    fun `test JsonRpcResponse with error`() {
        val error = JsonRpcError(
            code = JsonRpcErrorCode.SESSION_NOT_FOUND,
            message = "Session not found",
            data = null
        )

        val response = JsonRpcResponse(
            id = 1,
            error = error
        )

        val json = gson.toJson(response)
        assertNotNull(json)
        assertTrue(json.contains("\"error\""))
        assertTrue(json.contains("Session not found"))
    }

    @Test
    fun `test AgentStatusState enum`() {
        assertEquals("working", AgentStatusState.WORKING.value)
        assertEquals("waiting_for_user", AgentStatusState.WAITING_FOR_USER.value)
        assertEquals("idle", AgentStatusState.IDLE.value)

        assertEquals(AgentStatusState.WORKING, AgentStatusState.fromString("working"))
        assertNull(AgentStatusState.fromString("invalid"))
    }

    @Test
    fun `test TerminalMode backward compatibility mapping`() {
        assertEquals(TerminalMode.VSCODE, TerminalMode.fromString("vscode"))
        assertEquals(TerminalMode.VSCODE, TerminalMode.fromString("code"))
        assertEquals(TerminalMode.TMUX, TerminalMode.fromString("tmux"))
    }

    @Test
    fun `test SessionCreateParams deserialization`() {
        val json = """
            {
                "name": "feat-auth",
                "branch": "feat/auth",
                "workflow": "code-review",
                "agent": "claude",
                "prompt": "Implement authentication"
            }
        """.trimIndent()

        val params = gson.fromJson(json, SessionCreateParams::class.java)

        assertEquals("feat-auth", params.name)
        assertEquals("feat/auth", params.branch)
        assertEquals("code-review", params.workflow)
        assertEquals("claude", params.agent)
        assertEquals("Implement authentication", params.prompt)
    }

    @Test
    fun `test Notification serialization`() {
        val params = gson.toJsonTree(SessionStatusChangedNotification(
            sessionName = "test-session",
            status = AgentSessionStatus(
                status = "working",
                timestamp = "2024-02-25T10:00:00Z"
            )
        )).asJsonObject

        val notification = JsonRpcNotification(
            method = NotificationMethods.SESSION_STATUS_CHANGED,
            params = params
        )

        val json = gson.toJson(notification)
        assertNotNull(json)
        assertTrue(json.contains("\"method\":\"notification.sessionStatusChanged\""))
        assertTrue(json.contains("\"sessionName\":\"test-session\""))
    }

    @Test
    fun `test ConfigKeys constants`() {
        assertEquals("lanes.worktreesFolder", ConfigKeys.WORKTREES_FOLDER)
        assertEquals("lanes.defaultAgent", ConfigKeys.DEFAULT_AGENT)
        assertEquals("lanes.terminalMode", ConfigKeys.TERMINAL_MODE)
    }

    @Test
    fun `test all method constants are defined`() {
        // Session methods
        assertEquals("session.list", SessionMethods.LIST)
        assertEquals("session.create", SessionMethods.CREATE)
        assertEquals("session.delete", SessionMethods.DELETE)

        // Git methods
        assertEquals("git.listBranches", GitMethods.LIST_BRANCHES)
        assertEquals("git.getDiff", GitMethods.GET_DIFF)
        assertEquals("git.getDiffFiles", GitMethods.GET_DIFF_FILES)

        // Workflow methods
        assertEquals("workflow.list", WorkflowMethods.LIST)
        assertEquals("workflow.validate", WorkflowMethods.VALIDATE)

        // Agent methods
        assertEquals("agent.list", AgentMethods.LIST)
        assertEquals("agent.getConfig", AgentMethods.GET_CONFIG)

        // Config methods
        assertEquals("config.get", ConfigMethods.GET)
        assertEquals("config.set", ConfigMethods.SET)

        // Terminal methods
        assertEquals("terminal.create", TerminalMethods.CREATE)
        assertEquals("terminal.send", TerminalMethods.SEND)

        // Notifications
        assertEquals("notification.sessionStatusChanged", NotificationMethods.SESSION_STATUS_CHANGED)
        assertEquals("notification.fileChanged", NotificationMethods.FILE_CHANGED)
    }
}
