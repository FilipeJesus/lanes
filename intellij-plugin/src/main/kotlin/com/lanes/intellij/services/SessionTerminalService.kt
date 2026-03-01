package com.lanes.intellij.services

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.content.Content

/**
 * Opens IntelliJ terminal sessions for Lanes worktrees.
 *
 * Uses reflection to tolerate terminal API differences across IDE versions.
 */
object SessionTerminalService {

    private val logger = Logger.getInstance(SessionTerminalService::class.java)

    fun openSessionTerminal(
        project: Project,
        sessionName: String,
        worktreePath: String,
        command: String? = null
    ) {
        openTerminal(project, "Lanes: $sessionName", worktreePath, command)
    }

    fun openWorktreeTerminal(
        project: Project,
        sessionName: String,
        worktreePath: String
    ) {
        openTerminal(project, "Worktree: $sessionName", worktreePath, null)
    }

    fun sendTextToSessionTerminal(project: Project, sessionName: String, text: String): Boolean {
        val managerClass = runCatching { Class.forName("org.jetbrains.plugins.terminal.TerminalToolWindowManager") }
            .getOrNull() ?: return false
        val getInstance = managerClass.methods.firstOrNull {
            it.name == "getInstance" && it.parameterCount == 1
        } ?: return false
        val manager = getInstance.invoke(null, project) ?: return false
        val title = "Lanes: $sessionName"
        val widget = findWidget(manager, title) ?: return false

        focusTerminal(project, widget)
        val executeCommand = widget.javaClass.methods.firstOrNull {
            it.name == "executeCommand" &&
                it.parameterCount == 1 &&
                it.parameterTypes[0] == String::class.java
        } ?: return false
        executeCommand.invoke(widget, text)
        return true
    }

    private fun openTerminal(
        project: Project,
        title: String,
        worktreePath: String,
        command: String? = null
    ) {
        ApplicationManager.getApplication().invokeLater {
            runCatching {
                val managerClass = Class.forName("org.jetbrains.plugins.terminal.TerminalToolWindowManager")
                val getInstance = managerClass.methods.firstOrNull {
                    it.name == "getInstance" && it.parameterCount == 1
                } ?: error("TerminalToolWindowManager.getInstance(Project) not found")

                val manager = getInstance.invoke(null, project)
                    ?: error("Failed to resolve TerminalToolWindowManager instance")

                val existingContent = findExistingTerminalContent(project, title)
                if (existingContent != null) {
                    focusTerminalContent(project, existingContent)
                    return@runCatching
                }

                val existingWidget = findWidget(manager, title)
                if (existingWidget != null) {
                    focusTerminal(project, existingWidget)
                    return@runCatching
                }

                val widget = createWidget(manager, worktreePath, title)
                if (widget == null) {
                    logger.warn("Could not create terminal widget: $title")
                    return@runCatching
                }

                focusTerminal(project, widget)

                if (!command.isNullOrBlank()) {
                    val executeCommand = widget.javaClass.methods.firstOrNull {
                        it.name == "executeCommand" &&
                            it.parameterCount == 1 &&
                            it.parameterTypes[0] == String::class.java
                    }
                    executeCommand?.invoke(widget, command)
                }
            }.onFailure { err ->
                logger.warn("Failed to open terminal '$title': ${err.message}", err)
            }
        }
    }

    private fun findWidget(manager: Any, title: String): Any? {
        val methods = manager.javaClass.methods

        val directLookup = listOf(
            "findWidgetByContent",
            "getWidgetByContent",
            "findWidgetByTitle"
        )
        for (name in directLookup) {
            val method = methods.firstOrNull {
                it.name == name &&
                    it.parameterCount == 1 &&
                    it.parameterTypes[0] == String::class.java
            } ?: continue
            val found = method.invoke(manager, title)
            if (found != null) {
                return found
            }
        }

        val listMethod = methods.firstOrNull {
            (it.name == "getTerminalWidgets" || it.name == "getWidgets") &&
                it.parameterCount == 0
        }
        val widgets = listMethod?.invoke(manager) as? Iterable<*> ?: return null
        return widgets.firstOrNull { widgetMatchesTitle(it, title) }
    }

    private fun findExistingTerminalContent(project: Project, title: String): Content? {
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Terminal") ?: return null
        val contents = toolWindow.contentManager.contents
        return contents.firstOrNull { content ->
            val name = content.displayName ?: return@firstOrNull false
            name == title || name.startsWith("$title ")
        }
    }

    private fun focusTerminalContent(project: Project, content: Content) {
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Terminal") ?: return
        toolWindow.activate {
            toolWindow.contentManager.setSelectedContent(content, true)
        }
    }

    private fun widgetMatchesTitle(widget: Any?, title: String): Boolean {
        if (widget == null) return false
        val methods = widget.javaClass.methods
        val getters = listOf("getTitle", "getName", "getSessionName")
        for (getter in getters) {
            val method = methods.firstOrNull {
                it.name == getter &&
                    it.parameterCount == 0 &&
                    it.returnType == String::class.java
            } ?: continue
            val value = method.invoke(widget) as? String
            if (value == title) {
                return true
            }
        }
        return false
    }

    private fun focusTerminal(project: Project, widget: Any) {
        ToolWindowManager.getInstance(project).getToolWindow("Terminal")?.activate(null)

        val focusMethod = widget.javaClass.methods.firstOrNull {
            it.name == "requestFocus" && it.parameterCount == 0
        } ?: widget.javaClass.methods.firstOrNull {
            it.name == "grabFocus" && it.parameterCount == 0
        } ?: widget.javaClass.methods.firstOrNull {
            it.name == "activate" && it.parameterCount == 0
        }

        runCatching {
            focusMethod?.invoke(widget)
        }.onFailure {
            logger.debug("Could not focus existing terminal widget: ${it.message}")
        }
    }

    private fun createWidget(manager: Any, worktreePath: String, title: String): Any? {
        val methods = manager.javaClass.methods

        val fourArgNames = listOf("createLocalShellWidget", "createShellWidget")
        for (name in fourArgNames) {
            val method = methods.firstOrNull {
                it.name == name &&
                    it.parameterCount == 4 &&
                    it.parameterTypes[0] == String::class.java &&
                    it.parameterTypes[1] == String::class.java &&
                    it.parameterTypes[2] == java.lang.Boolean.TYPE &&
                    it.parameterTypes[3] == java.lang.Boolean.TYPE
            }
            if (method != null) {
                return method.invoke(manager, worktreePath, title, true, true)
            }
        }

        val twoArgNames = listOf("createLocalShellWidget", "createShellWidget")
        for (name in twoArgNames) {
            val method = methods.firstOrNull {
                it.name == name &&
                    it.parameterCount == 2 &&
                    it.parameterTypes[0] == String::class.java &&
                    it.parameterTypes[1] == String::class.java
            }
            if (method != null) {
                return method.invoke(manager, worktreePath, title)
            }
        }

        return null
    }
}
