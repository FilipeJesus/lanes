package com.lanes.intellij.actions

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.Messages
import com.lanes.intellij.bridge.SessionMethods
import com.lanes.intellij.bridge.SessionPinParams
import com.lanes.intellij.bridge.SessionPinResult
import com.lanes.intellij.services.BridgeProcessManager
import com.lanes.intellij.ui.LanesToolWindowFactory
import kotlinx.coroutines.*

/**
 * Action to pin a session.
 * Pinned sessions are protected from automatic cleanup.
 */
class PinSessionAction : AnAction(
    "Pin Session",
    "Pin this session to protect it from automatic cleanup",
    AllIcons.General.Pin_tab
), DumbAware {

    private val logger = Logger.getInstance(PinSessionAction::class.java)

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val sessionName = e.getData(LanesToolWindowFactory.SELECTED_SESSION_KEY) ?: return

        CoroutineScope(Dispatchers.Main + SupervisorJob()).launch {
            try {
                val bridgeManager = ApplicationManager.getApplication()
                    .getService(BridgeProcessManager::class.java)
                val workspaceRoot = project.basePath ?: return@launch

                val client = withContext(Dispatchers.IO) {
                    bridgeManager.getClient(workspaceRoot)
                }

                withContext(Dispatchers.IO) {
                    client.request(
                        SessionMethods.PIN,
                        SessionPinParams(sessionName),
                        SessionPinResult::class.java
                    )
                }

                logger.info("Pinned session: $sessionName")
            } catch (ex: Exception) {
                logger.error("Failed to pin session: $sessionName", ex)
                ApplicationManager.getApplication().invokeLater {
                    Messages.showErrorDialog(
                        project,
                        "Failed to pin session: ${ex.message}",
                        "Pin Session Failed"
                    )
                }
            }
        }
    }

    override fun update(e: AnActionEvent) {
        val sessionName = e.getData(LanesToolWindowFactory.SELECTED_SESSION_KEY)
        val isPinned = e.getData(LanesToolWindowFactory.SESSION_IS_PINNED_KEY) ?: false
        e.presentation.isEnabled = e.project != null && sessionName != null && !isPinned
        e.presentation.isVisible = !isPinned
    }
}
