/**
 * LLM judge — scores a component against the rubric (eval/rubric.md) using
 * the Anthropic API. Used by `npm run eval` / CI. The /eval-component skill
 * does the same judgment in-session without the SDK.
 *
 * Gracefully unavailable if the SDK isn't installed or no API key is set;
 * the deterministic checks remain the hard gate in that case.
 */
import { read, buildTokenReference } from './lib/context.mjs';

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['overall', 'score', 'criteria', 'violations', 'summary'],
  properties: {
    overall: { type: 'string', enum: ['pass', 'fail'] },
    score: { type: 'number', minimum: 0, maximum: 100 },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'status', 'notes'],
        properties: {
          name: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'warn', 'fail'] },
          notes: { type: 'string' },
        },
      },
    },
    violations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'criterion', 'detail'],
        properties: {
          severity: { type: 'string', enum: ['error', 'warn'] },
          criterion: { type: 'string' },
          detail: { type: 'string' },
          line: { type: ['number', 'string'] },
          suggestion: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
};

export async function runJudge({ componentName, componentSource, specSource, model }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { available: false, reason: 'ANTHROPIC_API_KEY not set' };
  }
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    return { available: false, reason: '@anthropic-ai/sdk not installed (npm i -D @anthropic-ai/sdk)' };
  }

  const client = new Anthropic();
  const rubric = read('eval/rubric.md');
  const tokenReference = buildTokenReference();

  const userContent = [
    `Component: ${componentName}`,
    '',
    '## Allowed tokens (reference)',
    tokenReference,
    '',
    '## Spec (the contract)',
    '```md',
    specSource || '(no spec found — flag this under Spec coverage)',
    '```',
    '',
    '## Implementation',
    '```tsx',
    componentSource,
    '```',
  ].join('\n');

  const res = await client.messages.create({
    model: model || process.env.EVAL_MODEL || 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: rubric,
    tools: [{ name: 'report', description: 'Return the structured eval verdict.', input_schema: VERDICT_SCHEMA }],
    tool_choice: { type: 'tool', name: 'report' },
    messages: [{ role: 'user', content: userContent }],
  });

  const tool = res.content.find((c) => c.type === 'tool_use');
  if (!tool) return { available: false, reason: 'model returned no verdict' };
  return { available: true, verdict: tool.input, model: res.model, usage: res.usage };
}

export { VERDICT_SCHEMA };
