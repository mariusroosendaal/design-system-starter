#!/usr/bin/env node
/**
 * Component style-guide eval.
 *
 *   node eval/run.mjs <Component> [--no-judge] [--json] [--model <id>]
 *   node eval/run.mjs --all       [--no-judge] [--json]
 *
 * Layered: deterministic static checks (always; the hard gate) + an LLM judge
 * against eval/rubric.md (when ANTHROPIC_API_KEY + @anthropic-ai/sdk present).
 * Exit code 1 if any component has a static error or a judge `fail`.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, read, has } from './lib/context.mjs';
import { runStaticChecks } from './static-checks.mjs';
import { runJudge } from './judge.mjs';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const modelIdx = argv.indexOf('--model');
const model = modelIdx >= 0 ? argv[modelIdx + 1] : undefined;
const names = argv.filter((a) => !a.startsWith('--') && a !== model);
const asJson = flags.has('--json');
const noJudge = flags.has('--no-judge');

const kebab = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const COMPONENT_DIR = 'src/components';
const SPEC_DIR = 'design-system/components';

function discoverAll() {
  return readdirSync(join(repoRoot, COMPONENT_DIR))
    .filter((f) => /^[A-Z][A-Za-z0-9]*\.tsx$/.test(f))
    .map((f) => f.replace(/\.tsx$/, ''))
    .filter((name) => has(`${SPEC_DIR}/${kebab(name)}.md`)); // only components with a spec
}

async function evalComponent(name) {
  const componentRel = `${COMPONENT_DIR}/${name}.tsx`;
  const specRel = `${SPEC_DIR}/${kebab(name)}.md`;
  const result = { name, componentRel, specRel, static: null, judge: null, pass: true };

  if (!has(componentRel)) {
    result.pass = false;
    result.error = `Component file not found: ${componentRel}`;
    return result;
  }
  const source = read(componentRel);
  const specSource = has(specRel) ? read(specRel) : null;

  // 1) deterministic gate
  const sc = runStaticChecks(source, { specRel: specSource ? specRel : null });
  if (!specSource) {
    sc.findings.unshift({
      ruleId: 'spec-required',
      severity: 'error',
      line: 0,
      snippet: specRel,
      message: `No spec found at ${specRel}. Every component needs a spec (spec-before-code).`,
    });
    sc.errors += 1;
  }
  result.static = sc;
  if (sc.errors > 0) result.pass = false;

  // 2) LLM judge
  if (!noJudge) {
    const judged = await runJudge({ componentName: name, componentSource: source, specSource, model });
    result.judge = judged;
    if (judged.available && judged.verdict?.overall === 'fail') result.pass = false;
  }
  return result;
}

function printHuman(r) {
  const line = '─'.repeat(54);
  console.log(`\n${line}\n  ${r.name}  ·  ${r.componentRel}\n${line}`);
  if (r.error) {
    console.log(`  ✗ ${r.error}`);
    return;
  }
  const { findings, errors, warnings } = r.static;
  console.log(`\n  Static checks: ${errors} error(s), ${warnings} warning(s)`);
  if (findings.length === 0) console.log('    ✓ no issues');
  for (const f of findings) {
    const mark = f.severity === 'error' ? '✗' : '⚠';
    const at = f.line ? `:${f.line}` : '';
    console.log(`    ${mark} [${f.ruleId}]${at} ${f.message}`);
    if (f.snippet && f.line) console.log(`        ↳ ${f.snippet}`);
  }

  if (r.judge) {
    if (!r.judge.available) {
      console.log(`\n  LLM judge: skipped (${r.judge.reason})`);
    } else {
      const v = r.judge.verdict;
      console.log(`\n  LLM judge (${r.judge.model}): ${v.overall.toUpperCase()} · score ${v.score}/100`);
      for (const c of v.criteria) {
        const mark = c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
        console.log(`    ${mark} ${c.name}${c.status !== 'pass' ? ` — ${c.notes}` : ''}`);
      }
      if (v.summary) console.log(`     summary: ${v.summary}`);
    }
  }
  console.log(`\n  ⇒ ${r.pass ? 'PASS' : 'FAIL'}`);
}

const targets = flags.has('--all') ? discoverAll() : names;
if (targets.length === 0) {
  console.error('Usage: node eval/run.mjs <Component> [--no-judge] [--json] [--model <id>]\n       node eval/run.mjs --all');
  process.exit(2);
}

const results = [];
for (const name of targets) results.push(await evalComponent(name));

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  results.forEach(printHuman);
  const failed = results.filter((r) => !r.pass).map((r) => r.name);
  console.log(`\n${'═'.repeat(54)}`);
  console.log(`  ${results.length - failed.length}/${results.length} passed` + (failed.length ? ` · failed: ${failed.join(', ')}` : ''));
}

process.exit(results.every((r) => r.pass) ? 0 : 1);
