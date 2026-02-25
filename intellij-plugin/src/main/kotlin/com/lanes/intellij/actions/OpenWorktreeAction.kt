package com.lanes.intellij.actions

import com.intellij.icons.AllIcons
import com.intellij.ide.actions.RevealFileAction
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.Messages
import com.lanes.intellij.bridge.SessionInfo
import com.lanes.intellij.bridge.SessionListParams
import com.lanes.intellij.bridge.SessionListResult
import com.lanes.intellij.bridge.SessionMethods
import com.lanes.intellij.services.BridgeProcessManager
import com.lanes.intellij.ui.LanesToolWindowFactory
import kotlinx.coroutines.*
import java.io.File

/**
 * Action to open the selected session's worktree directory.
 * Uses the platform's file browser to reveal the directory.
 */
class OpenWorktreeAction : AnAction(
    "Open Worktree",
    "Open the session's worktree directory in file browser",
    AllIcons.Actions.MenuOpen
), DumbAware {

    private val logger = Logger.getInstance(OpenWorktreeAction::class.java)

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
                        SessionMethods.LIST,
                        SessionListParams(includeInactive = true),
                        SessionListResult::class.java
                    )
                }

                val session = result.sessions.find { it.name == sessionName }
                if (session != null) {
                    val worktreeFile = File(session.worktreePath)
                    if (worktreeFile.exists()) {
                        // Reveal in file browser
                        ApplicationManager.getApplication().invokeLater {
                            RevealFileAction.openDirectory(worktreeFile)
                        }
                    } else {
                        ApplicationManager.getApplication().invokeLater {
                            Messages.showErrorDialog(
                                project,
                                "Worktree directory does not exist: ${session.worktreePath}",
                                "Worktree Not Found"
                            )
                        }
                    }
                }
            } catch (ex: Exception) {
                logger.error("Failed to open worktree for session: $sessionName", ex)
                ApplicationManager.getApplication().invokeLater {
                    Messages.showErrorDialog(
                        project,
                        "Failed to open worktree: ${ex.message}",
                        "Open Worktree Failed"
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
