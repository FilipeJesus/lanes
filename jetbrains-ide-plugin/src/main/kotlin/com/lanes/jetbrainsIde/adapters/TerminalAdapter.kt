package com.lanes.jetbrainsIde.adapters

import com.lanes.jetbrainsIde.bridge.BridgeClient
import com.lanes.jetbrainsIde.bridge.TerminalCreateParams
import com.lanes.jetbrainsIde.bridge.TerminalCreateResult
import com.lanes.jetbrainsIde.bridge.TerminalInfo
import com.lanes.jetbrainsIde.bridge.TerminalListParams
import com.lanes.jetbrainsIde.bridge.TerminalListResult
import com.lanes.jetbrainsIde.bridge.TerminalMethods
import com.lanes.jetbrainsIde.bridge.TerminalSendParams
import com.lanes.jetbrainsIde.bridge.TerminalSendResult

/**
 * Adapter for terminal management via the bridge.
 *
 * Delegates to the Node.js bridge for tmux terminal operations.
 * All methods are suspend functions to avoid EDT deadlocks.
 */
class TerminalAdapter(private val client: BridgeClient) {

    /**
     * Create a new terminal for a session.
     *
     * @param sessionName Session name
     * @param command Optional command to run in the terminal
     * @return Terminal information including name and attach command
     */
    suspend fun createTerminal(sessionName: String, command: String? = null): TerminalCreateResult {
        return client.request(
            TerminalMethods.CREATE,
            TerminalCreateParams(sessionName, command),
            TerminalCreateResult::class.java
        )
    }

    /**
     * Send text to a terminal.
     *
     * @param terminalName Terminal name
     * @param text Text to send
     */
    suspend fun sendText(terminalName: String, text: String) {
        client.request(
            TerminalMethods.SEND,
            TerminalSendParams(terminalName, text),
            TerminalSendResult::class.java
        )
    }

    /**
     * List active terminals.
     *
     * @param sessionName Optional session name to filter by
     * @return List of terminal information
     */
    suspend fun listTerminals(sessionName: String? = null): List<TerminalInfo> {
        val result = client.request(
            TerminalMethods.LIST,
            TerminalListParams(sessionName),
            TerminalListResult::class.java
        )
        return result.terminals
    }
}
