package com.lanes.intellij.ui

import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

/**
 * Factory for creating the Lanes tool window.
 *
 * Creates a tool window with the SessionsTreePanel that displays all sessions.
 */
class LanesToolWindowFactory : ToolWindowFactory {

    private val logger = Logger.getInstance(LanesToolWindowFactory::class.java)

    companion object {
        /**
         * DataKey for accessing the currently selected session name.
         */
        val SELECTED_SESSION_KEY = DataKey.create<String>("lanes.selectedSession")

        /**
         * DataKey for accessing whether the selected session is pinned.
         */
        val SESSION_IS_PINNED_KEY = DataKey.create<Boolean>("lanes.sessionIsPinned")

        /**
         * DataKey for accessing the refresh callback.
         */
        val REFRESH_CALLBACK_KEY = DataKey.create<() -> Unit>("lanes.refreshCallback")
    }

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        try {
            logger.info("Creating Lanes tool window for project: ${project.name}")

            val sessionsPanel = SessionsTreePanel(project)

            val content = ContentFactory.getInstance().createContent(sessionsPanel, "", false)
            Disposer.register(content, sessionsPanel)
            toolWindow.contentManager.addContent(content)

            logger.info("Lanes tool window created successfully")
        } catch (e: Exception) {
            logger.error("Failed to create Lanes tool window", e)
        }
    }

    override fun shouldBeAvailable(project: Project): Boolean {
        val basePath = project.basePath ?: return false
        return java.io.File(basePath, ".git").exists()
    }
}
