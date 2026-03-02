package com.lanes.jetbrainsIde.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBTextField
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.dsl.builder.panel
import com.intellij.ui.dsl.builder.Cell
import com.intellij.ui.dsl.builder.AlignX
import com.lanes.jetbrainsIde.bridge.*
import com.lanes.jetbrainsIde.services.BridgeProcessManager
import com.lanes.jetbrainsIde.services.SessionTerminalService
import kotlinx.coroutines.*
import java.awt.Dimension
import javax.swing.JScrollPane
import javax.swing.JComponent
import org.jetbrains.annotations.TestOnly

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
class CreateSessionDialog(
    private val project: Project,
    private val bridgeRequesterProvider: (suspend (Project) -> BridgeRequester)? = null,
    private val terminalOpener: (sessionName: String, worktreePath: String, command: String?) -> Unit =
        { sessionName, worktreePath, command ->
            SessionTerminalService.openSessionTerminal(project, sessionName, worktreePath, command)
        },
    private val autoLoad: Boolean = true
) : DialogWrapper(project) {

    private val logger = Logger.getInstance(CreateSessionDialog::class.java)
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val sessionNameField = JBTextField()
    private val branchComboBox = ComboBox<String>()
    private val workflowComboBox = ComboBox<String>()
    private val agentComboBox = ComboBox<String>()
    private val bypassPermissionsCheckBox = JBCheckBox("Bypass permissions")
    private val initialPromptArea = JBTextArea(4, 40)

    private var branches = listOf<BranchInfo>()
    private var workflows = listOf<WorkflowTemplate>()
    private var agents = listOf<CodeAgentConfig>()
    @Volatile
    private var dataLoaded = false

    init {
        title = "Create New Session"
        init()
        agentComboBox.addActionListener {
            updatePermissionControls()
        }
        if (autoLoad) {
            loadData()
        }
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
            row {
                cell(bypassPermissionsCheckBox)
                    .align(AlignX.FILL)
            }
            row("Initial Prompt:") {
                cell(JScrollPane(initialPromptArea))
                    .align(AlignX.FILL)
                    .resizableColumn()
            }.resizableRow()
        }

        dialogPanel.preferredSize = Dimension(600, 320)
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
                loadDataInternal()
            } catch (e: Exception) {
                logger.error("Failed to load dialog data", e)
                ApplicationManager.getApplication().invokeLater {
                    setErrorText("Failed to load data: ${e.message}")
                }
            }
        }
    }

    private suspend fun loadDataInternal() {
        val client = withContext(Dispatchers.IO) { resolveBridgeRequester() }

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

        // Update UI on EDT synchronously so data load completion is deterministic.
        ApplicationManager.getApplication().invokeAndWait {
            updateComboBoxes()
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
        updatePermissionControls()
        dataLoaded = true
    }

    private fun updatePermissionControls() {
        val selectedAgentDisplayName = agentComboBox.selectedItem as? String
        val selectedAgent = agents.find { it.displayName == selectedAgentDisplayName }
        val supportsBypass = selectedAgent?.permissionModes?.any { it.id == BYPASS_PERMISSION_MODE_ID } == true
        bypassPermissionsCheckBox.isEnabled = supportsBypass
        if (!supportsBypass) {
            bypassPermissionsCheckBox.isSelected = false
            bypassPermissionsCheckBox.toolTipText = "Selected agent does not support bypass permissions."
        } else {
            bypassPermissionsCheckBox.toolTipText = "Run session with bypass permissions enabled."
        }
    }

    private suspend fun createSession() {
        val client = withContext(Dispatchers.IO) { resolveBridgeRequester() }

        val sessionName = sessionNameField.text.trim()
        val branchName = branchComboBox.selectedItem as? String ?: ""
        val workflowName = workflowComboBox.selectedItem as? String
        val agentDisplayName = agentComboBox.selectedItem as? String
        val initialPrompt = initialPromptArea.text.trim().ifEmpty { null }

        val selectedWorkflow = workflows.find { workflow ->
            val displayName = if (workflow.isBuiltin) {
                "${workflow.name} (builtin)"
            } else {
                workflow.name
            }
            displayName == workflowName
        }

        val selectedAgent = agents.find { it.displayName == agentDisplayName }
        val selectedPermissionMode = if (bypassPermissionsCheckBox.isSelected) {
            BYPASS_PERMISSION_MODE_ID
        } else {
            null
        }

        val params = SessionCreateParams(
            name = sessionName,
            branch = if (branchName == "(none - use current)") "" else branchName,
            workflow = selectedWorkflow?.name,
            agent = selectedAgent?.name,
            prompt = initialPrompt,
            attachments = null,
            permissionMode = selectedPermissionMode
        )

        val createResult = withContext(Dispatchers.IO) {
            client.request(
                SessionMethods.CREATE,
                params,
                SessionCreateResult::class.java
            )
        }

        val startCommand = createResult.command ?: selectedAgent?.cliCommand
        terminalOpener(createResult.sessionName, createResult.worktreePath, startCommand)

        logger.info("Created session: $sessionName")
    }

    private suspend fun resolveBridgeRequester(): BridgeRequester {
        bridgeRequesterProvider?.let { return it(project) }

        val workspaceRoot = project.basePath ?: error("Project basePath is unavailable")
        val bridgeManager = ApplicationManager.getApplication().getService(BridgeProcessManager::class.java)
        val bridgeClient = bridgeManager.getClient(workspaceRoot)
        return BridgeClientRequester(bridgeClient)
    }

    @TestOnly
    internal fun setSessionNameForTest(value: String) {
        sessionNameField.text = value
    }

    @TestOnly
    internal fun selectBranchForTest(value: String) {
        branchComboBox.selectedItem = value
    }

    @TestOnly
    internal fun selectWorkflowForTest(value: String) {
        workflowComboBox.selectedItem = value
    }

    @TestOnly
    internal fun selectAgentForTest(value: String) {
        agentComboBox.selectedItem = value
    }

    @TestOnly
    internal fun setInitialPromptForTest(value: String) {
        initialPromptArea.text = value
    }

    @TestOnly
    internal fun setBypassPermissionsForTest(enabled: Boolean) {
        bypassPermissionsCheckBox.isSelected = enabled
    }

    @TestOnly
    internal fun getBranchItemsForTest(): List<String> {
        return (0 until branchComboBox.itemCount).mapNotNull { branchComboBox.getItemAt(it) }
    }

    @TestOnly
    internal fun getWorkflowItemsForTest(): List<String> {
        return (0 until workflowComboBox.itemCount).mapNotNull { workflowComboBox.getItemAt(it) }
    }

    @TestOnly
    internal fun getAgentItemsForTest(): List<String> {
        return (0 until agentComboBox.itemCount).mapNotNull { agentComboBox.getItemAt(it) }
    }

    @TestOnly
    internal suspend fun waitForDataLoadForTest(timeoutMs: Long = 5000) {
        withTimeout(timeoutMs) {
            while (!dataLoaded) {
                delay(25)
            }
        }
    }

    @TestOnly
    internal suspend fun createSessionForTest() {
        createSession()
    }

    @TestOnly
    internal suspend fun loadDataForTest() {
        loadDataInternal()
    }

    override fun dispose() {
        scope.cancel()
        super.dispose()
    }

    companion object {
        private const val BYPASS_PERMISSION_MODE_ID = "bypassPermissions"
    }
}
