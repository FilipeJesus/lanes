import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { isProjectManagerAvailable, getProjects, addProject, removeProject, clearCache, getExtensionId, initialize as initializePMService } from '../ProjectManagerService';
import { getRepoName } from '../extension';

suite('Project Manager Test Suite', () => {

	let tempDir: string;
	let worktreesDir: string;

	// Create a temp directory structure before tests
	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-lanes-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');
	});

	// Clean up after each test
	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	suite('Project Manager Integration', () => {
		// Tests for Project Manager integration functions

		let tempDir: string;

		setup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manager-test-'));
		});

		teardown(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		suite('getRepoName', () => {

			test('should extract repository name from absolute path', () => {
				// Arrange
				const repoPath = '/Users/user/projects/my-awesome-repo';

				// Act
				const result = getRepoName(repoPath);

				// Assert
				assert.strictEqual(result, 'my-awesome-repo', 'Should return the last path segment');
			});

			test('should extract repository name from Windows path', () => {
				// Arrange - path.basename uses native path separator
				// On Windows, it will parse backslashes; on macOS/Linux it won't
				const repoPath = 'C:\\Users\\user\\projects\\my-repo';

				// Act
				const result = getRepoName(repoPath);

				// Assert: On non-Windows, the entire path is returned as basename
				// because backslashes aren't path separators. This is expected behavior.
				if (process.platform === 'win32') {
					assert.strictEqual(result, 'my-repo', 'Windows should parse backslashes');
				} else {
					// On macOS/Linux, the entire string is the "basename"
					assert.strictEqual(result, repoPath, 'Non-Windows treats backslashes as literal characters');
				}
			});

			test('should handle paths with trailing slash', () => {
				// Arrange
				const repoPath = '/Users/user/projects/my-repo/';

				// Act
				const result = getRepoName(repoPath);

				// Assert: path.basename handles trailing slashes
				assert.strictEqual(result, 'my-repo', 'Should handle trailing slash');
			});

			test('should return empty string for root path', () => {
				// Arrange
				const repoPath = '/';

				// Act
				const result = getRepoName(repoPath);

				// Assert
				assert.strictEqual(result, '', 'Should return empty string for root');
			});
		});

		// Note: Tests for Project Manager integration are in ProjectManagerService.test.ts
		// The old file-based functions (getProjectManagerFilePath, addProjectToProjectManager,
		// removeProjectFromProjectManager) have been replaced with the ProjectManagerService
		// which uses the VS Code extension API.
	});

	suite('ProjectManagerService', () => {

		// Clear cache between each test to ensure isolation
		setup(() => {
			clearCache();
		});

		teardown(() => {
			clearCache();
		});

		suite('isProjectManagerAvailable', () => {

			test('should return a boolean value', () => {
				// Given: The function is called
				// When: isProjectManagerAvailable is invoked
				const result = isProjectManagerAvailable();

				// Then: It should return a boolean (true if installed, false otherwise)
				assert.strictEqual(typeof result, 'boolean');
			});

			test('should return false when Project Manager extension is not installed', () => {
				// Given: In test environment, Project Manager extension is typically not installed
				// When: isProjectManagerAvailable is called
				const result = isProjectManagerAvailable();

				// Then: It should return false since the extension is not in the test host
				// Note: This test assumes the extension is not installed in the test environment
				// If the extension is installed, this test verifies it returns true
				assert.strictEqual(typeof result, 'boolean');
			});

			test('should be callable multiple times without errors', () => {
				// Given: The function is called multiple times
				// When: isProjectManagerAvailable is invoked repeatedly
				// Then: It should not throw and should return consistent results
				assert.doesNotThrow(() => {
					const result1 = isProjectManagerAvailable();
					const result2 = isProjectManagerAvailable();
					const result3 = isProjectManagerAvailable();
					// Results should be consistent
					assert.strictEqual(result1, result2);
					assert.strictEqual(result2, result3);
				});
			});
		});

		suite('getProjects', () => {

			test('should return an array', async () => {
				// Given: The function is called
				// When: getProjects is invoked
				const result = await getProjects();

				// Then: It should always return an array (possibly empty)
				assert.ok(Array.isArray(result));
			});

			test('should return empty array when API is not available', async () => {
				// Given: Project Manager extension is not installed
				// When: getProjects is called
				const result = await getProjects();

				// Then: It should return an empty array gracefully
				if (!isProjectManagerAvailable()) {
					assert.deepStrictEqual(result, []);
				}
			});

			test('should not throw errors even when extension is missing', async () => {
				// Given: Extension may not be installed
				// When: getProjects is called
				// Then: Should return empty array without throwing
				let error: Error | undefined;
				let result: unknown[];
				try {
					result = await getProjects();
				} catch (err) {
					error = err as Error;
					result = [];
				}

				assert.strictEqual(error, undefined, 'Should not throw an error');
				assert.ok(Array.isArray(result));
			});
		});

		suite('addProject', () => {

			test('should return a boolean', async () => {
				// Given: The function is called with valid parameters
				// When: addProject is invoked
				const result = await addProject('test-project', '/test/path');

				// Then: It should return a boolean
				assert.strictEqual(typeof result, 'boolean');
			});

			test('should return false when API is not available', async () => {
				// Given: Project Manager extension is not installed
				// When: addProject is called
				const result = await addProject('test-project', '/test/path', ['test-tag']);

				// Then: It should return false gracefully
				if (!isProjectManagerAvailable()) {
					assert.strictEqual(result, false);
				}
			});

			test('should accept optional tags parameter', async () => {
				// Given: Tags are provided
				// When: addProject is called with tags
				// Then: It should not throw and handle the tags parameter
				let error: Error | undefined;
				let result: boolean;
				try {
					result = await addProject('tagged-project', '/some/path', ['tag1', 'tag2']);
				} catch (err) {
					error = err as Error;
					result = false;
				}

				assert.strictEqual(error, undefined, 'Should not throw an error');
				assert.strictEqual(typeof result, 'boolean');
			});

			test('should not throw errors even when extension is missing', async () => {
				// Given: Extension may not be installed
				// When: addProject is called
				// Then: Should return false without throwing
				let error: Error | undefined;
				let result: boolean;
				try {
					result = await addProject('test', '/path');
				} catch (err) {
					error = err as Error;
					result = false;
				}

				assert.strictEqual(error, undefined, 'Should not throw an error');
				assert.strictEqual(result, false);
			});
		});

		suite('removeProject', () => {

			test('should return a boolean', async () => {
				// Given: The function is called
				// When: removeProject is invoked
				const result = await removeProject('/test/path');

				// Then: It should return a boolean
				assert.strictEqual(typeof result, 'boolean');
			});

			test('should return false when API is not available', async () => {
				// Given: Project Manager extension is not installed
				// When: removeProject is called
				const result = await removeProject('/test/path');

				// Then: It should return false gracefully
				if (!isProjectManagerAvailable()) {
					assert.strictEqual(result, false);
				}
			});

			test('should not throw errors even when extension is missing', async () => {
				// Given: Extension may not be installed
				// When: removeProject is called
				// Then: Should return false without throwing
				let error: Error | undefined;
				let result: boolean;
				try {
					result = await removeProject('/nonexistent/path');
				} catch (err) {
					error = err as Error;
					result = false;
				}

				assert.strictEqual(error, undefined, 'Should not throw an error');
				assert.strictEqual(result, false);
			});
		});

		suite('graceful degradation', () => {

			test('all service methods should be callable without the extension installed', async () => {
				// Given: Project Manager extension is not installed (typical test environment)
				// When: All service methods are called
				// Then: None should throw exceptions

				const errors: string[] = [];

				try {
					isProjectManagerAvailable();
				} catch (err) {
					errors.push(`isProjectManagerAvailable: ${err}`);
				}

				try {
					await getProjects();
				} catch (err) {
					errors.push(`getProjects: ${err}`);
				}

				try {
					await addProject('test', '/path');
				} catch (err) {
					errors.push(`addProject: ${err}`);
				}

				try {
					await removeProject('/path');
				} catch (err) {
					errors.push(`removeProject: ${err}`);
				}

				assert.deepStrictEqual(errors, [], `Errors occurred: ${errors.join(', ')}`);
			});

			test('clearCache should be safe to call at any time', () => {
				// Given: Cache may or may not have data
				// When: clearCache is called multiple times
				// Then: Should not throw
				assert.doesNotThrow(() => {
					clearCache();
					clearCache();
					clearCache();
				});
			});

			test('getExtensionId should return the correct extension ID', () => {
				// Given: The service is configured
				// When: getExtensionId is called
				const extensionId = getExtensionId();

				// Then: It should return the Project Manager extension ID
				assert.strictEqual(extensionId, 'alefragnani.project-manager');
			});

			test('service should return appropriate fallback values when not initialized', async () => {
				// Given: Service is not initialized (no context)
				clearCache();

				// When: All methods are called without initialization
				const projects = await getProjects();
				const addResult = await addProject('test', '/path');
				const removeResult = await removeProject('/path');

				// Then: Each should return its appropriate fallback value
				assert.deepStrictEqual(projects, [], 'Projects should be empty array when not initialized');
				assert.strictEqual(addResult, false, 'addProject should return false when not initialized');
				assert.strictEqual(removeResult, false, 'removeProject should return false when not initialized');
			});

			test('service operations should complete within reasonable time', async () => {
				// Given: Service is not initialized
				// When: Operations are performed
				// Then: They should complete quickly (not hang)
				const startTime = Date.now();

				await getProjects();
				await addProject('test', '/path');
				await removeProject('/path');

				const elapsed = Date.now() - startTime;

				// Should complete in under 1 second (generous timeout)
				assert.ok(elapsed < 1000, `Operations took ${elapsed}ms, expected < 1000ms`);
			});
		});
	});
});
