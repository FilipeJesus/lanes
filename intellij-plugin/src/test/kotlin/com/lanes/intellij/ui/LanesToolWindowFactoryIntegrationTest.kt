package com.lanes.intellij.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.nio.file.Files
import java.nio.file.Path

/**
 * IntelliJ platform integration tests for tool window availability behavior.
 *
 * These tests run with a real IDE project fixture, exercising plugin code
 * against IntelliJ APIs rather than only pure protocol/unit models.
 */
class LanesToolWindowFactoryIntegrationTest : BasePlatformTestCase() {

    fun testToolWindowIsUnavailableForNonGitProject() {
        val factory = LanesToolWindowFactory()
        assertFalse(factory.shouldBeAvailable(project))
    }

    fun testToolWindowIsAvailableForGitProject() {
        val factory = LanesToolWindowFactory()
        val basePath = project.basePath ?: error("Expected project basePath in integration test")
        val gitDir: Path = Path.of(basePath, ".git")
        Files.createDirectories(gitDir)

        assertTrue(factory.shouldBeAvailable(project))
    }
}
