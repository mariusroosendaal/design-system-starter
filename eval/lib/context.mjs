/** Shared paths + token reference used by the runner and the judge. */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');
export const has = (rel) => existsSync(join(repoRoot, rel));

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
