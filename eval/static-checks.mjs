/**
 * Deterministic style-guide checks for a component source file.
 *
 * Pure Node (no deps). These are the HARD rules from CLAUDE.md / foundations
 * that can be verified by inspecting the code — no judgment required. They
 * run everywhere (skill, npm, CI) and are the gate that fails a build.
 *
 * Each rule returns findings: { ruleId, severity, line, snippet, message }.
 * Nuanced/spec-coverage checks are the LLM judge's job (see judge.mjs).
 */

const PALETTES =
  'gray|grey|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOR_PREFIXES = 'bg|text|border|ring|fill|stroke|from|to|via|divide|placeholder|outline|accent|caret|decoration';

const isCommentLine = (l) => {
  const t = l.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

/** Run `regex` over each line, optionally skipping comment-only lines. */
function scan(lines, regex, { skipComments = true } = {}) {
  const hits = [];
  lines.forEach((line, i) => {
    if (skipComments && isCommentLine(line)) return;
    const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    let m;
    while ((m = re.exec(line)) !== null) {
      hits.push({ line: i + 1, snippet: (m[0] || line.trim()).slice(0, 80) });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  });
  return hits;
}

const RULES = [
  {
    id: 'no-hardcoded-hex',
    severity: 'error',
    message: 'Hardcoded hex color. Use a semantic color token (e.g. text-text-default).',
    run: (lines) => scan(lines, /#[0-9a-fA-F]{3,8}\b/),
  },
  {
    id: 'no-rgb-hsl',
    severity: 'error',
    message: 'Hardcoded rgb()/hsl() color. Use a semantic color token.',
    run: (lines) => scan(lines, /\b(?:rgba?|hsla?)\(/),
  },
  {
    id: 'no-arbitrary-dimension',
    severity: 'error',
    message:
      'Hardcoded length/hex inside a Tailwind arbitrary value ([...]). Use a token-backed utility, or [var(--token)].',
    // brackets containing a number+unit or a hex — but NOT [var(--x)] / [inherit] etc.
    run: (lines) => scan(lines, /\[[^\]]*(?:\d(?:\.\d+)?(?:px|rem|em|vh|vw|%)|#[0-9a-fA-F]{3,8})[^\]]*\]/),
  },
  {
    id: 'no-default-palette',
    severity: 'error',
    message:
      'Non-semantic Tailwind color (default palette or white/black). Only semantic tokens are allowed (background-*/text-*/border-*/interactive-*).',
    run: (lines) =>
      scan(lines, new RegExp(`\\b(?:${COLOR_PREFIXES})-(?:(?:${PALETTES})-\\d{2,3}|white|black)\\b`)),
  },
  {
    id: 'no-primitive-var',
    severity: 'error',
    message:
      'Primitive token used directly. Reference a semantic token instead (e.g. --background-* not --color-*, --radius-interactive not --radius-md).',
    run: (lines) =>
      scan(lines, /var\(--(?:color|size)-|var\(--radius-(?:none|sm|md|lg|xl|2xl|full)\b/),
  },
  {
    id: 'no-inline-style',
    severity: 'warn',
    message: 'Inline style attribute. Prefer token-backed Tailwind utilities so theming/responsive still apply.',
    run: (lines) => scan(lines, /style=\{\{/, { skipComments: false }),
  },
  {
    id: 'focus-visible-on-interactive',
    severity: 'error',
    message:
      'Interactive component has no :focus-visible styling. Add the focus ring (focus-visible:shadow-focus focus-visible:outline-none).',
    run: (lines) => {
      const text = lines.join('\n');
      const isInteractive = /<button|onClick|role=|tabIndex/.test(text);
      if (!isInteractive) return [];
      return /focus-visible:/.test(text) ? [] : [{ line: 0, snippet: '(file)' }];
    },
  },
];

/**
 * @param {string} source  component file contents
 * @param {{specRel?: string|null}} [opts]  expected spec path to require a link to
 * @returns {{findings: Array, errors: number, warnings: number}}
 */
export function runStaticChecks(source, { specRel = null } = {}) {
  const lines = source.split('\n');
  const findings = [];
  for (const rule of RULES) {
    for (const hit of rule.run(lines)) {
      findings.push({ ruleId: rule.id, severity: rule.severity, message: rule.message, ...hit });
    }
  }
  // Code↔spec link: the component must point at its spec (CLAUDE.md requires it).
  // Skipped when the spec is missing — run.mjs reports that separately.
  if (specRel && !source.includes(`// Spec: ${specRel}`)) {
    findings.push({
      ruleId: 'spec-link',
      severity: 'error',
      line: 0,
      snippet: `// Spec: ${specRel}`,
      message: `Component must link its spec near the top: \`// Spec: ${specRel}\`.`,
    });
  }
  return {
    findings,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
  };
}

export const ruleList = RULES.map(({ id, severity, message }) => ({ id, severity, message }));
