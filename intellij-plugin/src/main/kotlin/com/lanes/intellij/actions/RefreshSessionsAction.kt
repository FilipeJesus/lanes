package com.lanes.intellij.actions

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.lanes.intellij.ui.LanesToolWindowFactory

/**
 * Action to refresh the sessions tree.
 * Triggers a reload of all sessions from the bridge.
 */
class RefreshSessionsAction : AnAction(
    "Refresh Sessions",
    "Refresh the list of sessions",
    AllIcons.Actions.Refresh
), DumbAware {

    override fun actionPerformed(e: AnActionEvent) {
        val refreshCallback = e.getData(LanesToolWindowFactory.REFRESH_CALLBACK_KEY) ?: return
        refreshCallback.invoke()
    }

    override fun update(e: AnActionEvent) {
        val refreshCallback = e.getData(LanesToolWindowFactory.REFRESH_CALLBACK_KEY)
        e.presentation.isEnabled = e.project != null && refreshCallback != null
    }
}
