package com.lanes.intellij.actions

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.Messages
import com.lanes.intellij.bridge.SessionDeleteParams
import com.lanes.intellij.bridge.SessionDeleteResult
import com.lanes.intellij.bridge.SessionMethods
import com.lanes.intellij.services.BridgeProcessManager
import com.lanes.intellij.ui.LanesToolWindowFactory
import kotlinx.coroutines.*

/**
 * Action to delete a selected session.
 * Shows a confirmation dialog before deleting.
 */
class DeleteSessionAction : AnAction(
    "Delete Session",
    "Delete the selected session and its worktree",
    AllIcons.Actions.Cancel
), DumbAware {

    private val logger = Logger.getInstance(DeleteSessionAction::class.java)

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val sessionName = e.getData(LanesToolWindowFactory.SELECTED_SESSION_KEY) ?: return

        val result = Messages.showYesNoDialog(
            project,
            "Delete session '$sessionName' and its worktree?\n\nThis action cannot be undone.",
            "Delete Session",
            Messages.getWarningIcon()
        )

        if (result == Messages.YES) {
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
                            SessionMethods.DELETE,
                            SessionDeleteParams(sessionName, deleteWorktree = true),
                            SessionDeleteResult::class.java
                        )
                    }

                    logger.info("Deleted session: $sessionName")
                } catch (ex: Exception) {
                    logger.error("Failed to delete session: $sessionName", ex)
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(
                            project,
                            "Failed to delete session: ${ex.message}",
                            "Delete Session Failed"
                        )
                    }
                }
            }
        }
    }

    override fun update(e: AnActionEvent) {
        val sessionName = e.getData(LanesToolWindowFactory.SELECTED_SESSION_KEY)
        e.presentation.isEnabled = e.project != null && sessionName != null
    }
}
