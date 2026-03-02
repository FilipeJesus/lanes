package com.lanes.jetbrainsIde.services

import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffDialogHints
import com.intellij.diff.DiffManager
import com.intellij.diff.chains.SimpleDiffRequestChain
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.openapi.fileTypes.FileTypeRegistry
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.lanes.jetbrainsIde.bridge.BridgeClient
import com.lanes.jetbrainsIde.bridge.SessionMethods
import com.lanes.jetbrainsIde.bridge.SessionOpenParams
import com.lanes.jetbrainsIde.bridge.SessionOpenResult
import com.lanes.jetbrainsIde.bridge.GitDiffFile
import com.lanes.jetbrainsIde.ui.SessionDiffReviewDialog
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Renders session diffs using IntelliJ's native diff viewer.
 */
object SessionDiffService {

    fun showSessionDiff(project: Project, sessionName: String, files: List<GitDiffFile>) {
        if (files.isEmpty()) {
            Messages.showInfoMessage(project, "No changes in session '$sessionName'", "Session Diff")
            return
        }
        SessionDiffReviewDialog(project, sessionName, files).show()
    }

    fun showNativeDiff(project: Project, files: List<GitDiffFile>, selectedPath: String? = null) {
        val requests = mutableListOf<SimpleDiffRequest>()
        val skippedBinary = mutableListOf<String>()

        for (file in files) {
            if (file.isBinary == true) {
                skippedBinary.add(file.path)
                continue
            }
            requests.add(buildRequest(project, file))
        }

        if (requests.isEmpty()) {
            val details = if (skippedBinary.isNotEmpty()) {
                "\nSkipped binary files:\n${skippedBinary.joinToString("\n")}"
            } else {
                ""
            }
            Messages.showInfoMessage(project, "No text diffs to display.$details", "Session Diff")
            return
        }

        val selectedIndex = selectedPath?.let { path ->
            requests.indexOfFirst { it.title?.endsWith(path) == true }.takeIf { it >= 0 }
        } ?: 0

        if (requests.size == 1) {
            DiffManager.getInstance().showDiff(project, requests.first())
        } else {
            val chain = SimpleDiffRequestChain(requests, selectedIndex)
            DiffManager.getInstance().showDiff(project, chain, DiffDialogHints.DEFAULT)
        }

        if (skippedBinary.isNotEmpty()) {
            Messages.showInfoMessage(
                project,
                "Skipped binary files:\n${skippedBinary.joinToString("\n")}",
                "Session Diff"
            )
        }
    }

    suspend fun submitReviewComments(
        project: Project,
        client: BridgeClient,
        sessionName: String,
        message: String
    ) {
        val openResult = withContext(Dispatchers.IO) {
            client.request(
                SessionMethods.OPEN,
                SessionOpenParams(sessionName),
                SessionOpenResult::class.java
            )
        }

        if (!openResult.success) {
            error("Could not open session '$sessionName'")
        }

        SessionTerminalService.openSessionTerminal(
            project = project,
            sessionName = sessionName,
            worktreePath = openResult.worktreePath ?: "",
            command = openResult.command
        )

        // Give the terminal widget a moment to become available before sending.
        delay(400)
        val sent = SessionTerminalService.sendTextToSessionTerminal(project, sessionName, message)
        if (!sent) {
            error("No active terminal found for session '$sessionName'")
        }
    }

    private fun buildRequest(project: Project, file: GitDiffFile): SimpleDiffRequest {
        val fileType = FileTypeRegistry.getInstance().getFileTypeByFileName(file.path)
            .takeIf { it != PlainTextFileType.INSTANCE }
            ?: PlainTextFileType.INSTANCE
        val leftContent = DiffContentFactory.getInstance().create(project, file.beforeContent ?: "", fileType)
        val rightContent = DiffContentFactory.getInstance().create(project, file.afterContent ?: "", fileType)
        val statusLabel = when (file.status) {
            "A" -> "Added"
            "D" -> "Deleted"
            "R" -> "Renamed"
            "C" -> "Copied"
            "T" -> "Type Changed"
            else -> "Modified"
        }
        val title = "$statusLabel: ${file.path}"
        return SimpleDiffRequest(
            title,
            leftContent,
            rightContent,
            "Base",
            "Session"
        )
    }
}
