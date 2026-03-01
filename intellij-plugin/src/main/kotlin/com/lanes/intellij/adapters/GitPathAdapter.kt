package com.lanes.intellij.adapters

import com.intellij.openapi.diagnostic.Logger
import git4idea.config.GitExecutableManager

class GitPathAdapter {

    private val logger = Logger.getInstance(GitPathAdapter::class.java)

    fun resolveGitPath(): String {
        return try {
            val gitPath = GitExecutableManager.getInstance().pathToGit
            logger.info("Resolved Git path from Git4Idea: $gitPath")
            gitPath
        } catch (e: Exception) {
            logger.warn("Failed to resolve Git path from Git4Idea, falling back to 'git'", e)
            "git"
        }
    }
}
