package com.lanes.intellij.actions

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.lanes.intellij.ui.CreateSessionDialog

/**
 * Action to create a new Lanes session.
 * Opens the CreateSessionDialog when invoked.
 */
class NewSessionAction : AnAction(
    "New Session",
    "Create a new AI coding session",
    AllIcons.General.Add
), DumbAware {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return

        val dialog = CreateSessionDialog(project)
        dialog.show()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null
    }
}
