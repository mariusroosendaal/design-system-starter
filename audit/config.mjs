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

  // Figma-name → code-name join map, applied (after normalization — see
  // audit/audit.mjs `normalizeName`) when a Figma component set's name
  // doesn't literally equal a code component's normalized name. Keys and
  // values are both already-normalized (lowercase, spaces/underscores →
  // hyphens). Empty for now — nothing in the current inventory needs
  // renaming to match; add entries here as real drift shows up (e.g. a
  // Figma set called "title lockup" that should join to a code component
  // named differently).
  aliases: {},

  // Where the client's Fractal-style component configs live, relative to
  // the repo root. Convention: a folder of <name>.twig + <name>.config.json
  // pairs (Craft/Twig stack) — this repo doesn't have one (it's a React
  // gallery), so audit/code-inventory.mjs's fractal adapter returns []
  // gracefully when this path doesn't exist. Point this at the real
  // template root when running the audit against a client codebase.
  codeInventory: {
    fractalRoot: "templates",
  },

  // How Figma variant-property axes map to code concerns for the join step
  // (audit/audit.mjs). Any axis *not* listed here falls through to the
  // default role 'prop' and is additionally reported as an 'unmappedAxis'
  // info finding, so coverage gaps in this map are visible rather than
  // silently mis-scored.
  //
  //   'css-state'   → the axis drives a CSS pseudo-class / interaction state
  //                   (hover, focus, pressed…) rather than a distinct
  //                   component prop — excluded from prop comparison,
  //                   counted separately as `stateAxes`.
  //   'responsive'  → the axis represents a breakpoint / viewport variant,
  //                   not a prop — SNAP components are responsive via CSS
  //                   media queries, not a JS prop switch. Excluded from
  //                   prop comparison; reported as an info note per match.
  //   'prop'        → the axis should surface as a component prop in code
  //                   (compared by name + enum/boolean value set).
  propertyRoles: {
    // css-state: every "state" axis across the inventory (button, accordion
    // item, checkbox, tab, …) enumerates default/hovered/pressed/focused —
    // exactly the CSS pseudo-classes SNAP uses instead of a `state` prop.
    state: "css-state",

    // responsive: title-lockup / tag-style "breakpoint" axes describe
    // viewport-driven layout, handled by media queries in code, not props.
    breakpoint: "responsive",

    // prop: boolean-ish "is <adjective>" and enum axes seen across the real
    // inventory (button, accordion item, checkbox family, tabs, dropdown,
    // chip, jump link/links, modal header, list item, segment button …).
    // Each should exist as a same-meaning code prop once that component is
    // built.
    "is open": "prop",
    "is disabled": "prop",
    "is invalid": "prop",
    "is checked": "prop",
    "is expanded": "prop",
    "is current": "prop",
    "is active": "prop",
    "is intermediate": "prop",
    "is segmented": "prop",
    "is cancellable": "prop",
    "is icon only": "prop",
    "is selectable": "prop",
    "is first": "prop",
    "icon only": "prop",
    "has notification": "prop",
    "has image": "prop",
    "has back button": "prop",
    variant: "prop",
    size: "prop",
    style: "prop",
    layout: "prop",
    order: "prop",
    position: "prop",
    alignment: "prop",
    "heading level": "prop",
  },
};
