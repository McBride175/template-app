# Local component development

Run `pnpm storybook`, then open <http://127.0.0.1:6006>. Build a static copy with
`pnpm build-storybook` (output: ignored `storybook-static/`). No application
server, login or service credentials are needed.
Run `pnpm typecheck:storybook` to check the isolated stories/configuration without
depending on generated Next application route types. The normal application
typecheck still includes Storybook sources.

This deliberately small setup uses Storybook 10.6.1, `@storybook/nextjs-vite`
and the accessibility addon, with a development-only bundled interface font.
Controls, viewport selection and keyboard inspection
are built in. Select Mobile (390px), Narrow mobile (320px) or Tablet (768px) in
the viewport toolbar. Yuohme supports light mode; there is no invented dark theme.

## Component coverage

Stories in `stories/ui/` import the production primitives and compose labels/errors
with the existing `Field` component. All examples are fictional and deterministic.

| Component | Stories |
| --- | --- |
| Button | Primary, secondary, ghost, destructive, disabled, small, large, CTA, loading composition, keyboard focus |
| Input | Empty, filled, disabled, validation error, edit/focus |
| Checkbox | Unchecked, checked, disabled unchecked/checked, validation error, focus |
| Select | Empty, selected, disabled, validation error, focus |
| Card | Default, subtle, long content at mobile width |
| ProductShell | Eight simulated desktop/active/loading/error/mobile/open-menu/narrow/tablet states |
| CollectionQueue | Fifteen synthetic focused/ranked/long-name/large-amount/adjustment/loading/empty/error/saving/retry/mobile-dashboard/first-action/return-to-first/refresh-warning states |
| DisputesFilters | Collapsed, expanded, applied filters and disabled states |

The shell stories import only its pure presentation component, not
ApplicationFrame, ProductWorkspace, session hooks or feature providers. Their
fictional display props are not an authenticated session. Fullscreen stories
bypass only the padded preview wrapper. `pnpm test:shell` uses the existing
Playwright Test dependency with an isolated loopback-only config for repeatable
shell interactions; it does not bypass application E2E preflights or certify
private workflows. See [the shell record](product-shell.md).

Queue stories import only the controlled presentation components, with synthetic
formatted values and callbacks. They do not import CollectionActionsClient,
DashboardOnboardingClient, service clients or authenticated fixtures. The same
isolated `pnpm test:shell` configuration covers queue presentation and responsive
interactions. See [the queue record](collection-queue.md) for financial boundaries
and the distinction between simulated and real application certification.
The 56-story catalogue and responsive mobile refinement checks are recorded in
[Phase 5B.1](mobile-refinement.md). Filter stories use a fictional worklist for
spacing; they do not certify invoice actions or financial mutations.

Change props in Controls and use real pointer/keyboard interaction to inspect
hover, focus and native input states. The loading example composes `Spinner` and
disabled/`aria-busy` props; it does not add a loading API to Button. Checkbox errors
use the existing Field message/ARIA association; Checkbox has no custom error edge.
The native select menu remains owned by the browser.

## Codex workflow

Prefer an existing story for isolated styling and inspect variants, accessibility
results and mobile widths before applying changes across pages. Use agent-browser
for compact canvas snapshots and interaction. Direct URLs skip the manager UI:

```sh
STORYBOOK_SESSION="$(agent-browser session id --scope worktree --prefix storybook)"
agent-browser --session "$STORYBOOK_SESSION" open 'http://127.0.0.1:6006/iframe.html?id=yuohme-input--validation-error&viewMode=story'
agent-browser --session "$STORYBOOK_SESSION" snapshot -i
agent-browser --session "$STORYBOOK_SESSION" screenshot --if-changed
agent-browser --session "$STORYBOOK_SESSION" a11y --selector main
agent-browser --session "$STORYBOOK_SESSION" close
```

Button click/edit/focus stories include small play assertions from `storybook/test`
that run when opened. Checkbox and Select keep controls synchronised with native
changes through `useArgs`; inspect their changes interactively. The accessibility
panel runs axe checks on the canvas. These checks supplement visual inspection;
they do not certify integrated application workflows.

Keep Playwright for repeatable end-to-end application tests. Use the real app for
authentication, routing, data loading and integrated workflows. Reuse stories and
configuration instead of adding temporary application test pages.

## Styling and isolation

`.storybook/preview.tsx` imports `app/globals.css`, including the authoritative
`app/theme.css` tokens and the existing Tailwind/PostCSS pipeline. Storybook bundles
the normal latin Plus Jakarta Sans variable face from
`@fontsource-variable/plus-jakarta-sans`; the existing tokens select the same
400/500/600/700 interface weights as `app/layout.tsx`. `preview.css` sets only the
font-loader variable `--font-yuohme-interface`. Keep the family/subset in sync if
application typography changes. Storybook needs no Google Fonts requests at
startup, build or inspection. This avoids the adapter's remote font URLs; the
application retains its existing `next/font/google` loader and metric-adjusted
fallback. Approved brand font/artwork files are unchanged.

The separate `.storybook/next.config.ts` keeps the adapter from loading the app's
Sentry/deployment config and root environment files. Vite also reads environment
files only from `.storybook/`. Do not add credentials there. Import primitives
directly; do not import RootLayout, auth/accounting providers, service clients or
feature modules that fetch real data. If future components need data, pass static
fixtures or explicitly mocked dependencies. Stories are not a network sandbox.

Telemetry is disabled. No Chromatic, CI, cloud deployment or extra test runner is
configured. Generated assets are excluded from Git, ESLint and TypeScript checks.
The application's build, providers, CSS, tokens, brand assets and deployment
configuration are unchanged.

## Initial verification (10 October 2026)

The local server started and indexed all 29 stories. The final static build,
standalone Storybook typecheck, full-source typecheck in a temporary copy with
fresh Next route types, lint, 30 focused primitive/token/contrast/brand tests and
`pnpm security:sqlcheck` passed. The output includes a local interface WOFF2.

Visual rendering, Controls, responsive interaction and runtime network traffic
remain uncertified: agent-browser sessions were unresponsive, and native/in-app
browser fallbacks also failed. The application production build encountered its
existing Google Fonts download failures; its original `.next` was also locked by
an existing process. The root typecheck encountered malformed generated dev route
types. A broader test attempt found existing historical branding assertions and
was stopped under machine memory pressure; the focused tests passed separately.
Concurrent Playwright setup work in the shared directory was preserved. Recheck
visual states and the normal app build when browser/machine conditions allow.

## Visual certification completed (10 October 2026)

**PASS:** a fresh worktree-scoped agent-browser session inspected all 29 stories
at desktop width and ten additional cases at 320/390px. Plus Jakarta Sans loaded
locally; token colours, hover/focus styling, disabled/error/loading states, labels,
native Checkbox/Select changes and Controls updates were verified. Screenshots of
all five representative components were reviewed. The manager's mobile preset
and narrow-width toolbar produced the expected 390px and 320px canvases without
horizontal overflow. Three focused canvas accessibility checks had no violations.

No browser exceptions or external requests occurred. The initial recording's
3,842 requests were all to local Storybook; a missing implicit `/favicon.ico`
was fixed in `preview-head.html` by referencing the existing approved icon.
The follow-up recording had 167 local requests and no HTTP failures. Storybook's
internal Story Store/PopoverProvider deprecation warnings remain non-blocking.
For boolean Controls, activate the visible label or use focus/Space: the backing
input is only one pixel and raw input clicks can miss the visible switch.

Evidence is saved outside Git under
`/Users/admin/.codex/visualizations/2026/10/10/01a1245c-2170-7f82-bc07-1f919edd738f/storybook-certification/`.
The isolated browser session was closed. No component/brand changes, dependency
installation, broad tests, application builds, commits or pushes were performed
during this visual certification. The earlier application-build/type-generation
limitations above are separate from this completed component certification.
