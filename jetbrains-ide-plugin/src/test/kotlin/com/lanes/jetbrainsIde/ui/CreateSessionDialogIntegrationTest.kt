package com.lanes.jetbrainsIde.ui

import com.lanes.jetbrainsIde.bridge.AgentListResult
import com.lanes.jetbrainsIde.bridge.AgentMethods
import com.lanes.jetbrainsIde.bridge.BranchInfo
import com.lanes.jetbrainsIde.bridge.BridgeRequester
import com.lanes.jetbrainsIde.bridge.CodeAgentConfig
import com.lanes.jetbrainsIde.bridge.GitListBranchesResult
import com.lanes.jetbrainsIde.bridge.GitMethods
import com.lanes.jetbrainsIde.bridge.SessionCreateParams
import com.lanes.jetbrainsIde.bridge.SessionCreateResult
import com.lanes.jetbrainsIde.bridge.SessionMethods
import com.lanes.jetbrainsIde.bridge.WorkflowMethods
import com.lanes.jetbrainsIde.bridge.WorkflowListResult
import com.lanes.jetbrainsIde.bridge.WorkflowTemplate
import com.lanes.jetbrainsIde.bridge.PermissionMode
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.runBlocking

class CreateSessionDialogIntegrationTest : BasePlatformTestCase() {

    fun testDialogLoadsBranchWorkflowAndAgentOptions() = runBlocking {
        val fakeRequester = FakeBridgeRequester()
        val dialog = CreateSessionDialog(project, bridgeRequesterProvider = { _ -> fakeRequester }, autoLoad = false)
        dialog.loadDataForTest()

        val branches = dialog.getBranchItemsForTest()
        val workflows = dialog.getWorkflowItemsForTest()
        val agents = dialog.getAgentItemsForTest()

        assertContainsElements(branches, "(none - use current)", "main", "feature/test")
        assertContainsElements(workflows, "(none)", "review (builtin)")
        assertContainsElements(agents, "Claude")
    }

    fun testDialogCreatesSessionWithSelectedFormValues() = runBlocking {
        val fakeRequester = FakeBridgeRequester()
        var openedSession: String? = null
        var openedWorktreePath: String? = null
        var openedCommand: String? = null
        val dialog = CreateSessionDialog(
            project,
            bridgeRequesterProvider = { _ -> fakeRequester },
            terminalOpener = { sessionName, worktreePath, command ->
                openedSession = sessionName
                openedWorktreePath = worktreePath
                openedCommand = command
            },
            autoLoad = false
        )
        dialog.loadDataForTest()
        dialog.setSessionNameForTest("feat-auth")
        dialog.selectBranchForTest("feature/test")
        dialog.selectWorkflowForTest("review (builtin)")
        dialog.selectAgentForTest("Claude")
        dialog.setInitialPromptForTest("Please investigate failing CI and propose fixes.")

        dialog.createSessionForTest()

        val createParams = fakeRequester.lastCreateParams
            ?: error("Expected session.create request to be sent")

        assertEquals("feat-auth", createParams.name)
        assertEquals("feature/test", createParams.branch)
        assertEquals("review", createParams.workflow)
        assertEquals("claude", createParams.agent)
        assertEquals("Please investigate failing CI and propose fixes.", createParams.prompt)
        assertEquals("feat-auth", openedSession)
        assertEquals("/tmp/worktrees/feat-auth", openedWorktreePath)
        assertEquals("""claude --settings "/tmp/settings/claude-settings.json"""", openedCommand)
    }

    fun testDialogCreatesSessionWithBypassPermissionsWhenChecked() = runBlocking {
        val fakeRequester = FakeBridgeRequester()
        val dialog = CreateSessionDialog(project, bridgeRequesterProvider = { _ -> fakeRequester }, autoLoad = false)
        dialog.loadDataForTest()
        dialog.setSessionNameForTest("feat-bypass")
        dialog.selectBranchForTest("main")
        dialog.selectAgentForTest("Claude")
        dialog.setBypassPermissionsForTest(true)

        dialog.createSessionForTest()

        val createParams = fakeRequester.lastCreateParams
            ?: error("Expected session.create request to be sent")
        assertEquals("bypassPermissions", createParams.permissionMode)
    }

    private class FakeBridgeRequester : BridgeRequester {
        var lastCreateParams: SessionCreateParams? = null

        override suspend fun <T> request(method: String, params: Any?, resultType: Class<T>): T {
            val result: Any = when (method) {
                GitMethods.LIST_BRANCHES -> GitListBranchesResult(
                    branches = listOf(
                        BranchInfo(name = "main", isCurrent = true),
                        BranchInfo(name = "feature/test", isCurrent = false)
                    )
                )
                WorkflowMethods.LIST -> WorkflowListResult(
                    workflows = listOf(
                        WorkflowTemplate(
                            name = "review",
                            path = "/tmp/review.yaml",
                            description = "Code review flow",
                            isBuiltin = true
                        )
                    )
                )
                AgentMethods.LIST -> AgentListResult(
                    agents = listOf(
                        CodeAgentConfig(
                            name = "claude",
                            displayName = "Claude",
                            cliCommand = "claude",
                            permissionModes = listOf(
                                PermissionMode(
                                    id = "acceptEdits",
                                    label = "Accept Edits",
                                    flag = "--permission-mode acceptEdits"
                                ),
                                PermissionMode(
                                    id = "bypassPermissions",
                                    label = "Bypass Permissions",
                                    flag = "--dangerously-skip-permissions"
                                )
                            )
                        )
                    )
                )
                SessionMethods.CREATE -> {
                    lastCreateParams = params as SessionCreateParams
                    SessionCreateResult(
                        sessionName = lastCreateParams!!.name,
                        worktreePath = "/tmp/worktrees/${lastCreateParams!!.name}",
                        sessionId = "session-1",
                        command = """claude --settings "/tmp/settings/claude-settings.json""""
                    )
                }
                else -> error("Unexpected method in test bridge requester: $method")
            }

            @Suppress("UNCHECKED_CAST")
            return result as T
        }
    }
}
