package com.lanes.intellij.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.TextFieldWithBrowseButton
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.ui.dsl.builder.panel
import com.intellij.ui.dsl.builder.AlignX
import com.lanes.intellij.adapters.ConfigAdapter
import com.lanes.intellij.services.BridgeProcessManager
import kotlinx.coroutines.*
import javax.swing.JComponent

/**
 * Settings/Preferences page for Lanes.
 *
 * Allows configuration of:
 * - Worktrees folder
 * - Prompts folder
 * - Default agent
 * - Terminal mode
 * - Local settings propagation
 *
 * Reads/writes config via ConfigAdapter (through the bridge).
 */
class LanesSettingsConfigurable(private val project: Project) : Configurable {

    private val logger = Logger.getInstance(LanesSettingsConfigurable::class.java)
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val worktreesFolderField = TextFieldWithBrowseButton()
    private val promptsFolderField = TextFieldWithBrowseButton()
    private val defaultAgentField = JBTextField()
    private val terminalModeComboBox = ComboBox<String>(arrayOf("vscode", "tmux"))
    private val localSettingsPropagationComboBox = ComboBox<String>(arrayOf("copy", "symlink", "disabled"))

    private var isModified = false

    init {
        worktreesFolderField.addBrowseFolderListener(
            "Select Worktrees Folder",
            "Choose the folder where worktrees will be created",
            null,
            FileChooserDescriptorFactory.createSingleFolderDescriptor()
        )

        promptsFolderField.addBrowseFolderListener(
            "Select Prompts Folder",
            "Choose the folder containing prompt templates",
            null,
            FileChooserDescriptorFactory.createSingleFolderDescriptor()
        )

        worktreesFolderField.textField.document.addDocumentListener(ModificationListener())
        promptsFolderField.textField.document.addDocumentListener(ModificationListener())
        defaultAgentField.document.addDocumentListener(ModificationListener())
        terminalModeComboBox.addActionListener { isModified = true }
        localSettingsPropagationComboBox.addActionListener { isModified = true }
    }

    override fun getDisplayName(): String {
        return "Lanes"
    }

    override fun createComponent(): JComponent {
        return panel {
            group("General Settings") {
                row("Worktrees Folder:") {
                    cell(worktreesFolderField)
                        .align(AlignX.FILL)
                }
                row("Prompts Folder:") {
                    cell(promptsFolderField)
                        .align(AlignX.FILL)
                }
                row("Default Agent:") {
                    cell(defaultAgentField)
                        .align(AlignX.FILL)
                }
            }
            group("Advanced Settings") {
                row("Terminal Mode:") {
                    cell(terminalModeComboBox)
                }
                row("Local Settings Propagation:") {
                    cell(localSettingsPropagationComboBox)
                }
            }
            row {
                cell(JBLabel("""
                    <html>
                    <p><b>Worktrees Folder:</b> Directory where Git worktrees will be created</p>
                    <p><b>Prompts Folder:</b> Directory containing custom prompt templates</p>
                    <p><b>Default Agent:</b> Default AI agent to use (e.g., 'claude', 'gemini')</p>
                    <p><b>Terminal Mode:</b> Use IDE terminal or tmux for sessions</p>
                    <p><b>Local Settings Propagation:</b> How to propagate .claude/settings.local.json to worktrees</p>
                    </html>
                """.trimIndent()))
            }
        }
    }

    override fun isModified(): Boolean {
        return isModified
    }

    override fun apply() {
        val worktrees = worktreesFolderField.text
        val prompts = promptsFolderField.text
        val agent = defaultAgentField.text
        val terminal = terminalModeComboBox.selectedItem as String
        val propagation = localSettingsPropagationComboBox.selectedItem as String

        scope.launch {
            try {
                val adapter = getConfigAdapter() ?: return@launch

                adapter.set("lanes", "worktreesFolder", worktrees)
                adapter.set("lanes", "promptsFolder", prompts)
                adapter.set("lanes", "defaultAgent", agent)
                adapter.set("lanes", "terminalMode", terminal)
                adapter.set("lanes", "localSettingsPropagation", propagation)

                logger.info("Settings saved successfully")
            } catch (e: Exception) {
                logger.error("Failed to save settings", e)
            }
        }
        isModified = false
    }

    override fun reset() {
        scope.launch {
            try {
                val adapter = getConfigAdapter() ?: return@launch

                val worktreesFolder = adapter.get("lanes", "worktreesFolder", ".worktrees")
                val promptsFolder = adapter.get("lanes", "promptsFolder", "")
                val defaultAgent = adapter.get("lanes", "defaultAgent", "claude")
                var terminalMode = adapter.get("lanes", "terminalMode", "vscode")
                if (terminalMode == "code") {
                    terminalMode = "vscode"
                }
                val localSettingsPropagation = adapter.get("lanes", "localSettingsPropagation", "copy")

                ApplicationManager.getApplication().invokeLater {
                    worktreesFolderField.text = worktreesFolder
                    promptsFolderField.text = promptsFolder
                    defaultAgentField.text = defaultAgent
                    terminalModeComboBox.selectedItem = terminalMode
                    localSettingsPropagationComboBox.selectedItem = localSettingsPropagation
                    isModified = false
                }
            } catch (e: Exception) {
                logger.error("Failed to load settings", e)
            }
        }
    }

    /**
     * Get a fresh ConfigAdapter each time to avoid stale BridgeClient references.
     */
    private suspend fun getConfigAdapter(): ConfigAdapter? {
        val workspaceRoot = project.basePath ?: return null

        val bridgeManager = ApplicationManager.getApplication().getService(BridgeProcessManager::class.java)
        val client = withContext(Dispatchers.IO) {
            bridgeManager.getClient(workspaceRoot)
        }

        return ConfigAdapter(client)
    }

    override fun disposeUIResources() {
        scope.cancel()
    }

    private inner class ModificationListener : javax.swing.event.DocumentListener {
        override fun insertUpdate(e: javax.swing.event.DocumentEvent?) {
            isModified = true
        }

        override fun removeUpdate(e: javax.swing.event.DocumentEvent?) {
            isModified = true
        }

        override fun changedUpdate(e: javax.swing.event.DocumentEvent?) {
            isModified = true
        }
    }
}
