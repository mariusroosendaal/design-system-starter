// Shared configuration for the design-system drift audit.
//
// This is the first slice: a deterministic Figma component inventory
// (see fetch-figma.mjs). Later slices (code-inventory adapters, the
// join/drift report) will import from here too, so keep anything
// cross-cutting — file identity, page filtering, naming conventions,
// property→code-concern mapping — in this one place.

export const CONFIG = {
  // The SNAP Figma file (see CLAUDE.md at repo root for the design-file URL).
  fileKey: "40hPEX7A9Wt5VsMHxk3xCr",

  // Pages to skip when walking the file. Each entry is tested with
  // RegExp#test() against the raw page name (no anchoring assumptions
  // beyond what's written into the pattern itself — some intentionally
  // match a substring, e.g. sprint/tooling pages).
  //
  // Tuned against the real file (see audit/README.md / task report for the
  // one-time adjustment): the file has group-header pages (FOUNDATION,
  // COMPONENTS, PATTERNS, TBD) whose actual content lives on child pages
  // named "└ <name>" — those child pages are what we want to scan, so only
  // the group-header page itself and the *foundation* "└ …" pages (color,
  // typography, layout, styles, icons — token/asset docs, not components)
  // are excluded below. The "└ …" pages under COMPONENTS / PATTERNS / TBD
  // fall through and get scanned.
  excludePages: [
    /^SPRINTS$/i, // sprint board group header
    /^REFERENCE$/i, // reference group header
    /^archive$/i, // old/retired work
    /tools and assets/i, // scratch page, not components
    /^Component index$/i, // manually-maintained index, not source of truth
    /^-+$/, // "-" separator pages between groups
    /^\s*$/, // blank/whitespace-only page names (also separators)
    /snap proto/i, // prototype sandbox page
    /01\.\d\d/, // sprint pages, e.g. "└ 01.01"
    /^└ (color|typography|layout|styles|icons)$/, // foundation sub-pages (tokens/docs, not components)
    /^(FOUNDATION|COMPONENTS|PATTERNS|TBD)$/, // group-header pages (content lives on their "└ …" children)
  ],

  // When false (default), skip components/component sets whose name starts
  // with '.' or '_' — Figma's convention for "private", internal-use-only
  // components (e.g. ".design system header") that aren't part of the
  // published component surface.
  includePrivate: false,

  // Figma-name → code-name join map, e.g. { "accordion item": "AccordionItem" }.
  // Placeholder for the future join step that matches this Figma inventory
  // against a code inventory. Unused by fetch-figma.mjs today.
  aliases: {},

  // Seed map documenting how Figma variant-property names are expected to
  // map to code concerns. Not read by fetch-figma.mjs — this is here so the
  // future join step has a documented starting point rather than inventing
  // the mapping ad hoc.
  //   'css-state' → the property drives a CSS pseudo-class / interaction
  //                 state (hover, focus, pressed, disabled…) rather than a
  //                 distinct component prop.
  //   'prop'      → the property should surface as a component prop in code.
  propertyRoles: {
    state: "css-state",
    "is open": "prop",
    variant: "prop",
    size: "prop",
  },
};
