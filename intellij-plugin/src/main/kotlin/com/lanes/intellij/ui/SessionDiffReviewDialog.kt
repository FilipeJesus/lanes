package com.lanes.intellij.ui

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.ui.JBColor
import com.intellij.ui.ToolbarDecorator
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.FormBuilder
import com.lanes.intellij.bridge.GitDiffFile
import com.lanes.intellij.services.SessionDiffService
import java.awt.Color
import java.awt.Toolkit
import java.awt.datatransfer.StringSelection
import javax.swing.Action
import javax.swing.DefaultListCellRenderer
import javax.swing.DefaultListModel
import javax.swing.JComponent
import javax.swing.JSplitPane
import javax.swing.ListSelectionModel
import javax.swing.text.DefaultHighlighter

/**
 * Review dialog for session diffs with line-anchored comments and submit-to-agent support.
 * Shows all files in one review stream.
 */
class SessionDiffReviewDialog(
    private val project: Project,
    private val sessionName: String,
    private val files: List<GitDiffFile>
) : DialogWrapper(project) {

    private val logger = Logger.getInstance(SessionDiffReviewDialog::class.java)

    private val diffArea = JBTextArea()
    private val anchorInfoLabel = JBLabel("Anchor: none")
    private val commentInputArea = JBTextArea()
    private val commentsModel = DefaultListModel<AnchoredFileComment>()
    private val commentsList = JBList(commentsModel)

    private val comments = mutableListOf<AnchoredFileComment>()
    private var displayLines: List<DisplayLine> = emptyList()
    private var selectedAnchor: CommentAnchor? = null
    private val addedLinePainter = DefaultHighlighter.DefaultHighlightPainter(
        JBColor(Color(231, 255, 237), Color(31, 59, 40))
    )
    private val deletedLinePainter = DefaultHighlighter.DefaultHighlightPainter(
        JBColor(Color(255, 235, 235), Color(63, 31, 31))
    )
    private val commentedLinePainter = DefaultHighlighter.DefaultHighlightPainter(
        JBColor(Color(255, 245, 200), Color(74, 67, 32))
    )

    init {
        title = "Session Review: $sessionName"
        init()
        setOKButtonText("Submit Comments to Agent")
    }

    override fun createCenterPanel(): JComponent {
        configureTextArea(diffArea)
        commentInputArea.lineWrap = true
        commentInputArea.wrapStyleWord = true
        commentInputArea.rows = 2

        commentsList.selectionMode = ListSelectionModel.SINGLE_SELECTION
        commentsList.setCellRenderer { _, value, index, isSelected, cellHasFocus ->
            val base = DefaultListCellRenderer().getListCellRendererComponent(commentsList, value, index, isSelected, cellHasFocus)
            if (base is DefaultListCellRenderer && value is AnchoredFileComment) {
                base.text = "${value.path} ${value.anchor.side.displayName}:${value.anchor.line}  ${value.text}"
            }
            base
        }

        diffArea.addCaretListener {
            val caret = diffArea.caretPosition
            val line = diffArea.document.defaultRootElement.getElementIndex(caret)
            if (line in displayLines.indices) {
                val item = displayLines[line]
                selectedAnchor = when {
                    item.path != null && item.prefix == '+' && item.sessionLine != null -> {
                        CommentAnchor(item.path, CommentSide.SESSION, item.sessionLine)
                    }
                    item.path != null && item.prefix == '-' && item.baseLine != null -> {
                        CommentAnchor(item.path, CommentSide.BASE, item.baseLine)
                    }
                    else -> selectedAnchor
                }
                updateAnchorLabel()
            }
        }

        val commentsPanel = ToolbarDecorator.createDecorator(commentsList)
            .setAddAction {
                addCommentAtAnchor()
            }
            .setRemoveAction {
                removeSelectedComment()
            }
            .disableUpDownActions()
            .createPanel()

        val rightPanel = FormBuilder.createFormBuilder()
            .addLabeledComponent("Selected Anchor:", anchorInfoLabel, 8, false)
            .addLabeledComponent("New Comment:", JBScrollPane(commentInputArea), 8, false)
            .addLabeledComponent("Anchored Comments:", commentsPanel, 8, false)
            .panel

        renderAllDiffs()

        return JSplitPane(
            JSplitPane.HORIZONTAL_SPLIT,
            wrapWithLineNumbers(diffArea),
            rightPanel
        ).apply {
            resizeWeight = 0.72
            dividerLocation = 920
        }
    }

    override fun createActions(): Array<Action> {
        return arrayOf(openNativeDiffAction, okAction, cancelAction)
    }

    private val openNativeDiffAction = object : DialogWrapperAction("Open Native Diff") {
        override fun doAction(e: java.awt.event.ActionEvent?) {
            SessionDiffService.showNativeDiff(project, files, null)
        }
    }

    override fun doOKAction() {
        val nonEmptyComments = comments
            .map { it.copy(text = it.text.trim()) }
            .filter { it.text.isNotBlank() }

        if (nonEmptyComments.isEmpty()) {
            Messages.showInfoMessage(project, "Add at least one comment before submitting.", "Session Review")
            return
        }

        isOKActionEnabled = false
        val payload = buildSubmissionMessage(nonEmptyComments)
        try {
            val clipboard = Toolkit.getDefaultToolkit().systemClipboard
            clipboard.setContents(StringSelection(payload), null)
            close(OK_EXIT_CODE)
            Messages.showInfoMessage(project, "Review prompt copied to clipboard.", "Session Review")
        } catch (err: Exception) {
            logger.error("Failed to copy review prompt to clipboard", err)
            isOKActionEnabled = true
            Messages.showErrorDialog(project, "Failed to copy prompt: ${err.message}", "Session Review")
        }
    }

    private fun configureTextArea(textArea: JBTextArea) {
        textArea.isEditable = false
        textArea.lineWrap = false
        textArea.tabSize = 4
    }

    private fun wrapWithLineNumbers(textArea: JBTextArea): JBScrollPane {
        val scroll = JBScrollPane(textArea)
        val lineNumbers = JBTextArea("1").apply {
            isEditable = false
            background = JBColor(Color(245, 245, 245), Color(49, 51, 53))
            foreground = JBColor.GRAY
        }
        scroll.setRowHeaderView(lineNumbers)
        textArea.document.addDocumentListener(object : javax.swing.event.DocumentListener {
            override fun insertUpdate(e: javax.swing.event.DocumentEvent?) = updateLineNumbers(textArea, lineNumbers)
            override fun removeUpdate(e: javax.swing.event.DocumentEvent?) = updateLineNumbers(textArea, lineNumbers)
            override fun changedUpdate(e: javax.swing.event.DocumentEvent?) = updateLineNumbers(textArea, lineNumbers)
        })
        updateLineNumbers(textArea, lineNumbers)
        return scroll
    }

    private fun updateLineNumbers(textArea: JBTextArea, lineNumbers: JBTextArea) {
        val lineCount = maxOf(1, textArea.lineCount)
        lineNumbers.text = (1..lineCount).joinToString("\n")
    }

    private fun renderAllDiffs() {
        displayLines = buildDisplayLines(files)
        diffArea.text = displayLines.joinToString("\n") { line ->
            when (line.prefix) {
                '+', '-' -> "${line.prefix} ${line.text}"
                else -> line.text
            }
        }
        refreshHighlights()
    }

    private fun buildDisplayLines(diffFiles: List<GitDiffFile>): List<DisplayLine> {
        val out = mutableListOf<DisplayLine>()

        for (file in diffFiles) {
            val statusLabel = when (file.status) {
                "A" -> "Added"
                "D" -> "Deleted"
                "R" -> "Renamed"
                "C" -> "Copied"
                "T" -> "Type Changed"
                else -> "Modified"
            }
            out.add(DisplayLine(file.path, ' ', null, null, "==== $statusLabel: ${file.path} ===="))

            if (file.isBinary == true) {
                out.add(DisplayLine(file.path, ' ', null, null, "[binary file omitted]"))
                out.add(DisplayLine(null, ' ', null, null, ""))
                continue
            }

            val changes = buildChangedOnlyLines(file.path, file.beforeContent ?: "", file.afterContent ?: "")
            if (changes.isEmpty()) {
                out.add(DisplayLine(file.path, ' ', null, null, "[no +/- hunks]"))
            } else {
                out.addAll(changes)
            }
            out.add(DisplayLine(null, ' ', null, null, ""))
        }

        if (out.isEmpty()) {
            out.add(DisplayLine(null, ' ', null, null, "No changes."))
        }
        return out
    }

    private fun buildChangedOnlyLines(path: String, beforeText: String, afterText: String): List<DisplayLine> {
        val contextRadius = 5
        val before = beforeText.lines()
        val after = afterText.lines()
        val n = before.size
        val m = after.size

        if (n * m > 1_000_000) {
            val result = mutableListOf<DisplayLine>()
            val max = maxOf(n, m)
            for (i in 0 until max) {
                val b = before.getOrNull(i)
                val a = after.getOrNull(i)
                if (b == a) {
                    if (b != null) {
                        result.add(DisplayLine(path, ' ', i + 1, i + 1, b))
                    }
                } else {
                    if (b != null) result.add(DisplayLine(path, '-', i + 1, null, b))
                    if (a != null) result.add(DisplayLine(path, '+', null, i + 1, a))
                }
            }
            return withContextLines(result, contextRadius)
        }

        val dp = Array(n + 1) { IntArray(m + 1) }
        for (i in n - 1 downTo 0) {
            for (j in m - 1 downTo 0) {
                dp[i][j] = if (before[i] == after[j]) {
                    dp[i + 1][j + 1] + 1
                } else {
                    maxOf(dp[i + 1][j], dp[i][j + 1])
                }
            }
        }

        var i = 0
        var j = 0
        val out = mutableListOf<DisplayLine>()
        while (i < n && j < m) {
            if (before[i] == after[j]) {
                out.add(DisplayLine(path, ' ', i + 1, j + 1, before[i]))
                i++
                j++
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                out.add(DisplayLine(path, '-', i + 1, null, before[i]))
                i++
            } else {
                out.add(DisplayLine(path, '+', null, j + 1, after[j]))
                j++
            }
        }
        while (i < n) {
            out.add(DisplayLine(path, '-', i + 1, null, before[i]))
            i++
        }
        while (j < m) {
            out.add(DisplayLine(path, '+', null, j + 1, after[j]))
            j++
        }

        return withContextLines(out, contextRadius)
    }

    private fun withContextLines(lines: List<DisplayLine>, contextRadius: Int): List<DisplayLine> {
        if (lines.isEmpty()) {
            return lines
        }

        val changedIndexes = lines.indices.filter { idx ->
            val prefix = lines[idx].prefix
            prefix == '+' || prefix == '-'
        }
        if (changedIndexes.isEmpty()) {
            return emptyList()
        }

        val include = BooleanArray(lines.size)
        for (idx in changedIndexes) {
            val start = maxOf(0, idx - contextRadius)
            val end = minOf(lines.lastIndex, idx + contextRadius)
            for (i in start..end) {
                include[i] = true
            }
        }

        val result = mutableListOf<DisplayLine>()
        var emittedSegment = false
        var i = 0
        while (i < lines.size) {
            if (!include[i]) {
                i++
                continue
            }
            if (emittedSegment) {
                result.add(DisplayLine(null, ' ', null, null, "..."))
            }
            while (i < lines.size && include[i]) {
                result.add(lines[i])
                i++
            }
            emittedSegment = true
        }

        return result
    }

    private fun addCommentAtAnchor() {
        val anchor = selectedAnchor
        if (anchor == null) {
            Messages.showInfoMessage(project, "Place cursor on a '+' or '-' line first.", "Session Review")
            return
        }

        val commentText = commentInputArea.text.trim()
        if (commentText.isBlank()) {
            Messages.showInfoMessage(project, "Enter a comment before adding.", "Session Review")
            return
        }

        val comment = AnchoredFileComment(
            path = anchor.path,
            anchor = anchor,
            text = commentText
        )
        comments.add(comment)
        commentsModel.addElement(comment)
        commentInputArea.text = ""
        refreshHighlights()
    }

    private fun removeSelectedComment() {
        val selected = commentsList.selectedValue ?: return
        comments.remove(selected)
        commentsModel.removeElement(selected)
        refreshHighlights()
    }

    private fun refreshHighlights() {
        diffArea.highlighter.removeAllHighlights()

        // Base diff coloring first
        displayLines.forEachIndexed { idx, line ->
            when (line.prefix) {
                '+' -> highlightDisplayLine(idx + 1, addedLinePainter)
                '-' -> highlightDisplayLine(idx + 1, deletedLinePainter)
            }
        }

        // Commented anchors on top
        for (comment in comments) {
            displayLines.forEachIndexed { idx, line ->
                val matches =
                    line.path == comment.path &&
                        ((comment.anchor.side == CommentSide.BASE && line.prefix == '-' && line.baseLine == comment.anchor.line) ||
                            (comment.anchor.side == CommentSide.SESSION && line.prefix == '+' && line.sessionLine == comment.anchor.line))
                if (matches) {
                    highlightDisplayLine(idx + 1, commentedLinePainter)
                }
            }
        }
    }

    private fun highlightDisplayLine(
        oneBasedLine: Int,
        painter: DefaultHighlighter.DefaultHighlightPainter
    ) {
        if (oneBasedLine > diffArea.lineCount) {
            return
        }
        val start = diffArea.getLineStartOffset(oneBasedLine - 1)
        val end = diffArea.getLineEndOffset(oneBasedLine - 1)
        diffArea.highlighter.addHighlight(start, end, painter)
    }

    private fun updateAnchorLabel() {
        val anchor = selectedAnchor
        anchorInfoLabel.text = if (anchor == null) {
            "Anchor: none"
        } else {
            "Anchor: ${anchor.path} ${anchor.side.displayName.lowercase()} line ${anchor.line}"
        }
    }

    private fun buildSubmissionMessage(comments: List<AnchoredFileComment>): String {
        val grouped = comments.groupBy { it.path }
        val builder = StringBuilder()
        builder.appendLine("Review feedback for session '$sessionName'.")
        builder.appendLine("Please address the following line-specific comments:")
        builder.appendLine()
        for ((path, fileComments) in grouped) {
            builder.appendLine("File: $path")
            for (comment in fileComments) {
                builder.appendLine("- ${comment.anchor.side.displayName}:${comment.anchor.line} -> ${comment.text}")
            }
            builder.appendLine()
        }
        builder.appendLine("After applying fixes, summarize what changed.")
        return builder.toString()
    }

    private data class DisplayLine(
        val path: String?,
        val prefix: Char,
        val baseLine: Int?,
        val sessionLine: Int?,
        val text: String
    )

    private data class AnchoredFileComment(
        val path: String,
        val anchor: CommentAnchor,
        val text: String
    )

    private data class CommentAnchor(
        val path: String,
        val side: CommentSide,
        val line: Int
    )

    private enum class CommentSide(val displayName: String) {
        BASE("Base"),
        SESSION("Session")
    }
}
