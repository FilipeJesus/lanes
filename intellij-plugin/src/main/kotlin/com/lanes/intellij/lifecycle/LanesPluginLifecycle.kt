package com.lanes.intellij.lifecycle

import com.intellij.ide.plugins.DynamicPluginListener
import com.intellij.ide.plugins.IdeaPluginDescriptor
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.lanes.intellij.services.BridgeProcessManager

/**
 * Plugin lifecycle listener that ensures all bridge processes are stopped
 * when the plugin is unloaded.
 *
 * This prevents orphaned Node.js processes.
 */
class LanesPluginLifecycle : DynamicPluginListener {

    private val logger = Logger.getInstance(LanesPluginLifecycle::class.java)

    override fun beforePluginUnload(pluginDescriptor: IdeaPluginDescriptor, isUpdate: Boolean) {
        if (pluginDescriptor.pluginId.idString == "com.lanes.intellij") {
            logger.info("Lanes plugin is being unloaded, stopping all bridge processes")

            try {
                val bridgeManager = ApplicationManager.getApplication()
                    .getService(BridgeProcessManager::class.java)

                bridgeManager.stopAll()

                logger.info("All Lanes bridge processes stopped successfully")
            } catch (e: Exception) {
                logger.error("Error stopping bridge processes during plugin unload", e)
            }
        }
    }
}
