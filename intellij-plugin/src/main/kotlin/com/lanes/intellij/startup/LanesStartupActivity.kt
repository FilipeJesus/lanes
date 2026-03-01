package com.lanes.intellij.startup

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.lanes.intellij.services.BridgeProcessManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Startup activity that initializes the bridge process when a project is opened.
 *
 * This ensures the bridge is ready before any UI components or actions try to use it.
 */
class LanesStartupActivity : ProjectActivity {

    private val logger = Logger.getInstance(LanesStartupActivity::class.java)

    override suspend fun execute(project: Project) {
        val workspaceRoot = project.basePath ?: return

        // Only initialize for git repositories
        val gitDir = java.io.File(workspaceRoot, ".git")
        if (!gitDir.exists()) {
            logger.info("Skipping Lanes startup for non-git project: ${project.name}")
            return
        }

        try {
            logger.info("Starting Lanes bridge for project: ${project.name}")

            val bridgeManager = ApplicationManager.getApplication()
                .getService(BridgeProcessManager::class.java)

            // Start the bridge process (this is a suspend function)
            withContext(Dispatchers.IO) {
                bridgeManager.getClient(workspaceRoot)
            }

            logger.info("Lanes bridge started successfully for project: ${project.name}")
        } catch (e: Exception) {
            logger.error("Failed to start Lanes bridge for project: ${project.name}", e)
        }
    }
}
