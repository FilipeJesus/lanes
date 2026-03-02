package com.lanes.jetbrainsIde.ui

import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.*
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.ui.PopupHandler
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.treeStructure.Tree
import com.lanes.jetbrainsIde.bridge.*
import com.lanes.jetbrainsIde.services.BridgeProcessManager
import com.lanes.jetbrainsIde.services.SessionDiffService
import com.lanes.jetbrainsIde.services.SessionTerminalService
import kotlinx.coroutines.*
import java.awt.BorderLayout
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.*
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeCellRenderer
import javax.swing.tree.DefaultTreeModel

/**
 * Tree panel displaying all Claude Code sessions.
 *
 * Features:
 * - Sessions with worktrees shown in a single list
 * - Custom cell renderer with status icons
 * - Right-click context menu (resume, delete, open worktree)
 * - Auto-refresh on bridge notifications
 * - Toolbar with New Session and Refresh actions
 */
class SessionsTreePanel(private val project: Project) : JPanel(BorderLayout()), Disposable, DataProvider {

    private val logger = Logger.getInstance(SessionsTreePanel::class.java)
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val rootNode = DefaultMutableTreeNode("Sessions")
    private val sessionsNode = DefaultMutableTreeNode("Sessions")
    private val treeModel = DefaultTreeModel(rootNode)
    private val tree = Tree(treeModel)

    private val refreshInProgress = AtomicBoolean(false)
    private var pollingJob: Job? = null

    init {
        setupTree()
        setupToolbar()
        loadSessions()
        startStatusPolling()
    }

    private fun setupTree() {
        rootNode.add(sessionsNode)

        tree.isRootVisible = false
        tree.showsRootHandles = true
        tree.cellRenderer = SessionTreeCellRenderer()

        // Context menu
        tree.addMouseListener(object : PopupHandler() {
            override fun invokePopup(comp: java.awt.Component, x: Int, y: Int) {
                val path = tree.getPathForLocation(x, y)
                if (path != null) {
                    tree.selectionPath = path
                    val node = path.lastPathComponent as? DefaultMutableTreeNode
                    val sessionInfo = node?.userObject as? SessionInfo
                    if (sessionInfo != null) {
                        showContextMenu(comp, x, y, sessionInfo)
                    }
                }
            }
        })

        // Double-click to open worktree
        tree.addMouseListener(object : java.awt.event.MouseAdapter() {
            override fun mouseClicked(e: java.awt.event.MouseEvent) {
                if (e.clickCount == 2) {
                    val path = tree.getPathForLocation(e.x, e.y)
                    if (path != null) {
                        val node = path.lastPathComponent as? DefaultMutableTreeNode
                        val sessionInfo = node?.userObject as? SessionInfo
                        if (sessionInfo != null) {
                            resumeSession(sessionInfo)
                        }
                    }
                }
            }
        })

        add(JBScrollPane(tree), BorderLayout.CENTER)
    }

    private fun setupToolbar() {
        val toolbar = ActionManager.getInstance().createActionToolbar(
            "LanesSessionsToolbar",
            createToolbarActionGroup(),
            true
        )
        toolbar.targetComponent = this
        add(toolbar.component, BorderLayout.NORTH)
    }

    private fun createToolbarActionGroup(): ActionGroup {
        return DefaultActionGroup().apply {
            add(object : AnAction("New Session", "Create a new session", AllIcons.General.Add) {
                override fun actionPerformed(e: AnActionEvent) {
                    showCreateSessionDialog()
                }
            })
            add(object : AnAction("Add Workflow", "Create a workflow from a template", AllIcons.FileTypes.Text) {
                override fun actionPerformed(e: AnActionEvent) {
                    showCreateWorkflowDialog()
                }
            })
            add(object : AnAction("Refresh", "Refresh sessions list", AllIcons.Actions.Refresh) {
                override fun actionPerformed(e: AnActionEvent) {
                    loadSessions()
                }
            })
        }
    }

    private fun showContextMenu(comp: java.awt.Component, x: Int, y: Int, sessionInfo: SessionInfo) {
        val actionGroup = DefaultActionGroup()

        actionGroup.add(object : AnAction("Delete Session") {
            override fun actionPerformed(e: AnActionEvent) {
                deleteSession(sessionInfo)
            }
        })

        actionGroup.addSeparator()

        actionGroup.add(object : AnAction("Open Worktree") {
            override fun actionPerformed(e: AnActionEvent) {
                openWorktree(sessionInfo)
            }
        })

        actionGroup.add(object : AnAction("Show Diff") {
            override fun actionPerformed(e: AnActionEvent) {
                showDiff(sessionInfo)
            }
        })
        actionGroup.add(object : AnAction("Open Workflow State") {
            override fun actionPerformed(e: AnActionEvent) {
                openWorkflowState(sessionInfo)
            }
        })

        val popupMenu = ActionManager.getInstance().createActionPopupMenu("LanesSessionContext", actionGroup)
        popupMenu.component.show(comp, x, y)
    }

    private fun loadSessions() {
        scope.launch {
            if (!refreshInProgress.compareAndSet(false, true)) {
                return@launch
            }
            try {
                val bridgeManager = ApplicationManager.getApplication().getService(BridgeProcessManager::class.java)
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

                // Update tree atomically on EDT with the new data
                val newSessions = result.sessions
                ApplicationManager.getApplication().invokeLater {
                    rebuildTree(newSessions)
                }
            } catch (e: Exception) {
                logger.error("Failed to load sessions", e)
                showError("Failed to load sessions: ${e.message}")
            } finally {
                refreshInProgress.set(false)
            }
        }
    }

    private fun startStatusPolling() {
        pollingJob = scope.launch {
            while (isActive) {
                delay(10_000)
                loadSessions()
            }
        }
    }

    /**
     * Rebuild the tree model with the given sessions.
     * Must be called on EDT.
     */
    private fun rebuildTree(sessions: List<SessionInfo>) {
        val selectedName = (tree.selectionPath?.lastPathComponent as? DefaultMutableTreeNode)
            ?.userObject?.let { (it as? SessionInfo)?.name }

        sessionsNode.removeAllChildren()

        for (session in sessions) {
            // In IntelliJ we surface sessions by worktree presence; status is icon-only.
            if (session.worktreePath.isNotBlank()) {
                sessionsNode.add(DefaultMutableTreeNode(session))
            } else {
                logger.debug("Skipping session without worktree path: ${session.name}")
            }
        }

        treeModel.reload()
        expandAll()

        // Restore selection
        if (selectedName != null) {
            for (i in 0 until sessionsNode.childCount) {
                val child = sessionsNode.getChildAt(i) as? DefaultMutableTreeNode
                if ((child?.userObject as? SessionInfo)?.name == selectedName) {
                    tree.selectionPath = javax.swing.tree.TreePath(child.path)
                    break
                }
            }
        }
    }

    private fun expandAll() {
        var i = 0
        while (i < tree.rowCount) {
            tree.expandRow(i)
            i++
        }
    }

    private fun showCreateSessionDialog() {
        val dialog = CreateSessionDialog(project)
        if (dialog.showAndGet()) {
            loadSessions()
        }
    }

    private fun showCreateWorkflowDialog() {
        val dialog = CreateWorkflowDialog(project)
        dialog.show()
    }

    private fun resumeSession(sessionInfo: SessionInfo) {
        scope.launch {
            try {
                val client = getClient() ?: return@launch

                val openResult = withContext(Dispatchers.IO) {
                    client.request(
                        SessionMethods.OPEN,
                        SessionOpenParams(sessionInfo.name),
                        SessionOpenResult::class.java
                    )
                }

                SessionTerminalService.openSessionTerminal(
                    project = project,
                    sessionName = sessionInfo.name,
                    worktreePath = openResult.worktreePath ?: sessionInfo.worktreePath,
                    command = openResult.command
                )

                loadSessions()
            } catch (e: Exception) {
                logger.error("Failed to resume session", e)
                showError("Failed to resume session: ${e.message}")
            }
        }
    }

    private fun deleteSession(sessionInfo: SessionInfo) {
        val result = Messages.showYesNoDialog(
            project,
            "Delete session '${sessionInfo.name}' and its worktree?",
            "Delete Session",
            Messages.getWarningIcon()
        )

        if (result == Messages.YES) {
            scope.launch {
                try {
                    val client = getClient() ?: return@launch

                    withContext(Dispatchers.IO) {
                        client.request(
                            SessionMethods.DELETE,
                            SessionDeleteParams(sessionInfo.name, deleteWorktree = true),
                            SessionDeleteResult::class.java
                        )
                    }

                    loadSessions()
                } catch (e: Exception) {
                    logger.error("Failed to delete session", e)
                    showError("Failed to delete session: ${e.message}")
                }
            }
        }
    }

    private fun openWorktree(sessionInfo: SessionInfo) {
        val worktreeFile = File(sessionInfo.worktreePath)
        if (worktreeFile.exists()) {
            SessionTerminalService.openWorktreeTerminal(
                project = project,
                sessionName = sessionInfo.name,
                worktreePath = sessionInfo.worktreePath
            )
        } else {
            showError("Worktree directory does not exist: ${sessionInfo.worktreePath}")
        }
    }

    private fun openWorkflowState(sessionInfo: SessionInfo) {
        val worktreeFile = File(sessionInfo.worktreePath)
        if (!worktreeFile.exists()) {
            showError("Worktree path does not exist: ${sessionInfo.worktreePath}")
            return
        }

        val workflowStateFile = File(worktreeFile, "workflow-state.json")
        if (!workflowStateFile.exists()) {
            showInfo("No active workflow for session '${sessionInfo.name}'. The workflow state file is created when a workflow is started.")
            return
        }

        ApplicationManager.getApplication().invokeLater {
            val normalized = workflowStateFile.absolutePath.replace('\\', '/')
            val vFile = LocalFileSystem.getInstance().refreshAndFindFileByPath(normalized)
            if (vFile == null) {
                showError("Failed to open workflow state: ${workflowStateFile.absolutePath}")
                return@invokeLater
            }
            FileEditorManager.getInstance(project).openFile(vFile, true)
        }
    }

    private fun showDiff(sessionInfo: SessionInfo) {
        scope.launch {
            try {
                val client = getClient() ?: return@launch

                val result = withContext(Dispatchers.IO) {
                    client.request(
                        GitMethods.GET_DIFF_FILES,
                        GitGetDiffFilesParams(sessionInfo.name, includeUncommitted = true),
                        GitGetDiffFilesResult::class.java
                    )
                }

                ApplicationManager.getApplication().invokeLater {
                    SessionDiffService.showSessionDiff(project, sessionInfo.name, result.files)
                }
            } catch (e: Exception) {
                logger.error("Failed to get diff", e)
                showError("Failed to get diff: ${e.message}")
            }
        }
    }

    private fun pinSession(sessionInfo: SessionInfo) {
        scope.launch {
            try {
                val client = getClient() ?: return@launch

                withContext(Dispatchers.IO) {
                    client.request(
                        SessionMethods.PIN,
                        SessionPinParams(sessionInfo.name),
                        SessionPinResult::class.java
                    )
                }

                loadSessions()
            } catch (e: Exception) {
                logger.error("Failed to pin session", e)
                showError("Failed to pin session: ${e.message}")
            }
        }
    }

    private fun unpinSession(sessionInfo: SessionInfo) {
        scope.launch {
            try {
                val client = getClient() ?: return@launch

                withContext(Dispatchers.IO) {
                    client.request(
                        SessionMethods.UNPIN,
                        SessionUnpinParams(sessionInfo.name),
                        SessionUnpinResult::class.java
                    )
                }

                loadSessions()
            } catch (e: Exception) {
                logger.error("Failed to unpin session", e)
                showError("Failed to unpin session: ${e.message}")
            }
        }
    }

    private suspend fun getClient(): BridgeClient? {
        val bridgeManager = ApplicationManager.getApplication().getService(BridgeProcessManager::class.java)
        val workspaceRoot = project.basePath ?: return null
        return withContext(Dispatchers.IO) {
            bridgeManager.getClient(workspaceRoot)
        }
    }

    private fun showError(message: String) {
        ApplicationManager.getApplication().invokeLater {
            Messages.showErrorDialog(project, message, "Error")
        }
    }

    private fun showInfo(message: String) {
        ApplicationManager.getApplication().invokeLater {
            Messages.showInfoMessage(project, message, "Information")
        }
    }

    override fun dispose() {
        pollingJob?.cancel()
        pollingJob = null
        scope.cancel()
    }

    override fun getData(dataId: String): Any? {
        return when {
            LanesToolWindowFactory.SELECTED_SESSION_KEY.`is`(dataId) -> {
                val path = tree.selectionPath ?: return null
                val node = path.lastPathComponent as? DefaultMutableTreeNode ?: return null
                val sessionInfo = node.userObject as? SessionInfo ?: return null
                sessionInfo.name
            }
            LanesToolWindowFactory.SESSION_IS_PINNED_KEY.`is`(dataId) -> {
                val path = tree.selectionPath ?: return null
                val node = path.lastPathComponent as? DefaultMutableTreeNode ?: return null
                val sessionInfo = node.userObject as? SessionInfo ?: return null
                sessionInfo.isPinned
            }
            LanesToolWindowFactory.REFRESH_CALLBACK_KEY.`is`(dataId) -> {
                { loadSessions() }
            }
            else -> null
        }
    }
}

/**
 * Custom tree cell renderer for session nodes.
 */
private class SessionTreeCellRenderer : DefaultTreeCellRenderer() {
    override fun getTreeCellRendererComponent(
        tree: JTree,
        value: Any?,
        sel: Boolean,
        expanded: Boolean,
        leaf: Boolean,
        row: Int,
        hasFocus: Boolean
    ): java.awt.Component {
        super.getTreeCellRendererComponent(tree, value, sel, expanded, leaf, row, hasFocus)

        val node = value as? DefaultMutableTreeNode
        val sessionInfo = node?.userObject as? SessionInfo

        if (sessionInfo != null) {
            icon = when (sessionInfo.status?.statusEnum()) {
                AgentStatusState.ACTIVE, AgentStatusState.WORKING -> AllIcons.RunConfigurations.TestState.Run
                AgentStatusState.WAITING_FOR_USER -> AllIcons.RunConfigurations.TestState.Yellow2
                AgentStatusState.ERROR -> AllIcons.RunConfigurations.TestState.Red2
                else -> AllIcons.General.Information
            }

            val statusText = sessionInfo.status?.status ?: "unknown"
            val branchText = sessionInfo.branch
            val workflowText = sessionInfo.workflowStatus?.workflow ?: ""
            val pinText = if (sessionInfo.isPinned) " [pinned]" else ""

            text = "${sessionInfo.name}$pinText - $branchText [$statusText]" +
                   if (workflowText.isNotEmpty()) " - $workflowText" else ""
        } else if (node != null) {
            // Group node
            icon = AllIcons.Nodes.Folder
        }

        return this
    }
}
