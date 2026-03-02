package com.lanes.jetbrainsIde.actions

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.Messages
import com.lanes.jetbrainsIde.bridge.GitGetDiffFilesParams
import com.lanes.jetbrainsIde.bridge.GitGetDiffFilesResult
import com.lanes.jetbrainsIde.bridge.GitMethods
import com.lanes.jetbrainsIde.services.BridgeProcessManager
import com.lanes.jetbrainsIde.services.SessionDiffService
import com.lanes.jetbrainsIde.ui.LanesToolWindowFactory
import kotlinx.coroutines.*

/**
 * Action to show git diff for a selected session in IntelliJ's native diff UI.
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

        val bridgeManager = ApplicationManager.getApplication()
            .getService(BridgeProcessManager::class.java)
        bridgeManager.scope.launch {
            try {
                val workspaceRoot = project.basePath ?: return@launch

                val client = withContext(Dispatchers.IO) {
                    bridgeManager.getClient(workspaceRoot)
                }

                val result = withContext(Dispatchers.IO) {
                    client.request(
                        GitMethods.GET_DIFF_FILES,
                        GitGetDiffFilesParams(sessionName, includeUncommitted = true),
                        GitGetDiffFilesResult::class.java
                    )
                }

                ApplicationManager.getApplication().invokeLater {
                    SessionDiffService.showSessionDiff(project, sessionName, result.files)
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
