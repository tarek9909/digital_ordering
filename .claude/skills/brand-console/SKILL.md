---
name: brand-console
description: Tanbeeh platform brand ("Ember" theme) for the super admin console (web-console), the marketing site (web-site) and the platform defaults on customer pages. Use before building or restyling any UI in those apps, choosing colours, fonts, radii or shadows, or adding a new page, component or email there. Not for tenant (restaurant) branding, which uses each venue's own colour.
---

# Tanbeeh brand: Ember

White base, warm charcoal ("ink") partner, burnt-orange ("ember") accent. It should feel premium and modern, with Gen Z energy shown in a few small details and strictness where the data lives.

## Where it lives

- Tokens and fonts: `frontend/packages/ui/src/ember.css`. Import it after `@dop/ui/tokens.css` (see `apps/web-console/src/main.tsx`).
- `tokens.css` holds neutral defaults for every app. `ember.css` only redefines tokens, so components never hard-code brand values.
- Fonts are self-hosted through `@fontsource/*` in `@dop/ui`. The CSP in `deploy/Caddyfile` blocks Google Fonts, so never add a fonts.googleapis.com link.
- Customer apps also import `apps/web-customer/src/customer.css`, which maps `--color-primary` to the venue's `--brand-band`, because the venue's colour leads there.

## Logo ("Almost ready")

- A ring that has nearly closed, with an ember dot on its leading tip: an order about to be called. Use `<BrandMark />` from `@dop/ui` (ink tile) or `<BrandMark tone="light" />` on ink surfaces. Never redraw it inline.
- Source SVGs are in `frontend/packages/ui/brand/` (tile, symbol, mono, app icon, notification badge, EN and AR lockups). The lockups use live Alexandria text, so outline them in a design tool before sending them to print.
- The full identity kit (brand guidelines PDF, logo PNG/PDF exports, app-store icons, social images) lives in `identity/` at the repo root and is regenerated with `node identity/source/build-identity.mjs`. Keep `identity/source/brand.mjs` in step with `BrandMark.tsx` and `ember.css`.
- After changing the mark, run `node tools/render-brand-icons.mjs` from `frontend/` to regenerate the customer PNG icons and the site and console favicons.
- Keep clear of signal or Wi-Fi arcs, U-shaped "smile" curves and a dot floating above a curve. A competitor (Nadeeni) owns that look.

## Palette (use Tailwind token classes, never hex values in components)

| Token / class | Value | Use |
|---|---|---|
| `primary` | `#C2410C` | Main action, live numbers, focus. **One ember element per view.** |
| `primary-hover` | `#9A3412` | Hover/pressed |
| `primary-soft` / `primary-wash` | `#FFEDD5` / `#FFF7ED` | Focus halo, row hover, badges |
| `glow` | `#FB923C` | Ember on dark (ink) surfaces only |
| `ink` | `#1C1917` | Text, active nav, hero tiles, toasts, Pro badge |
| `ink-2` | `#44403C` | Secondary text |
| `muted` | `#6F6863` | Labels, hints |
| `line` | `#EEEBE8` | Borders, dividers |
| `surface` / `canvas` | `#FFFFFF` / `#FAF9F7` | Cards / page background |
| `ok` `warn` `danger` `info` (+`-bg`) | `#15803D` `#A16207` `#BE123C` `#1D4ED8` | Status only. Danger is rose, not red, so it never reads as ember. |

The mix is about 80% white, 15% ink and 5% ember. Light theme only. `#C2410C` on ink fails contrast for text, so use `glow` there.

## Type

- `font-display` (Alexandria 600–800): headings, big numbers, brand name. h1–h3 get it automatically.
- `font-sans` (IBM Plex Sans Arabic 400–700): body and UI.
- `font-mono` (JetBrains Mono 500): IDs, slugs, codes, and the `.eyebrow` label (tiny uppercase, tracked). Arabic falls back to sans with no tracking.
- Every face covers Arabic. The apps are RTL-first, so use logical utilities (`ms-`, `pe-`, `start-`, `border-e`), never `ml-`/`left-`.

## Shape and depth

- `rounded-control` is a pill for buttons and button-like links. `rounded-input` (12px) is for inputs, toasts and nav items. `rounded-[var(--radius-card)]` (22px) is for cards and tables. `rounded-dialog` is for modals.
- `shadow-card` is the one soft floating shadow. Use borders only on inputs and secondary cards.
- Touch targets stay at least 48px (`min-h-12`), and main customer actions at least 64px (`size="lg"`).

## Patterns

- Console shell: a sticky white sidebar with grouped nav (eyebrow group labels, active item = ink pill with a glow dot), a user chip with gradient initials, and pages rendered through `PageShell`.
- Auth pages: `AuthShell`, a split screen with an ink panel using `.ember-glow` on the left and the form on white on the right.
- Tables: shared `Table`/`Td` with eyebrow headers, `primary-wash` row hover, mono slugs and `whitespace-nowrap` dates.
- Status: `StatusBadge` pill = text + shape marker, never colour alone.
- Big figures in `font-display font-extrabold tracking-tight`, labels in `.eyebrow`. This contrast carries the modern feel.

## Playful, but in one place

Allowed: one `.ember-glow` per screen, a slightly tilted sticker on a highlight, `active:scale-[.98]` press feedback, and a pulsing live dot. All of them respect `prefers-reduced-motion`.
Never: orange body text, full-page gradients, emoji in navigation, playful motion inside tables or forms.

## Checklist before finishing UI work

1. No hex colours in components. Everything goes through tokens (add a token to both `tokens.css` defaults and `ember.css`).
2. Works in Arabic (RTL) and English.
3. Only one ember focal point per view.
4. Run `npx vitest run` and `npm run build`, then `node tools/check-budgets.mjs` from `frontend/`.
