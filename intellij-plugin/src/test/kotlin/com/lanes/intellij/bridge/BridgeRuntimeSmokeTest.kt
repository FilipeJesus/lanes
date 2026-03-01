package com.lanes.intellij.bridge

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.fail
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.nio.file.StandardCopyOption
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Runtime smoke test for packaged Node bridge artifacts.
 *
 * This starts the bridge from the prepared IntelliJ sandbox plugin directory,
 * which mirrors real plugin runtime layout. It catches broken relative imports
 * that unit tests/mocked integration tests can miss.
 */
class BridgeRuntimeSmokeTest {

    private val requiredRuntimeModules = listOf(
        "yaml",
        "@iarna/toml",
        "@modelcontextprotocol/sdk",
        "chokidar",
        "readdirp"
    )

    @Test
    fun `packaged bridge starts and responds to initialize`() {
        val projectDir = Path.of(System.getProperty("user.dir")).toAbsolutePath()
        val workspaceRoot = createTempGitRepo()
        val isolatedPluginDir = prepareIsolatedPackagedPluginDir(projectDir)

        val nodeCheck = ProcessBuilder("node", "--version").start()
        if (!nodeCheck.waitFor(5, TimeUnit.SECONDS) || nodeCheck.exitValue() != 0) {
            fail("Node.js is required for bridge runtime smoke test")
        }

        val handles = startBridgeProcess(isolatedPluginDir, workspaceRoot.toString())

        try {
            Thread.sleep(500)
            if (!handles.process.isAlive) {
                val err = handles.stderr.readText()
                fail("Bridge process exited early.\nStderr:\n$err")
            }

            sendRequest(
                handles.stdin,
                1,
                "initialize",
                """{"clientVersion":"test","workspaceRoot":"${workspaceRoot.toString().replace("\\", "\\\\")}"}"""
            )
            val response = readJsonRpcResponse(handles.stdout, 5, 1)
            assertTrue(response.contains("\"jsonrpc\":\"2.0\""), "Expected valid JSON-RPC response")
            assertTrue(response.contains("\"id\":1"), "Expected initialize response id")
            assertTrue(response.contains("\"result\""), "Expected initialize result payload")
        } finally {
            shutdownAndCleanup(handles, isolatedPluginDir, workspaceRoot)
        }
    }

    @Test
    fun `session create command includes prompt file substitution`() {
        val projectDir = Path.of(System.getProperty("user.dir")).toAbsolutePath()
        val workspaceRoot = createTempGitRepo()
        val isolatedPluginDir = prepareIsolatedPackagedPluginDir(projectDir)
        val handles = startBridgeProcess(isolatedPluginDir, workspaceRoot.toString())

        try {
            sendRequest(
                handles.stdin,
                1,
                "initialize",
                """{"clientVersion":"test","workspaceRoot":"${workspaceRoot.toString().replace("\\", "\\\\")}"}"""
            )
            readJsonRpcResponse(handles.stdout, 5, 1)

            sendRequest(
                handles.stdin,
                2,
                "session.create",
                """{"name":"feat-prompt","branch":"","prompt":"Please investigate failing CI and propose fixes."}"""
            )
            val response = readJsonRpcResponse(handles.stdout, 10, 2)
            val responseJson = JsonParser.parseString(response).asJsonObject
            val result = responseJson.getAsJsonObject("result")
                ?: fail("session.create response missing result: $response")

            val command = result.get("command")?.asString
                ?: fail("session.create response missing command: $response")
            assertTrue(command.contains("$(cat "), "Expected prompt command substitution in: $command")
            assertTrue(command.contains("feat-prompt.txt"), "Expected session prompt file name in: $command")

            val promptPath = extractPromptPath(command)
                ?: fail("Could not parse prompt file path from command: $command")
            val promptFile = Path.of(promptPath)
            assertTrue(Files.exists(promptFile), "Prompt file should exist: $promptPath")
            assertEquals(
                "Please investigate failing CI and propose fixes.",
                Files.readString(promptFile)
            )
        } finally {
            shutdownAndCleanup(handles, isolatedPluginDir, workspaceRoot)
        }
    }

    private fun readJsonRpcResponse(stdout: BufferedReader, timeoutSeconds: Long, expectedId: Int): String {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds)
        while (System.nanoTime() < deadline) {
            val remainingNanos = deadline - System.nanoTime()
            val line = try {
                val readFuture = CompletableFuture.supplyAsync { stdout.readLine() }
                readFuture.get(remainingNanos, TimeUnit.NANOSECONDS)
            } catch (_: TimeoutException) {
                break
            }

            if (line == null) {
                break
            }

            val trimmed = line.trim()
            if (trimmed.isNotEmpty() && !trimmed.startsWith("{")) {
                fail("Bridge wrote non-JSON content to stdout: $trimmed")
            }
            if (trimmed.startsWith("{") && trimmed.contains("\"jsonrpc\"")) {
                val parsed = runCatching { JsonParser.parseString(trimmed).asJsonObject }.getOrNull()
                if (parsed != null && parsed.has("id") && parsed.get("id").asInt == expectedId) {
                    return trimmed
                }
            }
        }

        fail("Did not receive JSON-RPC response with id=$expectedId from bridge stdout within timeout")
    }

    private fun sendRequest(stdin: BufferedWriter, id: Int, method: String, paramsJson: String) {
        val request = """{"jsonrpc":"2.0","id":$id,"method":"$method","params":$paramsJson}"""
        stdin.write(request)
        stdin.newLine()
        stdin.flush()
    }

    private fun prepareIsolatedPackagedPluginDir(projectDir: Path): Path {
        val packagedPluginDir = findPackagedPluginDir(projectDir)
        val isolatedPluginDir = Files.createTempDirectory("lanes-plugin-runtime-smoke-")
        copyDirectory(packagedPluginDir, isolatedPluginDir)
        assertPackagedRuntimeDependencies(isolatedPluginDir)
        return isolatedPluginDir
    }

    private fun startBridgeProcess(isolatedPluginDir: Path, workspaceRoot: String): BridgeProcessHandles {
        val bridgeServerPath = isolatedPluginDir.resolve("bridge").resolve("server.js")
        val process = ProcessBuilder(
            "node",
            bridgeServerPath.toString(),
            "--workspace-root",
            workspaceRoot
        )
            .directory(isolatedPluginDir.toFile())
            .start()

        return BridgeProcessHandles(
            process = process,
            stdout = BufferedReader(InputStreamReader(process.inputStream)),
            stderr = BufferedReader(InputStreamReader(process.errorStream)),
            stdin = BufferedWriter(OutputStreamWriter(process.outputStream))
        )
    }

    private fun shutdownAndCleanup(handles: BridgeProcessHandles, isolatedPluginDir: Path, workspaceRoot: Path) {
        try {
            handles.stdin.write("""{"jsonrpc":"2.0","id":999,"method":"shutdown","params":{"reason":"test"}}""")
            handles.stdin.newLine()
            handles.stdin.flush()
        } catch (_: Exception) {
            // Best-effort shutdown in test cleanup.
        }

        if (!handles.process.waitFor(2, TimeUnit.SECONDS)) {
            handles.process.destroyForcibly()
        }

        runCatching { deleteRecursively(isolatedPluginDir) }
        runCatching { deleteRecursively(workspaceRoot) }
    }

    private fun createTempGitRepo(): Path {
        val repoDir = Files.createTempDirectory("lanes-bridge-repo-")
        runCommand(repoDir, "git", "init")
        Files.writeString(repoDir.resolve("README.md"), "runtime smoke test\n")
        runCommand(repoDir, "git", "add", "README.md")
        runCommand(
            repoDir,
            "git",
            "-c",
            "user.name=lanes-test",
            "-c",
            "user.email=lanes-test@example.com",
            "commit",
            "-m",
            "init"
        )
        return repoDir
    }

    private fun runCommand(cwd: Path, vararg cmd: String) {
        val process = ProcessBuilder(*cmd)
            .directory(cwd.toFile())
            .start()
        if (!process.waitFor(10, TimeUnit.SECONDS) || process.exitValue() != 0) {
            val stderr = process.errorStream.bufferedReader().readText()
            val stdout = process.inputStream.bufferedReader().readText()
            fail(
                "Command failed (${cmd.joinToString(" ")}):\n" +
                    "stdout:\n$stdout\nstderr:\n$stderr"
            )
        }
    }

    private fun extractPromptPath(command: String): String? {
        val marker = "\"$(cat \""
        val start = command.indexOf(marker)
        if (start < 0) return null
        val pathStart = start + marker.length
        val end = command.indexOf("\")\"", pathStart)
        if (end < 0) return null
        return command.substring(pathStart, end)
    }

    private fun assertPackagedRuntimeDependencies(pluginDir: Path) {
        val missing = requiredRuntimeModules
            .map { pluginDir.resolve("node_modules").resolve(it) }
            .filter { !Files.isDirectory(it) }
            .map { it.toString() }

        if (missing.isNotEmpty()) {
            fail(
                "Packaged plugin is missing required Node.js runtime dependencies:\n" +
                    missing.joinToString(separator = "\n")
            )
        }
    }

    private fun findPackagedPluginDir(projectDir: Path): Path {
        val sandboxDir = projectDir.resolve("build").resolve("idea-sandbox")
        if (!Files.isDirectory(sandboxDir)) {
            fail("Sandbox directory not found: $sandboxDir")
        }

        Files.list(sandboxDir).use { products ->
            val match = products
                .filter { Files.isDirectory(it) }
                .map { it.resolve("plugins").resolve("lanes-intellij") }
                .filter { Files.isDirectory(it) && Files.isRegularFile(it.resolve("bridge").resolve("server.js")) }
                .findFirst()

            if (match.isPresent) {
                return match.get()
            }
        }

        fail("Could not locate packaged lanes-intellij plugin under $sandboxDir")
    }

    private fun copyDirectory(source: Path, target: Path) {
        Files.walk(source).use { paths ->
            paths.forEach { sourcePath ->
                val relative = source.relativize(sourcePath)
                val targetPath = target.resolve(relative.toString())
                if (Files.isDirectory(sourcePath)) {
                    Files.createDirectories(targetPath)
                } else {
                    Files.createDirectories(targetPath.parent)
                    Files.copy(sourcePath, targetPath, StandardCopyOption.REPLACE_EXISTING)
                }
            }
        }
    }

    private fun deleteRecursively(path: Path) {
        if (!Files.exists(path)) return
        Files.walk(path)
            .sorted(Comparator.reverseOrder())
            .forEach { Files.deleteIfExists(it) }
    }

    private data class BridgeProcessHandles(
        val process: Process,
        val stdout: BufferedReader,
        val stderr: BufferedReader,
        val stdin: BufferedWriter
    )
}
