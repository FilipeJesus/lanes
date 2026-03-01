package com.lanes.intellij.actions

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.Messages
import com.lanes.intellij.bridge.SessionMethods
import com.lanes.intellij.bridge.SessionUnpinParams
import com.lanes.intellij.bridge.SessionUnpinResult
import com.lanes.intellij.services.BridgeProcessManager
import com.lanes.intellij.ui.LanesToolWindowFactory
import kotlinx.coroutines.*

/**
 * Action to unpin a session.
 * Unpinning allows the session to be subject to automatic cleanup.
 */
class UnpinSessionAction : AnAction(
    "Unpin Session",
    "Unpin this session to allow automatic cleanup",
    AllIcons.General.Remove
), DumbAware {

    private val logger = Logger.getInstance(UnpinSessionAction::class.java)

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val sessionName = e.getData(LanesToolWindowFactory.SELECTED_SESSION_KEY) ?: return

        val bridgeManager = ApplicationManager.getApplication()
            .getService(BridgeProcessManager::class.java)
        bridgeManager.scope.launch {
            try {
                val workspaceRoot = project.basePath ?: return@launch

                val client = withContext(Dispatchers.IO) {
                    bridgeManager.getClient(workspaceRoot)
                }

                withContext(Dispatchers.IO) {
                    client.request(
                        SessionMethods.UNPIN,
                        SessionUnpinParams(sessionName),
                        SessionUnpinResult::class.java
                    )
                }

                logger.info("Unpinned session: $sessionName")
            } catch (ex: Exception) {
                logger.error("Failed to unpin session: $sessionName", ex)
                ApplicationManager.getApplication().invokeLater {
                    Messages.showErrorDialog(
                        project,
                        "Failed to unpin session: ${ex.message}",
                        "Unpin Session Failed"
                    )
                }
            }
        }
    }

    override fun update(e: AnActionEvent) {
        val sessionName = e.getData(LanesToolWindowFactory.SELECTED_SESSION_KEY)
        val isPinned = e.getData(LanesToolWindowFactory.SESSION_IS_PINNED_KEY) ?: false
        e.presentation.isEnabled = e.project != null && sessionName != null && isPinned
        e.presentation.isVisible = isPinned
    }
}
