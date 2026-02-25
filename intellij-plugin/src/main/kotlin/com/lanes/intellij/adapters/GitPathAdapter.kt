package com.lanes.intellij.adapters

import com.intellij.openapi.diagnostic.Logger

/**
 * Adapter for resolving Git executable path.
 *
 * Uses IntelliJ's Git4Idea plugin to find the configured Git executable.
 */
class GitPathAdapter {

    private val logger = Logger.getInstance(GitPathAdapter::class.java)

    /**
     * Resolve the Git executable path.
     *
     * Attempts to use Git4Idea's GitExecutableManager to find the configured Git via reflection
     * to avoid compile-time dependency. Falls back to "git" if Git4Idea is not available.
     *
     * @return Path to Git executable
     */
    fun resolveGitPath(): String {
        return try {
            // Use reflection to avoid compile-time dependency on Git4Idea
            val gitExecutableManagerClass = Class.forName("git4idea.config.GitExecutableManager")
            val getInstanceMethod = gitExecutableManagerClass.getMethod("getInstance")
            val instance = getInstanceMethod.invoke(null)
            val getPathToGitMethod = gitExecutableManagerClass.getMethod("getPathToGit")
            val gitExecutable = getPathToGitMethod.invoke(instance) as String

            logger.info("Resolved Git path from Git4Idea: $gitExecutable")
            gitExecutable
        } catch (e: Exception) {
            logger.warn("Failed to resolve Git path from Git4Idea, falling back to 'git'", e)
            "git"
        }
    }
}
