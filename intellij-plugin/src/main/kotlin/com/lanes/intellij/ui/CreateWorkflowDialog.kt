package com.lanes.intellij.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.ui.components.JBTextField
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.panel
import com.lanes.intellij.bridge.BridgeClientRequester
import com.lanes.intellij.bridge.BridgeRequester
import com.lanes.intellij.bridge.WorkflowCreateParams
import com.lanes.intellij.bridge.WorkflowCreateResult
import com.lanes.intellij.bridge.WorkflowListParams
import com.lanes.intellij.bridge.WorkflowListResult
import com.lanes.intellij.bridge.WorkflowMethods
import com.lanes.intellij.bridge.WorkflowTemplate
import com.lanes.intellij.services.BridgeProcessManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.Dimension
import java.nio.file.Files
import java.nio.file.Path
import org.jetbrains.annotations.TestOnly

/**
 * Dialog to create a new workflow from scratch or from an existing template.
 */
class CreateWorkflowDialog(
    private val project: Project,
    private val bridgeRequesterProvider: (suspend (Project) -> BridgeRequester)? = null,
    private val onCreated: () -> Unit = {},
    private val autoLoad: Boolean = true
) : DialogWrapper(project) {

    private val logger = Logger.getInstance(CreateWorkflowDialog::class.java)
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val workflowNameField = JBTextField()
    private val templateComboBox = ComboBox<TemplateChoice>()
    private var templates: List<WorkflowTemplate> = emptyList()
    @Volatile
    private var dataLoaded = false

    init {
        title = "Create Workflow"
        init()
        if (autoLoad) {
            loadData()
        }
    }

    override fun createCenterPanel() = panel {
        row("Workflow Name:") {
            cell(workflowNameField)
                .align(AlignX.FILL)
                .focused()
        }
        row("Base Template:") {
            cell(templateComboBox)
                .align(AlignX.FILL)
        }
    }.apply {
        preferredSize = Dimension(520, 160)
    }

    override fun doValidate(): ValidationInfo? {
        val name = workflowNameField.text.trim()
        if (name.isEmpty()) {
            return ValidationInfo("Workflow name is required", workflowNameField)
        }
        if (!Regex("^[a-zA-Z0-9_-]+$").matches(name)) {
            return ValidationInfo("Use only letters, numbers, hyphens, and underscores", workflowNameField)
        }
        val reserved = setOf("default", "feature", "bugfix", "refactor")
        if (name in reserved) {
            return ValidationInfo("'$name' is reserved. Choose a different name.", workflowNameField)
        }
        return null
    }

    override fun doOKAction() {
        if (!isOKActionEnabled) return
        isOKActionEnabled = false
        scope.launch {
            try {
                createWorkflow()
                close(OK_EXIT_CODE)
                onCreated()
            } catch (err: Exception) {
                logger.error("Failed to create workflow", err)
                ApplicationManager.getApplication().invokeLater {
                    setErrorText("Failed to create workflow: ${err.message}")
                    isOKActionEnabled = true
                }
            }
        }
    }

    private fun loadData() {
        scope.launch {
            try {
                loadDataInternal()
            } catch (err: Exception) {
                logger.error("Failed to load workflow templates", err)
                ApplicationManager.getApplication().invokeLater {
                    setErrorText("Failed to load templates: ${err.message}")
                }
            }
        }
    }

    private suspend fun loadDataInternal() {
        val client = withContext(Dispatchers.IO) { resolveBridgeRequester() }
        val result = withContext(Dispatchers.IO) {
            client.request(
                WorkflowMethods.LIST,
                WorkflowListParams(includeBuiltin = true, includeCustom = false),
                WorkflowListResult::class.java
            )
        }
        templates = result.workflows
        ApplicationManager.getApplication().invokeAndWait {
            templateComboBox.removeAllItems()
            templateComboBox.addItem(TemplateChoice(null, "Start from scratch"))
            templates
                .filter { it.isBuiltin }
                .sortedBy { it.name.lowercase() }
                .forEach { templateComboBox.addItem(TemplateChoice(it, "Template: ${it.name}")) }
            templateComboBox.selectedIndex = 0
            dataLoaded = true
        }
    }

    private suspend fun createWorkflow() {
        val client = withContext(Dispatchers.IO) { resolveBridgeRequester() }
        val name = workflowNameField.text.trim()
        val selected = templateComboBox.selectedItem as? TemplateChoice
        val content = buildWorkflowContent(name, selected?.template)

        val result = withContext(Dispatchers.IO) {
            client.request(
                WorkflowMethods.CREATE,
                WorkflowCreateParams(name = name, content = content),
                WorkflowCreateResult::class.java
            )
        }

        openCreatedWorkflow(result.path)
    }

    private fun buildWorkflowContent(name: String, template: WorkflowTemplate?): String {
        val source = if (template == null) {
            BLANK_WORKFLOW_TEMPLATE
        } else {
            try {
                Files.readString(Path.of(template.path))
            } catch (_: Exception) {
                BLANK_WORKFLOW_TEMPLATE
            }
        }

        val nameRegex = Regex("^name:\\s*.+$", setOf(RegexOption.MULTILINE))
        return if (nameRegex.containsMatchIn(source)) {
            source.replaceFirst(nameRegex, "name: $name")
        } else {
            "name: $name\n$source"
        }
    }

    private fun openCreatedWorkflow(filePath: String) {
        ApplicationManager.getApplication().invokeLater {
            val normalized = filePath.replace('\\', '/')
            val vFile = LocalFileSystem.getInstance().refreshAndFindFileByPath(normalized)
            if (vFile != null) {
                FileEditorManager.getInstance(project).openFile(vFile, true)
            }
        }
    }

    private suspend fun resolveBridgeRequester(): BridgeRequester {
        bridgeRequesterProvider?.let { return it(project) }
        val workspaceRoot = project.basePath ?: error("Project basePath is unavailable")
        val client = ApplicationManager.getApplication()
            .service<BridgeProcessManager>()
            .getClient(workspaceRoot)
        return BridgeClientRequester(client)
    }

    @TestOnly
    internal fun setWorkflowNameForTest(value: String) {
        workflowNameField.text = value
    }

    @TestOnly
    internal fun selectTemplateByLabelForTest(label: String) {
        for (i in 0 until templateComboBox.itemCount) {
            val item = templateComboBox.getItemAt(i)
            if (item?.label == label) {
                templateComboBox.selectedIndex = i
                break
            }
        }
    }

    @TestOnly
    internal fun getTemplateLabelsForTest(): List<String> {
        return (0 until templateComboBox.itemCount).mapNotNull { templateComboBox.getItemAt(it)?.label }
    }

    @TestOnly
    internal suspend fun loadDataForTest() {
        loadDataInternal()
    }

    @TestOnly
    internal suspend fun createWorkflowForTest() {
        createWorkflow()
    }

    @TestOnly
    internal suspend fun waitForDataLoadForTest(timeoutMs: Long = 5000) {
        var waited = 0L
        while (!dataLoaded && waited < timeoutMs) {
            delay(25)
            waited += 25
        }
    }

    override fun dispose() {
        scope.cancel()
        super.dispose()
    }

    private data class TemplateChoice(
        val template: WorkflowTemplate?,
        val label: String
    ) {
        override fun toString(): String = label
    }

    companion object {
        private const val BLANK_WORKFLOW_TEMPLATE = """name: my-workflow
description: Custom workflow description

agents:
  orchestrator:
    description: Plans work and coordinates
    tools:
      - Read
      - Glob
      - Grep
      - Task
    cannot:
      - Write
      - Edit
      - Bash
      - commit

loops: {}

steps:
  - id: plan
    type: action
    agent: orchestrator
    instructions: |
      Analyze the goal and create a plan.
"""
    }
}
