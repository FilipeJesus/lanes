import * as assert from 'assert';
import { AsyncQueue } from '../AsyncQueue';

suite('AsyncQueue', () => {

	suite('Sequential execution', () => {

		test('should execute tasks in order', async () => {
			const queue = new AsyncQueue();
			const results: number[] = [];

			// Add multiple tasks that push to results array
			const task1 = queue.add(async () => {
				await new Promise(resolve => setTimeout(resolve, 10));
				results.push(1);
				return 1;
			});

			const task2 = queue.add(async () => {
				await new Promise(resolve => setTimeout(resolve, 5));
				results.push(2);
				return 2;
			});

			const task3 = queue.add(async () => {
				results.push(3);
				return 3;
			});

			// Wait for all tasks to complete
			await Promise.all([task1, task2, task3]);

			// Tasks should complete in order despite different durations
			assert.deepStrictEqual(results, [1, 2, 3]);
		});

		test('should execute tasks concurrently added in correct order', async () => {
			const queue = new AsyncQueue();
			const results: string[] = [];

			// Add all tasks at once (concurrent adds)
			const promises = [
				queue.add(async () => {
					results.push('first');
					return 'first';
				}),
				queue.add(async () => {
					await new Promise(resolve => setTimeout(resolve, 5));
					results.push('second');
					return 'second';
				}),
				queue.add(async () => {
					results.push('third');
					return 'third';
				})
			];

			await Promise.all(promises);

			// Should still execute in order
			assert.deepStrictEqual(results, ['first', 'second', 'third']);
		});
	});

	suite('Timeout support', () => {

		test('should timeout task after specified duration', async () => {
			const queue = new AsyncQueue();
			const timeoutMs = 50;

			const task = queue.add(async () => {
				// This task takes longer than timeout
				await new Promise(resolve => setTimeout(resolve, 200));
				return 'should not reach here';
			}, timeoutMs);

			await assert.rejects(
				task,
				/Error: Operation timed out after 50ms/
			);
		});

		test('should use default 30s timeout when not specified', async () => {
			const queue = new AsyncQueue();

			const task = queue.add(async () => {
				// This task completes quickly
				return 'completed';
			});

			// Should complete without timeout (default is 30s)
			const result = await task;
			assert.strictEqual(result, 'completed');
		});
	});

	suite('Error handling', () => {

		test('should reject when task throws error', async () => {
			const queue = new AsyncQueue();

			const task = queue.add(async () => {
				throw new Error('Task failed');
			});

			await assert.rejects(
				task,
				/Error: Task failed/
			);
		});

		test('should continue processing after task failure', async () => {
			const queue = new AsyncQueue();
			const results: number[] = [];

			// First task fails
			const task1 = queue.add(async () => {
				results.push(1);
				throw new Error('First task failed');
			});

			// Second task should still execute
			const task2 = queue.add(async () => {
				results.push(2);
				return 2;
			});

			// First task should reject
			await assert.rejects(task1);

			// Second task should resolve
			const result2 = await task2;
			assert.strictEqual(result2, 2);

			// Both tasks should have been attempted
			assert.deepStrictEqual(results, [1, 2]);
		});

		test('should handle multiple task failures gracefully', async () => {
			const queue = new AsyncQueue();
			const results: string[] = [];

			const task1 = queue.add(async () => {
				results.push('task1');
				throw new Error('Task 1 failed');
			});

			const task2 = queue.add(async () => {
				results.push('task2');
				throw new Error('Task 2 failed');
			});

			const task3 = queue.add(async () => {
				results.push('task3');
				return 'success';
			});

			// First two tasks should fail
			await assert.rejects(task1);
			await assert.rejects(task2);

			// Third task should succeed
			const result3 = await task3;
			assert.strictEqual(result3, 'success');

			// All tasks should have been attempted
			assert.deepStrictEqual(results, ['task1', 'task2', 'task3']);
		});
	});

	suite('Return values', () => {

		test('should resolve with task return value', async () => {
			const queue = new AsyncQueue();

			const task = queue.add(async () => {
				return 42;
			});

			const result = await task;
			assert.strictEqual(result, 42);
		});

		test('should handle complex return values', async () => {
			const queue = new AsyncQueue();

			const complexObject = { foo: 'bar', nested: { value: 123 } };

			const task = queue.add(async () => {
				return complexObject;
			});

			const result = await task;
			assert.deepStrictEqual(result, complexObject);
		});
	});

	suite('Edge cases', () => {

		test('should handle empty queue gracefully', async () => {
			const queue = new AsyncQueue();
			// Just create and destroy - should not hang
			assert.ok(queue);
		});

		test('should handle single task', async () => {
			const queue = new AsyncQueue();

			const task = queue.add(async () => {
				return 'single';
			});

			const result = await task;
			assert.strictEqual(result, 'single');
		});

		test('should handle rapid sequential adds', async () => {
			const queue = new AsyncQueue();
			const count = 10;
			const results: number[] = [];

			const promises: Promise<number>[] = [];
			for (let i = 0; i < count; i++) {
				const index = i; // Capture index for closure
				promises.push(
					queue.add(async () => {
						results.push(index);
						return index;
					})
				);
			}

			await Promise.all(promises);

			// All tasks should complete in order
			assert.strictEqual(results.length, count);
			assert.deepStrictEqual(results, Array.from({ length: count }, (_, i) => i));
		});
	});
});
