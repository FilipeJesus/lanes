package com.lanes.jetbrainsIde.adapters

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.PopupStep
import com.intellij.openapi.ui.popup.util.BaseListPopupStep
import com.lanes.jetbrainsIde.bridge.QuickPickItem
import kotlinx.coroutines.CompletableDeferred
import javax.swing.Icon

/**
 * Adapter for UI dialogs using IntelliJ Platform APIs.
 *
 * All UI operations are executed on the Event Dispatch Thread (EDT).
 */
class UIAdapter(private val project: Project) {

    /**
     * Show an information message dialog.
     *
     * @param message Message to display
     * @param actions Action button labels
     * @return Selected action label or null if cancelled
     */
    fun showInfo(message: String, vararg actions: String): String? {
        return showDialog(message, "Information", Messages.getInformationIcon(), *actions)
    }

    /**
     * Show a warning message dialog.
     *
     * @param message Message to display
     * @param actions Action button labels
     * @return Selected action label or null if cancelled
     */
    fun showWarning(message: String, vararg actions: String): String? {
        return showDialog(message, "Warning", Messages.getWarningIcon(), *actions)
    }

    /**
     * Show an error message dialog.
     *
     * @param message Message to display
     * @param actions Action button labels
     * @return Selected action label or null if cancelled
     */
    fun showError(message: String, vararg actions: String): String? {
        return showDialog(message, "Error", Messages.getErrorIcon(), *actions)
    }

    /**
     * Show a quick pick selection dialog.
     *
     * Uses a CompletableFuture to properly wait for popup dismissal,
     * since onChosen runs asynchronously after invokeAndWait returns.
     *
     * @param items Items to choose from
     * @param options Quick pick options (placeholder, title, etc.)
     * @return Selected item or null if cancelled
     */
    suspend fun showQuickPick(items: List<QuickPickItem>, options: QuickPickOptions? = null): QuickPickItem? {
        val deferred = CompletableDeferred<QuickPickItem?>()

        ApplicationManager.getApplication().invokeLater {
            val popup = JBPopupFactory.getInstance().createListPopup(
                object : BaseListPopupStep<QuickPickItem>(
                    options?.title ?: "Select",
                    items
                ) {
                    override fun getTextFor(value: QuickPickItem): String {
                        return value.label
                    }

                    override fun getIconFor(value: QuickPickItem): Icon? {
                        return null
                    }

                    override fun onChosen(selectedValue: QuickPickItem?, finalChoice: Boolean): PopupStep<*>? {
                        if (finalChoice) {
                            deferred.complete(selectedValue)
                        }
                        return null
                    }

                    override fun isSpeedSearchEnabled(): Boolean {
                        return true
                    }

                    override fun canceled() {
                        deferred.complete(null)
                    }
                }
            )

            popup.showCenteredInCurrentWindow(project)
        }

        return deferred.await()
    }

    /**
     * Show an input box dialog.
     *
     * @param options Input box options (prompt, placeholder, default value, etc.)
     * @return Entered text or null if cancelled
     */
    fun showInputBox(options: InputBoxOptions? = null): String? {
        var result: String? = null

        ApplicationManager.getApplication().invokeAndWait {
            result = Messages.showInputDialog(
                project,
                options?.prompt ?: "Enter value:",
                options?.title ?: "Input",
                Messages.getQuestionIcon(),
                options?.value ?: "",
                null
            )
        }

        return result
    }

    /**
     * Show a generic dialog with custom actions.
     */
    private fun showDialog(message: String, title: String, icon: Icon?, vararg actions: String): String? {
        var selectedAction: String? = null

        ApplicationManager.getApplication().invokeAndWait {
            val actionArray = if (actions.isNotEmpty()) {
                actions
            } else {
                arrayOf("OK")
            }

            val result = Messages.showDialog(
                project,
                message,
                title,
                actionArray,
                0,
                icon
            )

            // result is the index of the selected button
            if (result >= 0 && result < actionArray.size) {
                selectedAction = actionArray[result]
            }
        }

        return selectedAction
    }
}

/**
 * Options for quick pick dialog.
 */
data class QuickPickOptions(
    val placeHolder: String? = null,
    val title: String? = null,
    val canPickMany: Boolean = false
)

/**
 * Options for input box dialog.
 */
data class InputBoxOptions(
    val prompt: String? = null,
    val placeHolder: String? = null,
    val value: String? = null,
    val title: String? = null
)
