package com.lanes.jetbrainsIde.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.lanes.jetbrainsIde.bridge.BridgeRequester
import com.lanes.jetbrainsIde.bridge.WorkflowCreateParams
import com.lanes.jetbrainsIde.bridge.WorkflowCreateResult
import com.lanes.jetbrainsIde.bridge.WorkflowListParams
import com.lanes.jetbrainsIde.bridge.WorkflowListResult
import com.lanes.jetbrainsIde.bridge.WorkflowMethods
import com.lanes.jetbrainsIde.bridge.WorkflowTemplate
import kotlinx.coroutines.runBlocking
import java.nio.file.Files

class CreateWorkflowDialogIntegrationTest : BasePlatformTestCase() {

    fun testDialogLoadsTemplatesAndCreatesFromScratch() = runBlocking {
        val fakeRequester = FakeBridgeRequester()
        val dialog = CreateWorkflowDialog(project, bridgeRequesterProvider = { _ -> fakeRequester }, autoLoad = false)
        dialog.loadDataForTest()

        val labels = dialog.getTemplateLabelsForTest()
        assertContainsElements(labels, "Start from scratch", "Template: review-template")

        dialog.setWorkflowNameForTest("my-review-workflow")
        dialog.selectTemplateByLabelForTest("Start from scratch")
        dialog.createWorkflowForTest()

        val createParams = fakeRequester.lastCreateParams ?: error("Expected workflow.create request")
        assertEquals("my-review-workflow", createParams.name)
        assertTrue(createParams.content.contains("name: my-review-workflow"))
    }

    fun testDialogCreatesFromTemplateByReplacingName() = runBlocking {
        val templateFile = Files.createTempFile("lanes-template-", ".yaml")
        Files.writeString(
            templateFile,
            """
            name: review-template
            description: sample
            steps: []
            """.trimIndent()
        )

        val fakeRequester = FakeBridgeRequester(templatePath = templateFile.toString())
        val dialog = CreateWorkflowDialog(project, bridgeRequesterProvider = { _ -> fakeRequester }, autoLoad = false)
        dialog.loadDataForTest()
        dialog.setWorkflowNameForTest("copied-workflow")
        dialog.selectTemplateByLabelForTest("Template: review-template")
        dialog.createWorkflowForTest()

        val createParams = fakeRequester.lastCreateParams ?: error("Expected workflow.create request")
        assertEquals("copied-workflow", createParams.name)
        assertTrue(createParams.content.contains("name: copied-workflow"))
        assertTrue(createParams.content.contains("description: sample"))
        val listParams = fakeRequester.lastListParams ?: error("Expected workflow.list request")
        assertTrue(listParams.includeBuiltin)
        assertFalse(listParams.includeCustom)
    }

    private class FakeBridgeRequester(
        private val templatePath: String = "/tmp/review-template.yaml"
    ) : BridgeRequester {
        var lastCreateParams: WorkflowCreateParams? = null
        var lastListParams: WorkflowListParams? = null

        override suspend fun <T> request(method: String, params: Any?, resultType: Class<T>): T {
            val result: Any = when (method) {
                WorkflowMethods.LIST -> {
                    lastListParams = params as WorkflowListParams
                    WorkflowListResult(
                        workflows = listOf(
                            WorkflowTemplate(
                                name = "review-template",
                                path = templatePath,
                                description = "Review flow",
                                isBuiltin = true
                            )
                        )
                    )
                }
                WorkflowMethods.CREATE -> {
                    lastCreateParams = params as WorkflowCreateParams
                    WorkflowCreateResult(path = "/tmp/${lastCreateParams!!.name}.yaml")
                }
                else -> error("Unexpected method: $method")
            }

            @Suppress("UNCHECKED_CAST")
            return result as T
        }
    }
}
