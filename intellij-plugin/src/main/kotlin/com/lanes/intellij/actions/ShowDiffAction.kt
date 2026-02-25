package com.lanes.intellij.actions

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.Messages
import com.lanes.intellij.bridge.GitGetDiffParams
import com.lanes.intellij.bridge.GitGetDiffResult
import com.lanes.intellij.bridge.GitMethods
import com.lanes.intellij.services.BridgeProcessManager
import com.lanes.intellij.ui.LanesToolWindowFactory
import kotlinx.coroutines.*

/**
 * Action to show git diff for a selected session.
 * Displays uncommitted and committed changes in a dialog.
 */
class ShowDiffAction : AnAction(
    "Show Diff",
    "Show git diff for this session",
    AllIcons.Actions.Diff
), DumbAware {

    private val logger = Logger.getInstance(ShowDiffAction::class.java)

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

                val result = withContext(Dispatchers.IO) {
                    client.request(
                        GitMethods.GET_DIFF,
                        GitGetDiffParams(sessionName, includeUncommitted = true),
                        GitGetDiffResult::class.java
                    )
                }

                ApplicationManager.getApplication().invokeLater {
                    if (result.diff.isBlank()) {
                        Messages.showInfoMessage(
                            project,
                            "No changes in session '$sessionName'",
                            "Session Diff"
                        )
                    } else {
                        // Truncate if too long
                        val displayDiff = if (result.diff.length > 5000) {
                            result.diff.substring(0, 5000) + "\n\n... (truncated, ${result.diff.length} total characters)"
                        } else {
                            result.diff
                        }

                        Messages.showMessageDialog(
                            project,
                            displayDiff,
                            "Diff for $sessionName",
                            Messages.getInformationIcon()
                        )
                    }
                }
            } catch (ex: Exception) {
                logger.error("Failed to get diff for session: $sessionName", ex)
                ApplicationManager.getApplication().invokeLater {
                    Messages.showErrorDialog(
                        project,
                        "Failed to get diff: ${ex.message}",
                        "Show Diff Failed"
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
