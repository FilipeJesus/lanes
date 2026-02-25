package com.lanes.intellij.bridge

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.JsonSyntaxException
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.*
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * JSON-RPC 2.0 client for communicating with the Node.js bridge process.
 *
 * Manages the child Node.js process lifecycle, sends requests over stdin,
 * receives responses/notifications from stdout, and handles process crashes.
 *
 * Thread-safe for concurrent requests.
 */
class BridgeClient(
    private val workspaceRoot: String,
    private val bridgeServerPath: String? = null
) : Disposable {

    private val logger = Logger.getInstance(BridgeClient::class.java)
    private val gson = Gson()
    private val requestIdGenerator = AtomicInteger(1)

    @Volatile
    private var process: Process? = null

    @Volatile
    private var stdoutReader: BufferedReader? = null

    @Volatile
    private var stdinWriter: BufferedWriter? = null

    private val pendingRequests = ConcurrentHashMap<Int, CompletableFuture<JsonElement>>()
    private val notificationHandlers = ConcurrentHashMap<String, CopyOnWriteArrayList<(JsonObject) -> Unit>>()

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Volatile
    private var isDisposed = false

    @Volatile
    private var isInitialized = false

    private val isRestarting = AtomicBoolean(false)

    /**
     * Start the bridge process and initialize the connection.
     * Must be called from a coroutine context (not from EDT).
     */
    suspend fun start() {
        if (isDisposed) {
            throw IllegalStateException("BridgeClient has been disposed")
        }

        if (isRunning()) {
            logger.warn("Bridge process is already running")
            return
        }

        try {
            process = startProcess()
            stdoutReader = BufferedReader(InputStreamReader(process!!.inputStream))
            stdinWriter = BufferedWriter(OutputStreamWriter(process!!.outputStream))

            // Start reading stdout in background
            scope.launch {
                readStdout()
            }

            // Start reading stderr for logging
            scope.launch {
                readStderr()
            }

            // Monitor process exit
            scope.launch {
                monitorProcessExit()
            }

            // Send initialize request
            val initParams = BridgeProtocol.InitializeParams(
                clientVersion = "0.1.0",
                workspaceRoot = workspaceRoot
            )
            val result = request(
                BridgeProtocol.INITIALIZE,
                initParams,
                BridgeProtocol.InitializeResult::class.java
            )
            logger.info("Bridge initialized: $result")
            isInitialized = true

        } catch (e: Exception) {
            logger.error("Failed to start bridge process", e)
            cleanup()
            throw e
        }
    }

    /**
     * Stop the bridge process gracefully.
     * Must be called from a coroutine context (not from EDT).
     */
    suspend fun stop() {
        if (!isRunning()) {
            return
        }

        try {
            // Send shutdown request
            if (isInitialized) {
                try {
                    request(
                        BridgeProtocol.SHUTDOWN,
                        BridgeProtocol.ShutdownParams(reason = "Client requested shutdown"),
                        BridgeProtocol.ShutdownResult::class.java,
                        timeout = 5000
                    )
                } catch (e: Exception) {
                    logger.warn("Error during shutdown request", e)
                }
            }

            // Give process time to exit gracefully
            withContext(Dispatchers.IO) {
                val exited = process?.waitFor(2, TimeUnit.SECONDS) ?: false
                if (!exited) {
                    logger.warn("Process did not exit gracefully, forcing destruction")
                    process?.destroyForcibly()
                }
            }
        } catch (e: Exception) {
            logger.error("Error stopping bridge process", e)
        } finally {
            cleanup()
        }
    }

    /**
     * Check if the bridge process is running.
     */
    fun isRunning(): Boolean {
        return process?.isAlive == true
    }

    /**
     * Send a JSON-RPC request and wait for response.
     */
    suspend fun <T> request(
        method: String,
        params: Any? = null,
        resultType: Class<T>,
        timeout: Long = 30000
    ): T = withContext(Dispatchers.IO) {
        if (!isRunning()) {
            throw IllegalStateException("Bridge process is not running")
        }

        val requestId = requestIdGenerator.getAndIncrement()
        val future = CompletableFuture<JsonElement>()
        pendingRequests[requestId] = future

        try {
            val paramsJson = if (params != null) {
                gson.toJsonTree(params).asJsonObject
            } else {
                null
            }

            val request = JsonRpcRequest(
                id = requestId,
                method = method,
                params = paramsJson
            )

            val requestJson = gson.toJson(request)
            logger.debug("Sending request: $requestJson")

            val writer = stdinWriter
                ?: throw IOException("Bridge process stdin is not available")

            synchronized(writer) {
                writer.write(requestJson)
                writer.newLine()
                writer.flush()
            }

            // Wait for response with timeout
            val result = try {
                withTimeout(timeout) {
                    future.await()
                }
            } catch (e: TimeoutCancellationException) {
                pendingRequests.remove(requestId)
                throw IOException("Request timed out after ${timeout}ms: $method")
            }

            gson.fromJson(result, resultType)
        } catch (e: Exception) {
            pendingRequests.remove(requestId)
            throw e
        }
    }

    /**
     * Register a notification handler.
     * Thread-safe: uses CopyOnWriteArrayList for concurrent access.
     */
    fun onNotification(method: String, handler: (JsonObject) -> Unit): Disposable {
        val handlers = notificationHandlers.computeIfAbsent(method) { CopyOnWriteArrayList() }
        handlers.add(handler)

        return Disposable {
            handlers.remove(handler)
        }
    }

    /**
     * Start the Node.js bridge process.
     */
    private fun startProcess(): Process {
        val serverPath = bridgeServerPath ?: resolveDefaultBridgeServerPath()

        logger.info("Starting bridge process: node $serverPath --workspace-root $workspaceRoot")

        val processBuilder = ProcessBuilder(
            "node",
            serverPath,
            "--workspace-root",
            workspaceRoot
        )

        processBuilder.redirectErrorStream(false)

        return processBuilder.start()
    }

    /**
     * Resolve the default bridge server path from the plugin installation directory.
     * The bridge JS files are bundled into the plugin during prepareSandbox.
     */
    private fun resolveDefaultBridgeServerPath(): String {
        val plugin = PluginManagerCore.getPlugin(PluginId.getId("com.lanes.intellij"))
            ?: throw IllegalStateException("Cannot find Lanes plugin installation")
        return plugin.pluginPath.resolve("bridge").resolve("server.js").toString()
    }

    /**
     * Read stdout line-by-line and dispatch responses/notifications.
     */
    private suspend fun readStdout() = withContext(Dispatchers.IO) {
        try {
            while (isRunning() && !isDisposed) {
                val line = stdoutReader?.readLine() ?: break
                if (line.isBlank()) continue

                logger.debug("Received: $line")

                try {
                    val json = JsonParser.parseString(line).asJsonObject
                    val hasId = json.has("id") && !json["id"].isJsonNull
                    val hasMethod = json.has("method")

                    when {
                        // Reverse RPC: bridge → plugin request (has both id and method)
                        hasId && hasMethod -> handleReverseRequest(json)
                        // Response to our request (has id, no method)
                        hasId -> handleResponse(json)
                        // Notification (has method, no id)
                        hasMethod -> handleNotification(json)
                        else -> logger.warn("Unknown message format: $line")
                    }
                } catch (e: JsonSyntaxException) {
                    logger.error("Failed to parse JSON: $line", e)
                }
            }
        } catch (e: IOException) {
            if (!isDisposed) {
                logger.error("Error reading stdout", e)
            }
        }
    }

    /**
     * Read stderr and log it.
     */
    private suspend fun readStderr() = withContext(Dispatchers.IO) {
        try {
            val stderrReader = BufferedReader(InputStreamReader(process!!.errorStream))
            while (isRunning() && !isDisposed) {
                val line = stderrReader.readLine() ?: break
                logger.info("Bridge stderr: $line")
            }
        } catch (e: IOException) {
            if (!isDisposed) {
                logger.error("Error reading stderr", e)
            }
        }
    }

    /**
     * Handle a JSON-RPC response.
     */
    private fun handleResponse(json: JsonObject) {
        val id = json["id"].asInt
        val future = pendingRequests.remove(id)

        if (future == null) {
            logger.warn("Received response for unknown request ID: $id")
            return
        }

        if (json.has("error")) {
            val error = gson.fromJson(json["error"], JsonRpcError::class.java)
            future.completeExceptionally(
                JsonRpcException(error.code, error.message, error.data)
            )
        } else if (json.has("result")) {
            future.complete(json["result"])
        } else {
            future.completeExceptionally(
                JsonRpcException(
                    JsonRpcErrorCode.INTERNAL_ERROR,
                    "Response missing both 'result' and 'error'",
                    null
                )
            )
        }
    }

    /**
     * Handle a JSON-RPC notification.
     */
    private fun handleNotification(json: JsonObject) {
        val method = json["method"].asString
        val params = json["params"]?.asJsonObject ?: JsonObject()

        logger.debug("Received notification: $method")

        val handlers = notificationHandlers[method]
        if (handlers.isNullOrEmpty()) {
            logger.debug("No handlers registered for notification: $method")
            return
        }

        handlers.forEach { handler ->
            try {
                handler(params)
            } catch (e: Exception) {
                logger.error("Error in notification handler for $method", e)
            }
        }
    }

    /**
     * Handle a reverse RPC request from the bridge (bridge → plugin).
     * For now, responds with METHOD_NOT_FOUND for all methods.
     * Future: implement handlers for UI dialogs, storage, file watching, etc.
     */
    private fun handleReverseRequest(json: JsonObject) {
        val id = json["id"].asInt
        val method = json["method"].asString
        logger.warn("Received reverse RPC request (not yet implemented): $method")

        val errorResponse = JsonObject().apply {
            addProperty("jsonrpc", "2.0")
            addProperty("id", id)
            add("error", JsonObject().apply {
                addProperty("code", JsonRpcErrorCode.METHOD_NOT_FOUND)
                addProperty("message", "Method not implemented on plugin side: $method")
            })
        }

        val writer = stdinWriter ?: return
        try {
            val responseJson = gson.toJson(errorResponse)
            synchronized(writer) {
                writer.write(responseJson)
                writer.newLine()
                writer.flush()
            }
        } catch (e: IOException) {
            logger.error("Failed to send reverse RPC error response", e)
        }
    }

    /**
     * Monitor process exit and handle crashes.
     */
    private suspend fun monitorProcessExit() = withContext(Dispatchers.IO) {
        try {
            val exitCode = process?.waitFor()
            if (!isDisposed) {
                logger.error("Bridge process exited unexpectedly with code: $exitCode")
                handleCrash()
            }
        } catch (e: InterruptedException) {
            // Process was interrupted during shutdown, this is expected
        }
    }

    /**
     * Handle process crash.
     * Uses AtomicBoolean guard to prevent concurrent restart attempts.
     */
    private fun handleCrash() {
        // Complete all pending requests with exception
        val exception = IOException("Bridge process crashed")
        pendingRequests.values.forEach { future ->
            future.completeExceptionally(exception)
        }
        pendingRequests.clear()

        cleanup()

        // Attempt restart after delay, guarded against concurrent restarts
        if (!isRestarting.compareAndSet(false, true)) {
            logger.warn("Restart already in progress, skipping")
            return
        }

        scope.launch {
            try {
                delay(5000)
                if (!isDisposed) {
                    logger.info("Attempting to restart bridge process")
                    try {
                        start()
                    } catch (e: Exception) {
                        logger.error("Failed to restart bridge process", e)
                    }
                }
            } finally {
                isRestarting.set(false)
            }
        }
    }

    /**
     * Clean up resources.
     */
    private fun cleanup() {
        try {
            stdinWriter?.close()
        } catch (e: Exception) {
            logger.debug("Error closing stdin", e)
        }

        try {
            stdoutReader?.close()
        } catch (e: Exception) {
            logger.debug("Error closing stdout", e)
        }

        process = null
        stdoutReader = null
        stdinWriter = null
        isInitialized = false
    }

    override fun dispose() {
        if (isDisposed) {
            return
        }

        isDisposed = true

        // Complete all pending requests
        val exception = IOException("BridgeClient disposed")
        pendingRequests.values.forEach { it.completeExceptionally(exception) }
        pendingRequests.clear()

        // Stop process: send shutdown if possible, then force-kill
        try {
            if (isInitialized) {
                // Best-effort shutdown request (synchronous write, no response wait)
                val writer = stdinWriter
                if (writer != null) {
                    try {
                        val shutdownRequest = gson.toJson(JsonRpcRequest(
                            id = requestIdGenerator.getAndIncrement(),
                            method = BridgeProtocol.SHUTDOWN,
                            params = gson.toJsonTree(
                                BridgeProtocol.ShutdownParams(reason = "Client disposed")
                            ).asJsonObject
                        ))
                        synchronized(writer) {
                            writer.write(shutdownRequest)
                            writer.newLine()
                            writer.flush()
                        }
                    } catch (e: Exception) {
                        logger.debug("Error sending shutdown during dispose", e)
                    }
                }
            }

            val exited = process?.waitFor(2, TimeUnit.SECONDS) ?: true
            if (!exited) {
                process?.destroyForcibly()
            }
        } catch (e: Exception) {
            logger.debug("Error during dispose cleanup", e)
            process?.destroyForcibly()
        }

        scope.cancel()
        cleanup()
    }
}

/**
 * Extension to await CompletableFuture in coroutines.
 */
private suspend fun <T> CompletableFuture<T>.await(): T = suspendCancellableCoroutine { continuation ->
    whenComplete { result, exception ->
        if (exception != null) {
            continuation.resumeWith(Result.failure(exception))
        } else {
            continuation.resumeWith(Result.success(result))
        }
    }

    continuation.invokeOnCancellation {
        this.cancel(true)
    }
}

/**
 * Exception for JSON-RPC errors.
 */
class JsonRpcException(
    val code: Int,
    override val message: String,
    val data: JsonElement?
) : Exception("JSON-RPC error $code: $message")
