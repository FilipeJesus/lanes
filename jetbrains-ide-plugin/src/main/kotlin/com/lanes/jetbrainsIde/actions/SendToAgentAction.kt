package com.lanes.jetbrainsIde.actions

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.Messages
import com.lanes.jetbrainsIde.bridge.*
import com.lanes.jetbrainsIde.services.BridgeProcessManager
import com.lanes.jetbrainsIde.ui.LanesToolWindowFactory
import kotlinx.coroutines.*

/**
 * Action to send text to the agent terminal for a session.
 * Prompts the user for input and sends it to the agent.
 */
class SendToAgentAction : AnAction(
    "Send to Agent",
    "Send a message to the agent terminal",
    AllIcons.Actions.Execute
), DumbAware {

    private val logger = Logger.getInstance(SendToAgentAction::class.java)

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val sessionName = e.getData(LanesToolWindowFactory.SELECTED_SESSION_KEY) ?: return

        val message = Messages.showInputDialog(
            project,
            "Enter message to send to agent:",
            "Send to Agent",
            Messages.getQuestionIcon()
        )

        if (message.isNullOrBlank()) {
            return
        }

        val bridgeManager = ApplicationManager.getApplication()
            .getService(BridgeProcessManager::class.java)
        bridgeManager.scope.launch {
            try {
                val workspaceRoot = project.basePath ?: return@launch

                val client = withContext(Dispatchers.IO) {
                    bridgeManager.getClient(workspaceRoot)
                }

                // First, get the terminal name for this session
                val terminals = withContext(Dispatchers.IO) {
                    client.request(
                        TerminalMethods.LIST,
                        TerminalListParams(sessionName),
                        TerminalListResult::class.java
                    )
                }

                if (terminals.terminals.isEmpty()) {
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(
                            project,
                            "No active terminal found for session '$sessionName'",
                            "Send to Agent Failed"
                        )
                    }
                    return@launch
                }

                val terminalName = terminals.terminals.first().name

                // Send the message to the terminal
                withContext(Dispatchers.IO) {
                    client.request(
                        TerminalMethods.SEND,
                        TerminalSendParams(terminalName, message + "\n"),
                        TerminalSendResult::class.java
                    )
                }

                logger.info("Sent message to agent for session: $sessionName")
            } catch (ex: Exception) {
                logger.error("Failed to send message to agent: $sessionName", ex)
                ApplicationManager.getApplication().invokeLater {
                    Messages.showErrorDialog(
                        project,
                        "Failed to send message: ${ex.message}",
                        "Send to Agent Failed"
                    )
                }
            }
        }
    }

    override fun update(e: AnActionEvent) {
        val sessionName = e.getData(LanesToolWindowFactory.SELECTED_SESSION_KEY)
        e.presentation.isEnabled = e.project != null && sessionName != null
    }
}
