package com.lanes.intellij.services

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.lanes.intellij.bridge.BridgeClient
import kotlinx.coroutines.*
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
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /**
     * Get or create a BridgeClient for the given workspace root.
     * Starts the bridge process asynchronously (safe to call from any thread).
     *
     * @param workspaceRoot The absolute path to the workspace root
     * @return BridgeClient instance for this workspace
     */
    suspend fun getClient(workspaceRoot: String): BridgeClient {
        // Fast path: return existing client if running
        clients[workspaceRoot]?.let { existing ->
            if (existing.isRunning()) return existing
            // Client exists but is not running — remove stale entry
            clients.remove(workspaceRoot, existing)
        }

        // Slow path: create and start a new client
        return withContext(Dispatchers.IO) {
            // Double-check after acquiring IO dispatcher
            clients[workspaceRoot]?.let { existing ->
                if (existing.isRunning()) return@withContext existing
                clients.remove(workspaceRoot, existing)
            }

            val client = BridgeClient(workspaceRoot)
            val previous = clients.putIfAbsent(workspaceRoot, client)
            if (previous != null) {
                // Another coroutine won the race
                return@withContext previous
            }

            try {
                client.start()
                client
            } catch (e: Exception) {
                clients.remove(workspaceRoot, client)
                logger.error("Failed to start BridgeClient for workspace: $workspaceRoot", e)
                throw e
            }
        }
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
        clients.values.forEach { client ->
            try {
                client.dispose()
            } catch (e: Exception) {
                logger.error("Error disposing bridge client", e)
            }
        }
        clients.clear()
    }
}
