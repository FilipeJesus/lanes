/**
 * Workflow template loader with YAML parsing and validation.
 */

import * as fs from 'fs';
import * as yaml from 'yaml';
import type { WorkflowTemplate, AgentConfig, LoopStep, WorkflowStep } from './types';

/**
 * Error thrown when a workflow template is invalid.
 */
export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

/**
 * Type guard to check if a value is a non-null object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if a value is a string.
 */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard to check if a value is an array.
 */
function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Validates an AgentConfig object.
 * @param key - The agent key for error messages
 * @param value - The value to validate
 * @throws WorkflowValidationError if invalid
 */
function validateAgentConfig(key: string, value: unknown): asserts value is AgentConfig {
  if (!isObject(value)) {
    throw new WorkflowValidationError(`Agent '${key}' must be an object`);
  }

  if (!isString(value.description)) {
    throw new WorkflowValidationError(`Agent '${key}' must have a 'description' string`);
  }

  // tools is optional - if omitted, agent has access to all tools
  if (value.tools !== undefined) {
    if (!isArray(value.tools)) {
      throw new WorkflowValidationError(`Agent '${key}' tools must be an array if provided`);
    }

    for (const tool of value.tools) {
      if (!isString(tool)) {
        throw new WorkflowValidationError(`Agent '${key}' tools must be strings`);
      }
    }
  }

  // cannot is optional - if omitted, no special restrictions
  if (value.cannot !== undefined) {
    if (!isArray(value.cannot)) {
      throw new WorkflowValidationError(`Agent '${key}' cannot must be an array if provided`);
    }

    for (const restriction of value.cannot) {
      if (!isString(restriction)) {
        throw new WorkflowValidationError(`Agent '${key}' cannot restrictions must be strings`);
      }
    }
  }
}

/**
 * Validates a LoopStep object.
 * @param loopId - The loop ID for error messages
 * @param index - The step index for error messages
 * @param value - The value to validate
 * @throws WorkflowValidationError if invalid
 */
function validateLoopStep(loopId: string, index: number, value: unknown): asserts value is LoopStep {
  if (!isObject(value)) {
    throw new WorkflowValidationError(`Loop '${loopId}' step ${index} must be an object`);
  }

  if (!isString(value.id)) {
    throw new WorkflowValidationError(`Loop '${loopId}' step ${index} must have an 'id' string`);
  }

  if (!isString(value.instructions)) {
    throw new WorkflowValidationError(`Loop '${loopId}' step '${value.id}' must have an 'instructions' string`);
  }

  if (value.agent !== undefined && !isString(value.agent)) {
    throw new WorkflowValidationError(`Loop '${loopId}' step '${value.id}' agent must be a string if provided`);
  }

  if (value.on_fail !== undefined) {
    const validOnFail = ['retry', 'skip', 'abort'];
    if (!isString(value.on_fail) || !validOnFail.includes(value.on_fail)) {
      throw new WorkflowValidationError(
        `Loop '${loopId}' step '${value.id}' on_fail must be one of: ${validOnFail.join(', ')}`
      );
    }
  }
}

/**
 * Validates a WorkflowStep object.
 * @param index - The step index for error messages
 * @param value - The value to validate
 * @throws WorkflowValidationError if invalid
 */
function validateWorkflowStep(index: number, value: unknown): asserts value is WorkflowStep {
  if (!isObject(value)) {
    throw new WorkflowValidationError(`Step ${index} must be an object`);
  }

  if (!isString(value.id)) {
    throw new WorkflowValidationError(`Step ${index} must have an 'id' string`);
  }

  const stepId = value.id;

  if (!isString(value.type) || (value.type !== 'action' && value.type !== 'loop' && value.type !== 'ralph')) {
    throw new WorkflowValidationError(`Step '${stepId}' must have a 'type' of 'action', 'loop', or 'ralph'`);
  }

  if (value.agent !== undefined && !isString(value.agent)) {
    throw new WorkflowValidationError(`Step '${stepId}' agent must be a string if provided`);
  }

  if (value.type === 'action') {
    if (!isString(value.instructions)) {
      throw new WorkflowValidationError(`Action step '${stepId}' must have an 'instructions' string`);
    }
  }

  if (value.type === 'ralph') {
    if (!isString(value.instructions)) {
      throw new WorkflowValidationError(`Ralph step '${stepId}' must have an 'instructions' string`);
    }
    if (value.n === undefined || typeof value.n !== 'number' || value.n < 1 || !Number.isInteger(value.n)) {
      throw new WorkflowValidationError(`Ralph step '${stepId}' must have an 'n' field with a positive integer value`);
    }
  }
}

/**
 * Validates that all agent references in steps exist in the agents map.
 * @param template - The template to validate
 * @throws WorkflowValidationError if an agent reference is invalid
 */
function validateAgentReferences(template: WorkflowTemplate): void {
  const agentIds = new Set(Object.keys(template.agents || {}));

  // Check main workflow steps
  for (const step of template.steps) {
    if (step.agent && !agentIds.has(step.agent)) {
      throw new WorkflowValidationError(
        `Step '${step.id}' references unknown agent '${step.agent}'`
      );
    }
  }

  // Check loop steps
  if (template.loops) {
    for (const [loopId, loopSteps] of Object.entries(template.loops)) {
      for (const loopStep of loopSteps) {
        if (loopStep.agent && !agentIds.has(loopStep.agent)) {
          throw new WorkflowValidationError(
            `Loop '${loopId}' step '${loopStep.id}' references unknown agent '${loopStep.agent}'`
          );
        }
      }
    }
  }
}

/**
 * Validates that all loop references in steps exist in the loops map.
 * @param template - The template to validate
 * @throws WorkflowValidationError if a loop reference is invalid
 */
function validateLoopReferences(template: WorkflowTemplate): void {
  const loopIds = new Set(Object.keys(template.loops || {}));

  for (const step of template.steps) {
    if (step.type === 'loop' && !loopIds.has(step.id)) {
      throw new WorkflowValidationError(
        `Loop step '${step.id}' references unknown loop definition`
      );
    }
  }
}

/**
 * Validates a complete workflow template.
 * @param value - The value to validate
 * @returns true if the value is a valid WorkflowTemplate
 * @throws WorkflowValidationError if invalid
 */
export function validateTemplate(value: unknown): value is WorkflowTemplate {
  if (!isObject(value)) {
    throw new WorkflowValidationError('Template must be an object');
  }

  // Validate required top-level fields
  if (!isString(value.name)) {
    throw new WorkflowValidationError("Template must have a 'name' string");
  }

  if (!isString(value.description)) {
    throw new WorkflowValidationError("Template must have a 'description' string");
  }

  // Validate agents (optional)
  if (value.agents !== undefined) {
    if (!isObject(value.agents)) {
      throw new WorkflowValidationError("'agents' must be an object if provided");
    }

    for (const [key, agentConfig] of Object.entries(value.agents)) {
      validateAgentConfig(key, agentConfig);
    }
  }

  // Validate loops (optional)
  if (value.loops !== undefined) {
    if (!isObject(value.loops)) {
      throw new WorkflowValidationError("'loops' must be an object if provided");
    }

    for (const [loopId, loopSteps] of Object.entries(value.loops)) {
      if (!isArray(loopSteps)) {
        throw new WorkflowValidationError(`Loop '${loopId}' must be an array of steps`);
      }

      for (let i = 0; i < loopSteps.length; i++) {
        validateLoopStep(loopId, i, loopSteps[i]);
      }
    }
  }

  // Validate steps
  if (!isArray(value.steps)) {
    throw new WorkflowValidationError("Template must have a 'steps' array");
  }

  if (value.steps.length === 0) {
    throw new WorkflowValidationError('Template must have at least one step');
  }

  for (let i = 0; i < value.steps.length; i++) {
    validateWorkflowStep(i, value.steps[i]);
  }

  // Cast to WorkflowTemplate for reference validation
  const template = value as unknown as WorkflowTemplate;

  // Validate cross-references
  validateAgentReferences(template);
  validateLoopReferences(template);

  return true;
}

/**
 * Loads and validates a workflow template from a YAML file.
 * @param templatePath - Absolute path to the YAML template file
 * @returns The parsed and validated WorkflowTemplate
 * @throws WorkflowValidationError if the template is invalid
 * @throws Error if the file cannot be read
 */
export async function loadWorkflowTemplate(templatePath: string): Promise<WorkflowTemplate> {
  // Read the file
  const content = await fs.promises.readFile(templatePath, 'utf-8');

  // Parse YAML
  let parsed: unknown;
  try {
    parsed = yaml.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkflowValidationError(`Invalid YAML syntax: ${message}`);
  }

  // Validate the template
  validateTemplate(parsed);

  return parsed as WorkflowTemplate;
}

/**
 * Loads and validates a workflow template from a YAML string.
 * Useful for testing or inline templates.
 * @param yamlContent - The YAML content as a string
 * @returns The parsed and validated WorkflowTemplate
 * @throws WorkflowValidationError if the template is invalid
 */
export function loadWorkflowTemplateFromString(yamlContent: string): WorkflowTemplate {
  // Parse YAML
  let parsed: unknown;
  try {
    parsed = yaml.parse(yamlContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkflowValidationError(`Invalid YAML syntax: ${message}`);
  }

  // Validate the template
  validateTemplate(parsed);

  return parsed as WorkflowTemplate;
}
