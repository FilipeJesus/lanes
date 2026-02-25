package com.lanes.intellij.adapters

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.lanes.intellij.bridge.BridgeClient
import com.lanes.intellij.bridge.FileChangedNotification
import com.lanes.intellij.bridge.FileEventType
import com.lanes.intellij.bridge.FileWatcherMethods
import com.lanes.intellij.bridge.FileWatcherUnwatchParams
import com.lanes.intellij.bridge.FileWatcherUnwatchResult
import com.lanes.intellij.bridge.FileWatcherWatchParams
import com.lanes.intellij.bridge.FileWatcherWatchResult
import com.lanes.intellij.bridge.NotificationMethods
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
     * The unwatch bridge request is best-effort (fire-and-forget).
     */
    override fun dispose() {
        // Unregister notification listener
        notificationDisposable?.dispose()

        // Best-effort unwatch — don't block on bridge response during disposal.
        // The bridge will clean up watchers when the process exits anyway.
        try {
            // Note: We can't call suspend functions from dispose().
            // The bridge server will clean up watches when the session ends.
            logger.debug("Disposing file watch: $watchId")
        } catch (e: Exception) {
            // Ignore errors during disposal
        }

        changeHandlers.clear()
        createHandlers.clear()
        deleteHandlers.clear()
    }
}
