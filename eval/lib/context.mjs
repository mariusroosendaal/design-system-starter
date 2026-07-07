/** Shared paths + token reference used by the runner and the judge. */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStaticChecks } from '../static-checks.mjs';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');
export const has = (rel) => existsSync(join(repoRoot, rel));

export const kebab = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
export const SPEC_DIR = 'design-system/components';
export const COMPONENT_DIR = 'src/components';
export const COMPONENT_FILE_RE = /^[A-Z][A-Za-z0-9]*\.tsx$/;

/**
 * Run the deterministic static checks with the same "spec required" gate
 * used by both `eval/run.mjs` and `audit/audit.mjs`: derive the expected
 * spec path from the component name, and when it's missing, unshift a
 * `spec-required` error finding instead of passing a specRel to the checks.
 */
export function runStaticChecksWithSpecGate(source, name) {
  const specRel = `${SPEC_DIR}/${kebab(name)}.md`;
  const specExists = has(specRel);
  const sc = runStaticChecks(source, { specRel: specExists ? specRel : null });
  if (!specExists) {
    sc.findings.unshift({
      ruleId: 'spec-required',
      severity: 'error',
      line: 0,
      snippet: specRel,
      message: `No spec found at ${specRel}. Every component needs a spec (spec-before-code).`,
    });
    sc.errors += 1;
  }
  return sc;
}

const isPrimitiveVar = (n) =>
  /^--(?:color|size|font-size)-/.test(n) || /^--radius-(?:none|sm|md|lg|xl|2xl|full)$/.test(n);

/** Compact list of allowed SEMANTIC tokens + type classes, for the judge. */
export function buildTokenReference() {
  const css = read('design-system/dist/tokens.css');
  const vars = [...new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))];
  const semantic = vars.filter((n) => !isPrimitiveVar(n)).sort();
  const typeClasses = [...new Set([...css.matchAll(/\.(type-[a-z0-9-]+)/g)].map((m) => m[1]))].sort();
  return [
    'Semantic CSS variables (the only ones a component may use; primitives like --color-*/--size-* are forbidden):',
    semantic.join(', '),
    '',
    'Type ramp classes (apply as className):',
    typeClasses.join(', '),
  ].join('\n');
}
