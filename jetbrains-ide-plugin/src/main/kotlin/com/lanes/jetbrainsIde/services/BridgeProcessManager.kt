package com.lanes.jetbrainsIde.services

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.lanes.jetbrainsIde.bridge.BridgeClient
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap

/**
 * Application-level service that manages BridgeClient instances.
 *
 * Creates and caches BridgeClient instances per workspace root.
 * Ensures all clients are properly disposed when the plugin is unloaded.
 */
@Service(Service.Level.APP)
class BridgeProcessManager : Disposable {

    private val logger = Logger.getInstance(BridgeProcessManager::class.java)
    private val clients = ConcurrentHashMap<String, BridgeClient>()
    private val startupMutex = Mutex()
    internal val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    /**
     * Get or create a BridgeClient for the given workspace root.
     * Starts the bridge process asynchronously (safe to call from any thread).
     *
     * @param workspaceRoot The absolute path to the workspace root
     * @return BridgeClient instance for this workspace
     */
    suspend fun getClient(workspaceRoot: String): BridgeClient = startupMutex.withLock {
        clients[workspaceRoot]?.takeIf { it.isRunning() }?.let { return@withLock it }
        clients.remove(workspaceRoot)
        val client = BridgeClient(workspaceRoot)
        try {
            withContext(Dispatchers.IO) { client.start() }
        } catch (e: Exception) {
            logger.error("Failed to start BridgeClient for workspace: $workspaceRoot", e)
            throw e
        }
        clients[workspaceRoot] = client
        client
    }

    /**
     * Stop all active bridge clients.
     */
    fun stopAll() {
        logger.info("Stopping all bridge clients")
        clients.values.forEach { client ->
            try {
                client.dispose()
            } catch (e: Exception) {
                logger.error("Error stopping bridge client", e)
            }
        }
        clients.clear()
    }

    /**
     * Dispose all bridge clients.
     */
    override fun dispose() {
        logger.info("Disposing BridgeProcessManager")
        scope.cancel()
        stopAll()
    }
}
