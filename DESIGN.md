# DESIGN.md — Zapidly app UI

Read this before touching any UI in this repo. It is the contract between the
product (this repo) and the brand (the Zapidly marketing site, repo `zapidly`).

The app is sold as **Zapidly**. Customers arrive from the landing page, so the
app must feel like the same product: same coral, same warm neutrals, same type,
same restraint. It does **not** copy the landing page's layouts: the landing page
is a marketing page and this is a dense, all-day work tool.

---

## 1. Where styling lives

| File | Role |
|---|---|
| `src/app/globals.css` | The design system: tokens (§1–2) and all component classes. Hand-written CSS, no Tailwind, no CSS-in-JS. |
| `src/styles/zapidly-tokens.css` | The **brand layer**. Imported after `globals.css` in `src/app/layout.tsx`. Re-assigns brand tokens only. |
| `DESIGN.md` | This file. The rules. |

Rules:
- **Every colour is a token.** No raw hex / rgb in component CSS or in `style={{}}`.
  Need a new colour? Add a token to *both* theme blocks (light + dark, and the
  `[data-theme="dark"]` copy) and explain it in a comment.
- **Brand values change in `zapidly-tokens.css`, not in `globals.css`.** If the
  landing page's palette changes, this is the only file to update.
- The dark-theme selectors in the brand layer mirror `globals.css` exactly
  (`:root:not([data-theme="light"])` inside the media query, plus
  `:root[data-theme="dark"]`). Keep all three blocks in sync.
- Reuse an existing class before you write a new one (see §6). A new screen
  should need little or no new CSS.

---

## 2. Colour

### Brand palette (from the landing page)

| Name | Hex | Used for |
|---|---|---|
| Ink | `#0e0c0a` | Dark canvas |
| Surface | `#1a1714` | Dark cards, light-mode brand bar |
| Paper | `#f5efe6` | Text on dark |
| Coral | `#ff7a45` | Brand accent, logo, dark-mode actions |
| Amber | `#ffb36b` | Second gradient stop only (logo, highlights) |
| Burnt coral | `#b93d10` | Light-mode accent (contrast-safe) |
| WhatsApp green | `#25d366` | WhatsApp only (see below) |

### Semantic tokens: always use these, never the hex values

| Token | Meaning |
|---|---|
| `--bg`, `--bg-elevated`, `--bg-sunken` | Page canvas, raised strip, wells/inputs |
| `--card`, `--card-hover` | Panels, rows, table bodies |
| `--line`, `--line-strong`, `--line-control` | Dividers, emphasised borders, **interactive control borders** (≥3:1) |
| `--text`, `--text-soft`, `--muted` | Primary, secondary, tertiary text (all ≥4.5:1) |
| `--accent` | The one primary action per view, links, selected state. Text-safe. |
| `--accent-bright` | Graphics only: icons, focus outline, progress, chart marks. **Never text in light mode.** |
| `--accent-hover`, `--accent-soft`, `--accent-line`, `--accent-glow` | Hover, tinted background, tinted border, focus ring / selection |
| `--on-accent` | Text/icons on an `--accent` fill (white in light, ink in dark) |
| `--brand-bar`, `--on-brand-bar` | The sidebar brand strip and similar brand chrome |
| `--brand-mark`, `--on-brand-mark` | Logo tile, unread count badges: bright coral + ink in both themes |
| `--danger*`, `--warning*`, `--info*` | Status. Each has `-soft` (background) and `-line` (border). |
| `--wa-*`, `--bubble-*`, `--chat-bg`, `--tick` | The WhatsApp chat replica (§2.2) |

### 2.1 Coral rules
- **One coral action per view.** Primary button = coral; everything else is
  `.btn-secondary` or `.btn-ghost`. Two coral buttons side by side means one of
  them is wrong.
- Coral means "Zapidly / act here". Never use it for errors or destructive
  actions: those use `--danger`. Coral and danger red must not appear on the same
  button row as equal weights.
- Light mode: the coral fill is burnt coral (`#b93d10`) with white text. The
  bright landing coral fails contrast on white (2.6:1), so it is limited to
  graphics (`--accent-bright`) and the logo tile (`--brand-mark`).
- Dark mode: the bright landing coral `#ff7a45` with ink text `#1a0d06`,
  the same as the landing page's primary button.

### 2.2 WhatsApp green is for WhatsApp only
Green belongs to the **chat surface** (bubbles, chat header, ticks, channel
dot for WhatsApp). It is never a brand colour: not for buttons, badges, nav,
success states or empty states. Outside the chat, "success" uses neutral text
plus an icon, or `--accent-soft` for "done with Zapidly" moments.

### 2.3 Themes
Light is the default (all-day tool). Dark is the landing-page palette. Every
screen must be checked in both. The theme comes from the OS or from
`data-theme` on `<html>`, which is set from the `leady_ui_theme` cookie (`src/lib/cookies.ts`) in `layout.tsx`.

---

## 3. Typography

- **Rubik** for everything (Latin + Hebrew in one family, same as the landing page).
  Set via `--font-sans`. Mono: `--font-mono` (system mono stack).
- Scale is fixed: `--fs-2xs 11` / `xs 12` / `sm 13` / `md 14` (body) / `lg 16` /
  `xl 20` / `2xl 24`. **No other sizes**, no `rem` one-offs. The landing page's
  big display type does not belong in the app.
- Weights: 400 body, 500 labels, 600 headings and buttons, 700 only for
  counters/badges.
- Headings get negative tracking (already in base styles); body never does.
- Numbers in tables, counters and badges: `font-variant-numeric: tabular-nums`.
- Hebrew: never uppercase and never letter-space Hebrew text.

---

## 4. Layout, spacing, shape

- Spacing uses `--space-1…7` only (4 / 8 / 12 / 16 / 24 / 32 / 48).
- Radii: `--radius-xs 6` (chips, code), `--radius-sm 8` (buttons, inputs),
  `--radius 12` (cards), `--radius-lg 16` (modals, big panels),
  `--radius-pill` (badges, counts). The landing page's 20px rounded cards and
  pill-shaped buttons are marketing styling. The app uses 8px buttons.
- Elevation: `--shadow-sm` (rows), `--shadow` (popovers), `--shadow-lg` (modals).
  Prefer borders over shadows in dense views.
- Hit area: `--hit` (36px, bumped on touch). Never make an interactive element smaller.
- Chrome sizes: `--sidebar-w`, `--topbar-h`. Don't hardcode them.

### RTL
Hebrew is the default UI language. Use **logical properties only**:
`margin-inline-start`, `padding-inline-end`, `inset-inline-start`,
`border-inline-end`, `text-align: start`. Never `left`/`right` in new CSS.
Directional icons (arrows, chevrons pointing "forward") flip in RTL. Phone
numbers, emails, URLs and code go in `.ltr-isolate`. The logo wordmark is always LTR.

---

## 5. Motion

- Durations: `--transition-fast` (110ms, hover/press), `--transition` (160ms,
  state changes). Nothing in the app runs longer than 250ms.
- Curve: `cubic-bezier(0.23, 1, 0.32, 1)` (the landing page's `--ease-out`),
  already baked into both tokens.
- Animate `transform` and `opacity` only. Press = `translateY(1px)` (already on `.btn`).
- No scroll-reveal, glow blobs, grid backgrounds or gradient text in the app.
  Those are landing-page decoration. The one exception is `.auth-shell`, the login
  screen, which carries a faint coral wash to bridge from the marketing site.
- `prefers-reduced-motion` block at the bottom of `globals.css` must cover
  anything new that moves.

---

## 6. Components: use what exists

| Need | Class |
|---|---|
| Primary action | `.btn` (coral). One per view. |
| Secondary / tertiary | `.btn-secondary`, `.btn-ghost`, icon-only `.btn-icon` |
| Panel | `.card`, clickable `.card-interactive` |
| Status label | `.badge`, `.badge-warn`, `.badge-demo`; counts `.nav-badge` |
| Filters / toggles | `.chip-toggle`, `.chip-row`, `.segmented` |
| Choice between options | `.radio-card` / `.radio-card-grid`, `.choice` |
| Dropdown | `<Select>` (`src/components/Select.tsx`), never a raw `<select>` |
| Data | `.table-wrap` + table, `.pagination-bar`, row actions `.row-actions` |
| Empty screen | `.empty-state`: one sentence + one action |
| Page top | `<PageHeader>` → `.page-header` + `.page-header-actions` |
| Alerts | `.status-banner` |
| Chat | `.chat-panel`, `.thread`, `.bubble`, `.composer`: WhatsApp replica, keep it faithful |

States every interactive component needs: default, hover (pointer only),
`:focus-visible` (2px `--accent-bright` outline, already global), active,
disabled (already styled for `button`, `.btn`, inputs in `globals.css`), and loading where it submits.

---

## 7. Logo

- Logo files: `public/brand/` (SVG). Use the mark alone at ≤32px (sidebar tile,
  favicon), and mark + "zapidly" wordmark (lowercase, weight 600, tracking
  −0.03em, always `dir="ltr"`) where there's room.
- The mark sits on `--brand-bar` or `--card`; never on WhatsApp green, never
  recoloured, never stretched. Minimum size 16px.
- Product name in UI copy: **Zapidly** (capital Z). "Leady" is the legacy
  internal name (repo, package, cookie names). The operator UI still shows it
  (`product` in `src/lib/ui/{en,he}.ts`, `metadata.title` in `layout.tsx`), and
  renaming it is still to do.

---

## 8. Voice in the UI

Short, plain, owner-facing. Verbs on buttons ("Approve", "Send", "אשר"), not
"Submit" / "OK". No invented numbers or fake stats in empty states. Operator copy
lives in `src/lib/ui/{en,he}.ts`, lead-facing copy in `src/lib/copy/`. Never mix them.

---

## 9. Checklist before you finish a UI change

- [ ] No raw colours; new tokens exist in light + both dark blocks
- [ ] Checked light **and** dark
- [ ] Checked Hebrew (RTL) **and** English
- [ ] Only one coral primary action on the screen
- [ ] No green outside the chat surface
- [ ] Type sizes from the scale, spacing from `--space-*`
- [ ] Focus visible, hit areas ≥ `--hit`, reduced-motion covered
- [ ] Mobile width (≤ 640px) still works
