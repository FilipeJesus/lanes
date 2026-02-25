package com.lanes.intellij.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.components.JBTextField
import com.intellij.ui.dsl.builder.panel
import com.intellij.ui.dsl.builder.Cell
import com.intellij.ui.dsl.builder.AlignX
import com.lanes.intellij.bridge.*
import com.lanes.intellij.services.BridgeProcessManager
import kotlinx.coroutines.*
import java.awt.Dimension
import javax.swing.JComponent

/**
 * Dialog for creating a new Claude Code session.
 *
 * Features:
 * - Session name text input with validation
 * - Source branch dropdown (fetched from git)
 * - Workflow template dropdown (fetched from bridge)
 * - Agent dropdown (fetched from bridge)
 * - Input validation: session name required, no special chars
 */
class CreateSessionDialog(private val project: Project) : DialogWrapper(project) {

    private val logger = Logger.getInstance(CreateSessionDialog::class.java)
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val sessionNameField = JBTextField()
    private val branchComboBox = ComboBox<String>()
    private val workflowComboBox = ComboBox<String>()
    private val agentComboBox = ComboBox<String>()

    private var branches = listOf<BranchInfo>()
    private var workflows = listOf<WorkflowTemplate>()
    private var agents = listOf<CodeAgentConfig>()

    init {
        title = "Create New Session"
        init()
        loadData()
    }

    override fun createCenterPanel(): JComponent {
        val dialogPanel = panel {
            row("Session Name:") {
                cell(sessionNameField)
                    .align(AlignX.FILL)
                    .focused()
            }
            row("Source Branch:") {
                cell(branchComboBox)
                    .align(AlignX.FILL)
            }
            row("Workflow Template:") {
                cell(workflowComboBox)
                    .align(AlignX.FILL)
            }
            row("Agent:") {
                cell(agentComboBox)
                    .align(AlignX.FILL)
            }
        }

        dialogPanel.preferredSize = Dimension(500, 200)
        return dialogPanel
    }

    override fun doValidate(): ValidationInfo? {
        return validateSessionName()
    }

    private fun validateSessionName(): ValidationInfo? {
        val name = sessionNameField.text.trim()

        if (name.isEmpty()) {
            return ValidationInfo("Session name is required", sessionNameField)
        }

        val invalidChars = Regex("[^a-zA-Z0-9_-]")
        if (invalidChars.containsMatchIn(name)) {
            return ValidationInfo("Session name can only contain letters, numbers, hyphens, and underscores", sessionNameField)
        }

        if (name.length > 50) {
            return ValidationInfo("Session name must be 50 characters or less", sessionNameField)
        }

        return null
    }

    override fun doOKAction() {
        if (okAction.isEnabled) {
            // Disable OK button to prevent double-click and show progress
            isOKActionEnabled = false

            scope.launch {
                try {
                    createSession()
                    close(OK_EXIT_CODE)
                } catch (e: Exception) {
                    logger.error("Failed to create session", e)
                    ApplicationManager.getApplication().invokeLater {
                        setErrorText("Failed to create session: ${e.message}")
                        isOKActionEnabled = true
                    }
                }
            }
        }
    }

    private fun loadData() {
        scope.launch {
            try {
                val bridgeManager = ApplicationManager.getApplication().getService(BridgeProcessManager::class.java)
                val workspaceRoot = project.basePath ?: return@launch

                val client = withContext(Dispatchers.IO) {
                    bridgeManager.getClient(workspaceRoot)
                }

                // Load branches
                val branchesResult = withContext(Dispatchers.IO) {
                    client.request(
                        GitMethods.LIST_BRANCHES,
                        GitListBranchesParams(includeRemote = false),
                        GitListBranchesResult::class.java
                    )
                }
                branches = branchesResult.branches

                // Load workflows
                val workflowsResult = withContext(Dispatchers.IO) {
                    client.request(
                        WorkflowMethods.LIST,
                        WorkflowListParams(includeBuiltin = true, includeCustom = true),
                        WorkflowListResult::class.java
                    )
                }
                workflows = workflowsResult.workflows

                // Load agents
                val agentsResult = withContext(Dispatchers.IO) {
                    client.request(
                        AgentMethods.LIST,
                        AgentListParams(checkAvailability = false),
                        AgentListResult::class.java
                    )
                }
                agents = agentsResult.agents

                // Update UI on EDT
                ApplicationManager.getApplication().invokeLater {
                    updateComboBoxes()
                }

            } catch (e: Exception) {
                logger.error("Failed to load dialog data", e)
                ApplicationManager.getApplication().invokeLater {
                    setErrorText("Failed to load data: ${e.message}")
                }
            }
        }
    }

    private fun updateComboBoxes() {
        branchComboBox.removeAllItems()
        branchComboBox.addItem("(none - use current)")
        for (branch in branches) {
            branchComboBox.addItem(branch.name)
            if (branch.isCurrent) {
                branchComboBox.selectedItem = branch.name
            }
        }

        workflowComboBox.removeAllItems()
        workflowComboBox.addItem("(none)")
        for (workflow in workflows) {
            val displayName = if (workflow.isBuiltin) {
                "${workflow.name} (builtin)"
            } else {
                workflow.name
            }
            workflowComboBox.addItem(displayName)
        }

        agentComboBox.removeAllItems()
        for (agent in agents) {
            agentComboBox.addItem(agent.displayName)
        }

        if (agents.isNotEmpty()) {
            agentComboBox.selectedIndex = 0
        }
    }

    private suspend fun createSession() {
        val bridgeManager = ApplicationManager.getApplication().getService(BridgeProcessManager::class.java)
        val workspaceRoot = project.basePath ?: return

        val client = withContext(Dispatchers.IO) {
            bridgeManager.getClient(workspaceRoot)
        }

        val sessionName = sessionNameField.text.trim()
        val branchName = branchComboBox.selectedItem as? String ?: ""
        val workflowName = workflowComboBox.selectedItem as? String
        val agentDisplayName = agentComboBox.selectedItem as? String

        val selectedWorkflow = workflows.find { workflow ->
            val displayName = if (workflow.isBuiltin) {
                "${workflow.name} (builtin)"
            } else {
                workflow.name
            }
            displayName == workflowName
        }

        val selectedAgent = agents.find { it.displayName == agentDisplayName }

        val params = SessionCreateParams(
            name = sessionName,
            branch = if (branchName == "(none - use current)") "" else branchName,
            workflow = selectedWorkflow?.name,
            agent = selectedAgent?.name,
            prompt = null,
            attachments = null,
            permissionMode = null
        )

        withContext(Dispatchers.IO) {
            client.request(
                SessionMethods.CREATE,
                params,
                SessionCreateResult::class.java
            )
        }

        logger.info("Created session: $sessionName")
    }

    override fun dispose() {
        scope.cancel()
        super.dispose()
    }
}
