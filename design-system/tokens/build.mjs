#!/usr/bin/env node
/**
 * Design-token build.
 *
 * Reads every *.json token file in this directory (W3C Design Tokens format,
 * the source of truth), resolves aliases to CSS var() references, and emits
 * design-system/dist/tokens.css:
 *
 *   :root                      → primitives + semantic LIGHT theme + 'sm' breakpoint
 *   [data-theme="dark"]        → semantic color overrides
 *   [data-theme="wireframe"]   → semantic color overrides
 *   @media (min-width: …)      → responsive dimension overrides (md/lg/xl/2xl)
 *   .type-*                    → typography ramp utility classes
 *   --shadow-*                 → composed box-shadow values
 *
 * No dependencies. Run:  node design-system/tokens/build.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'dist');
const OUT_FILE = join(OUT_DIR, 'tokens.css');

const BREAKPOINTS = { sm: 0, md: 600, lg: 900, xl: 1200, '2xl': 1500 };
const BP_ORDER = ['sm', 'md', 'lg', 'xl', '2xl'];

// segment camelCase → kebab, then join path on "-"  →  CSS var stem (no leading --)
const seg = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const pathToVar = (p) => p.split('.').map(seg).join('-');

// expand a ramp breakpoint-range key ("sm", "2xl", "md-lg", "sm-2xl") to the
// list of breakpoints it covers, contiguous from start to end.
const expandRange = (r) => {
  const start = BP_ORDER.find((bp) => r === bp || r.startsWith(bp + '-'));
  const end = [...BP_ORDER].reverse().find((bp) => r === bp || r.endsWith('-' + bp));
  if (!start || !end) return [];
  return BP_ORDER.slice(BP_ORDER.indexOf(start), BP_ORDER.indexOf(end) + 1);
};

// render a {prop: value} map as indented CSS declarations
const declBlock = (props, indent = '  ') =>
  Object.entries(props).map(([k, v]) => `${indent}${k}: ${v};`).join('\n');

// resolve a token value to a CSS value string
function resolveValue(v) {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    const m = v.match(/^\{(.+)\}$/);
    return m ? `var(--${pathToVar(m[1])})` : v;
  }
  return v; // objects/arrays handled by callers (typography, shadow)
}

// flatten one token tree into leaf records, inheriting $type and the file's modeType
function flatten(node, path, type, modeType, out) {
  if (node && typeof node === 'object' && '$value' in node) {
    out.push({
      path,
      type: node.$type || type,
      value: node.$value,
      modes: node.$extensions?.['ds.modes'] || null,
      textTransform: node.$extensions?.['ds.textTransform'] || null,
      modeType,
    });
    return;
  }
  if (node && typeof node === 'object') {
    const t = node.$type || type;
    for (const [k, child] of Object.entries(node)) {
      if (k.startsWith('$')) continue;
      flatten(child, path ? `${path}.${k}` : k, t, modeType, out);
    }
  }
}

// ---- load every token file ----
const tokens = [];
for (const file of readdirSync(HERE).filter((f) => f.endsWith('.json'))) {
  const json = JSON.parse(readFileSync(join(HERE, file), 'utf8'));
  const modeType = json.$extensions?.['ds.modeType'] || null;
  flatten(json, '', null, modeType, tokens);
}

// ---- buckets ----
const rootDecls = [];                       // :root scalar custom props
const themeDecls = {}; // theme name → declarations (discovered from the tokens)
const bpDecls = { md: [], lg: [], xl: [], '2xl': [] };
const shadowDecls = [];
const typeClasses = [];                     // discrete .type-<role>-<bp>
const typeFamilies = {};                    // family → { bp → props } for responsive classes

for (const t of tokens) {
  if (t.type === 'shadow') {
    const arr = Array.isArray(t.value) ? t.value : [t.value];
    const css = arr
      .map((s) => `${s.offsetX} ${s.offsetY} ${s.blur} ${s.spread} ${resolveValue(s.color)}`)
      .join(', ');
    shadowDecls.push(`  --${pathToVar(t.path)}: ${css};`);
    continue;
  }

  if (t.type === 'typography') {
    const v = t.value;
    const props = {
      'font-family': resolveValue(v.fontFamily),
      'font-weight': resolveValue(v.fontWeight),
      'font-size': resolveValue(v.fontSize),
      'line-height': resolveValue(v.lineHeight),
      'letter-spacing': resolveValue(v.letterSpacing),
    };
    if (t.textTransform) props['text-transform'] = t.textTransform;

    // discrete, single-breakpoint class (explicit control)
    const cls = t.path.replace(/^ramp\./, '').split('.').map(seg).join('-');
    typeClasses.push(`.type-${cls} {\n${declBlock(props)}\n}`);

    // collect into a responsive family: ramp.<role>.<key>, key carries the
    // breakpoint range and an optional "-strong" weight variant
    const [, role, key] = t.path.split('.');
    const strong = key.endsWith('-strong');
    const family = role + (strong ? '-strong' : '');
    const range = strong ? key.slice(0, -'-strong'.length) : key;
    for (const bp of expandRange(range)) {
      (typeFamilies[family] ||= {})[bp] = props;
    }
    continue;
  }

  // scalar custom property (fontFamily values carry their own quoting in the JSON)
  const name = `--${pathToVar(t.path)}`;
  rootDecls.push(`  ${name}: ${resolveValue(t.value)};`);

  if (!t.modes) continue;

  if (t.modeType === 'theme') {
    for (const [theme, val] of Object.entries(t.modes)) {
      (themeDecls[theme] ||= []).push(`  ${name}: ${resolveValue(val)};`);
    }
  } else if (t.modeType === 'breakpoint') {
    // emit at each breakpoint only when the value changes from the previous active one
    let prev = resolveValue(t.value); // sm
    for (const bp of ['md', 'lg', 'xl', '2xl']) {
      const cur = resolveValue(t.modes[bp]);
      if (cur !== undefined && cur !== prev) {
        bpDecls[bp].push(`    ${name}: ${cur};`);
        prev = cur;
      }
    }
  }
}

// ---- build responsive type-family classes (.type-<family>) ----
const familyClasses = [];
for (const [family, byBp] of Object.entries(typeFamilies)) {
  const present = BP_ORDER.filter((bp) => byBp[bp]);
  if (!present.length) continue;
  const base = byBp[present[0]]; // smallest available (sm for every ramp family)
  let block = `.type-${family} {\n${declBlock(base)}\n}`;
  let prev = base;
  for (const bp of BP_ORDER.slice(1)) {
    const cur = byBp[bp];
    if (cur && JSON.stringify(cur) !== JSON.stringify(prev)) {
      block += `\n@media (min-width: ${BREAKPOINTS[bp]}px) {\n  .type-${family} {\n${declBlock(cur, '    ')}\n  }\n}`;
      prev = cur;
    }
  }
  familyClasses.push(block);
}

// ---- assemble ----
const banner = `/* ------------------------------------------------------------------ *
 * Design tokens (generated)
 * GENERATED FILE — do not edit by hand.
 * Source: design-system/tokens/*.json  ·  rebuild: node design-system/tokens/build.mjs
 * ------------------------------------------------------------------ */\n`;

let css = banner + `\n:root {\n${rootDecls.join('\n')}\n${shadowDecls.join('\n')}\n}\n`;

for (const [theme, decls] of Object.entries(themeDecls)) {
  if (decls.length) css += `\n[data-theme="${theme}"] {\n${decls.join('\n')}\n}\n`;
}

for (const bp of ['md', 'lg', 'xl', '2xl']) {
  if (bpDecls[bp].length) {
    css += `\n@media (min-width: ${BREAKPOINTS[bp]}px) {\n  :root {\n${bpDecls[bp].join('\n')}\n  }\n}\n`;
  }
}

css += `\n/* ---- typography: responsive family classes (preferred) ---- */\n${familyClasses.join('\n\n')}\n`;
css += `\n/* ---- typography: discrete per-breakpoint classes (explicit control) ---- */\n${typeClasses.join('\n\n')}\n`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, css);
console.log(`✓ wrote ${OUT_FILE}`);
console.log(
  `  ${tokens.length} tokens · ${rootDecls.length} root vars · ${familyClasses.length} responsive + ${typeClasses.length} discrete type classes`,
);
