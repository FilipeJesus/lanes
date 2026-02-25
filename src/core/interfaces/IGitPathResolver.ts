/**
 * Platform-agnostic git path resolver interface.
 * Abstracts discovery of the git executable path.
 */

export interface IGitPathResolver {
    resolveGitPath(): Promise<string>;
}
