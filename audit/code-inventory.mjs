// Code-side counterpart of audit/figma-inventory.json — the second slice of
// the drift audit. Two adapters feed a common shape:
//
//   { name, source: 'react-tsx' | 'fractal-config', file,
//     props: { <propName>: { kind: 'enum'|'boolean'|'text'|'node'|'other', values?: [sorted] } },
//     status: string|null }
//
// react-tsx: this repo's gallery (src/components/*.tsx) — props parsed via
// regex from the component's `<Name>Props` interface/type, no TS compiler.
// react entries also carry `rawSource` (the file's full text) so callers
// (audit.mjs's eval-static gate) don't have to re-read the file from disk.
//
// fractal-config: the client's Craft/Twig convention (folders of
// <name>.twig + <name>.config.json, Fractal-style) — not present in *this*
// repo, so the adapter is written against the documented shape and returns
// [] gracefully when the configured root doesn't exist.
//
// Pure Node 18+, zero dependencies.

import fs from "node:fs";
import path from "node:path";
import { repoRoot, read, has, COMPONENT_FILE_RE } from "../eval/lib/context.mjs";


// ---------------------------------------------------------------------------
// react-tsx adapter
// ---------------------------------------------------------------------------

const REACT_COMPONENTS_DIR = "src/components";

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// Collect `type Foo = 'a' | 'b' | 'c';` string-literal-union aliases so
// props typed by name (e.g. `variant?: ButtonVariant`) can be resolved to
// their enum values. Non-union type aliases (objects, functions, etc.) are
// left alone — we only ever look them up when a prop's type text matches.
function extractTypeAliases(source) {
  const aliases = new Map();
  const re = /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const [, name, rhs] = m;
    const trimmed = rhs.trim();
    // Only treat as an enum alias if the RHS is *purely* a `|`-union of
    // string literals (nothing else surviving once quotes/pipes/space are
    // stripped).
    const stripped = trimmed.replace(/'[^']*'/g, "").replace(/\s|\|/g, "");
    if (stripped === "" && /'[^']*'/.test(trimmed)) {
      const values = [...trimmed.matchAll(/'([^']*)'/g)].map((mm) => mm[1]);
      aliases.set(name, [...new Set(values)].sort());
    }
  }
  return aliases;
}

// Find the `{ ... }` body of `interface <Name>Props` or `type <Name>Props = { ... }`.
// Returns the raw (unstripped-comment) body substring, or null if not found.
function findPropsBody(source, componentName) {
  const propsName = `${componentName}Props`;
  const declRe = new RegExp(`\\b(?:interface|type)\\s+${propsName}\\b`);
  const declMatch = declRe.exec(source);
  if (!declMatch) return null;

  const braceStart = source.indexOf("{", declMatch.index);
  if (braceStart === -1) return null;

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart + 1, i);
    }
  }
  return null; // unbalanced — give up rather than guess
}

function classifyProp(name, typeStr, typeAliases) {
  if (name === "children") return { kind: "node" };
  if (/\bReactNode\b/.test(typeStr)) return { kind: "node" };
  if (typeStr === "boolean") return { kind: "boolean" };
  if (typeStr === "string") return { kind: "text" };

  // Inline string-literal union, e.g. 'a' | 'b'.
  if (/^'[^']*'(\s*\|\s*'[^']*')*$/.test(typeStr)) {
    const values = [...typeStr.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    return { kind: "enum", values: [...new Set(values)].sort() };
  }

  // Reference to a locally-declared string-literal-union type alias.
  if (typeAliases.has(typeStr)) {
    return { kind: "enum", values: typeAliases.get(typeStr) };
  }

  return { kind: "other" };
}

// Parse the props body into { propName: { kind, values? } }. Best-effort:
// unparsable statements are silently skipped rather than throwing.
function parsePropsBody(body, typeAliases) {
  const props = {};
  const cleaned = stripComments(body).replace(/\s+/g, " ").trim();
  if (!cleaned) return props;

  const statements = cleaned
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    const m = /^([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*(.+)$/.exec(stmt);
    if (!m) continue; // multi-line/complex member we can't confidently split — skip
    const [, name, , rawType] = m;
    if (name === "className") continue; // excluded per spec
    if (/^on[A-Z]/.test(name)) continue; // event handlers excluded per spec
    const typeStr = rawType.trim().replace(/,$/, "");
    props[name] = classifyProp(name, typeStr, typeAliases);
  }
  return props;
}

export function buildReactTsxInventory({ reactComponentsDir = REACT_COMPONENTS_DIR } = {}) {
  let files;
  try {
    files = fs.readdirSync(path.join(repoRoot, reactComponentsDir));
  } catch {
    return []; // directory absent — nothing to inventory
  }

  const entries = [];
  for (const file of files.sort()) {
    if (!COMPONENT_FILE_RE.test(file)) continue; // PascalCase files only, skip index.ts etc.
    const componentName = file.replace(/\.tsx$/, "");
    const relFile = path.join(reactComponentsDir, file);
    const source = read(relFile);

    const entry = {
      name: componentName,
      source: "react-tsx",
      file: relFile,
      props: {},
      status: null, // the React gallery has no status field
      rawSource: source,
    };

    try {
      const body = findPropsBody(source, componentName);
      if (body === null) {
        entry.parseWarning = `No \`${componentName}Props\` interface/type found`;
      } else {
        const typeAliases = extractTypeAliases(source);
        entry.props = parsePropsBody(body, typeAliases);
      }
    } catch (err) {
      entry.parseWarning = `Parse error: ${err.message}`;
    }

    entries.push(entry);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// fractal-config adapter
// ---------------------------------------------------------------------------

function walkForConfigs(dir) {
  let dirents;
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const results = [];
  for (const d of dirents) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) {
      results.push(...walkForConfigs(full));
    } else if (d.isFile() && d.name.endsWith(".config.json")) {
      results.push(full);
    }
  }
  return results;
}

// Classify the union of primitive values collected for one context key
// across a fractal component's default context + all variants' contexts.
function classifyContextValues(values) {
  if (values.length > 0 && values.every((v) => typeof v === "boolean")) {
    return { kind: "boolean" };
  }
  if (values.length > 0 && values.every((v) => typeof v === "string")) {
    return { kind: "enum", values: [...new Set(values)].sort() };
  }
  // Object/array values (or a mix) — not a comparable primitive axis.
  return { kind: "other" };
}

export function fractalRootExists({ codeInventory = {} } = {}) {
  if (!codeInventory.fractalRoot) return false;
  return has(codeInventory.fractalRoot);
}

export function buildFractalConfigInventory({ codeInventory = {} } = {}) {
  const root = codeInventory.fractalRoot;
  if (!root) return [];
  const absRoot = path.join(repoRoot, root);
  const files = walkForConfigs(absRoot).sort();

  const entries = [];
  for (const file of files) {
    const relFile = path.relative(repoRoot, file);
    const baseName = path.basename(file).replace(/\.config\.json$/, "");
    let json;
    try {
      json = JSON.parse(read(relFile));
    } catch (err) {
      entries.push({
        name: baseName,
        source: "fractal-config",
        file: relFile,
        props: {},
        status: null,
        parseWarning: `JSON parse error: ${err.message}`,
      });
      continue;
    }

    const name = typeof json.title === "string" && json.title.trim() ? json.title : baseName;
    const status = typeof json.status === "string" ? json.status : null;

    const contexts = [];
    if (json.context && typeof json.context === "object" && !Array.isArray(json.context)) {
      contexts.push(json.context);
    }
    if (Array.isArray(json.variants)) {
      for (const variant of json.variants) {
        if (variant && typeof variant.context === "object" && !Array.isArray(variant.context)) {
          contexts.push(variant.context);
        }
      }
    }

    const valuesByKey = new Map();
    for (const ctx of contexts) {
      for (const [key, value] of Object.entries(ctx)) {
        if (!valuesByKey.has(key)) valuesByKey.set(key, []);
        valuesByKey.get(key).push(value);
      }
    }

    const props = {};
    for (const key of [...valuesByKey.keys()].sort()) {
      props[key] = classifyContextValues(valuesByKey.get(key));
    }

    entries.push({ name, source: "fractal-config", file: relFile, props, status });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Combined inventory
// ---------------------------------------------------------------------------

export function buildCodeInventory(config = {}) {
  const reactEntries = buildReactTsxInventory(config);
  const fractalEntries = buildFractalConfigInventory(config);
  return [...reactEntries, ...fractalEntries];
}
