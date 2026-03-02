package com.lanes.jetbrainsIde.adapters

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.lanes.jetbrainsIde.bridge.BridgeClient
import com.lanes.jetbrainsIde.bridge.FileChangedNotification
import com.lanes.jetbrainsIde.bridge.FileEventType
import com.lanes.jetbrainsIde.bridge.FileWatcherMethods
import com.lanes.jetbrainsIde.bridge.FileWatcherUnwatchParams
import com.lanes.jetbrainsIde.bridge.FileWatcherUnwatchResult
import com.lanes.jetbrainsIde.bridge.FileWatcherWatchParams
import com.lanes.jetbrainsIde.bridge.FileWatcherWatchResult
import com.lanes.jetbrainsIde.bridge.NotificationMethods
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Adapter for file system watching via the bridge.
 *
 * Delegates to the Node.js bridge for setting up file watchers.
 */
class FileWatcherAdapter(private val client: BridgeClient) {

    /**
     * Watch a path with a glob pattern.
     *
     * @param basePath Base path to watch
     * @param pattern Glob pattern (e.g., **&#47;*.ts)
     * @return FileWatchHandle for managing the watch
     */
    suspend fun watch(basePath: String, pattern: String): FileWatchHandle {
        val result = client.request(
            FileWatcherMethods.WATCH,
            FileWatcherWatchParams(basePath, pattern),
            FileWatcherWatchResult::class.java
        )

        return FileWatchHandle(result.watchId, basePath, client)
    }
}

/**
 * Handle for a file watch.
 *
 * Allows registering callbacks for file events and disposing the watch.
 * Thread-safe: uses CopyOnWriteArrayList for handler collections.
 */
class FileWatchHandle(
    private val watchId: String,
    private val basePath: String,
    private val client: BridgeClient
) : Disposable {

    private val logger = Logger.getInstance(FileWatchHandle::class.java)
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val changeHandlers = CopyOnWriteArrayList<() -> Unit>()
    private val createHandlers = CopyOnWriteArrayList<(String) -> Unit>()
    private val deleteHandlers = CopyOnWriteArrayList<() -> Unit>()

    private var notificationDisposable: Disposable? = null

    init {
        // Register notification listener for file changes
        notificationDisposable = client.onNotification(NotificationMethods.FILE_CHANGED) { params ->
            val notification = com.google.gson.Gson().fromJson(params, FileChangedNotification::class.java)

            // Only handle notifications for this watch's base path
            if (notification.path.startsWith(basePath)) {
                when (notification.eventTypeEnum()) {
                    FileEventType.CHANGED -> {
                        changeHandlers.forEach { it() }
                    }
                    FileEventType.CREATED -> {
                        createHandlers.forEach { it(notification.path) }
                    }
                    FileEventType.DELETED -> {
                        deleteHandlers.forEach { it() }
                    }
                    null -> {
                        // Unknown event type, ignore
                    }
                }
            }
        }
    }

    /**
     * Register a callback for file change events.
     */
    fun onDidChange(callback: () -> Unit): Disposable {
        changeHandlers.add(callback)
        return Disposable {
            changeHandlers.remove(callback)
        }
    }

    /**
     * Register a callback for file create events.
     */
    fun onDidCreate(callback: (String) -> Unit): Disposable {
        createHandlers.add(callback)
        return Disposable {
            createHandlers.remove(callback)
        }
    }

    /**
     * Register a callback for file delete events.
     */
    fun onDidDelete(callback: () -> Unit): Disposable {
        deleteHandlers.add(callback)
        return Disposable {
            deleteHandlers.remove(callback)
        }
    }

    /**
     * Dispose the file watch.
     * Unregisters notification listener and clears handlers.
     * The unwatch bridge request is best-effort.
     */
    override fun dispose() {
        notificationDisposable?.dispose()

        changeHandlers.clear()
        createHandlers.clear()
        deleteHandlers.clear()

        scope.launch {
            try {
                client.request(
                    FileWatcherMethods.UNWATCH,
                    FileWatcherUnwatchParams(watchId),
                    FileWatcherUnwatchResult::class.java
                )
            } catch (e: Exception) {
                logger.debug("Failed to unwatch bridge watch id: $watchId", e)
            }
        }.invokeOnCompletion {
            scope.cancel()
        }
    }
}
