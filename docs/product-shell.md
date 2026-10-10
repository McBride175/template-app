# Phase 5A — global product shell and navigation

Implemented locally on `develop`, starting from `9cf4e996b3220bf2fc43f7da62bcb71640805ec5`, with a clean tree. No push, hosted deployment or Production operation is part of this phase. Approved artwork, font loading, tokens and all feature/business files are preserved.

## Structure and route boundaries

`app/layout.tsx` retains the same metadata, Plus Jakarta Sans loader and AccountingActivityBoundary. It delegates presentation to `app/components/shell/ApplicationFrame.tsx`:

- Existing protected page prefixes use ProductWorkspace and ProductShell. Classification reuses the existing `isProtectedPagePath` helper; it is **not an authorisation check**. Proxy/server/client feature guards and redirects still enforce access unchanged.
- Public homepage/pricing/guides/contact/legal, login/signup/reset and `/start/*` keep the existing Nav, Footer, AuthScaffold and centred public content wrapper. The product rail does not appear there. No route groups, URL changes or page moves were introduced.
- ProductWorkspace is the small session-display adapter. `useNavigationSession.ts` shares the former Nav state/subscription/sign-out code between public and product layouts. That extracted body is byte-identical to the starting Nav logic, including validated getUser, subscription cleanup, error feedback and the hard `/login?status=signed_out` redirect. No authentication rule changed.
- ProductShell is reusable presentation with explicit props and children. It imports real Logo/Button/Alert primitives and semantic tokens; no service client, theme provider, duplicate palette or feature/data logic lives in it.

## Navigation and sizing

| Role | Label | Existing destination |
| --- | --- | --- |
| Primary | Priorities | `/dashboard` |
| Primary | Customers | `/customers` and its existing detail/history flow |
| Primary | Disputes | `/disputes` |
| Secondary | Account | `/account` |
| Secondary | Connections | `/settings/integrations` |
| Supporting | Guides / Support | `/blog` / `/contact` |

`/collections/actions` keeps its existing redirect to dashboard/collection actions and receives the Priorities active indicator. Account/Connections are existing finished routes, not new workflows. Internal admin/Xero pages remain reachable through their existing access paths, without new navigation destinations. No unfinished Promise/action worklist was added.

At **1024px and above**, a fixed quiet **240px** left rail contains approved H3, primary links, account/support access and sign-out. Active location uses `aria-current="page"`, the selected tint and a primary-colour edge; this is navigation state, not business priority/status colouring. At 1440px the working region is 1200px including outer padding (1136px of content), compared with the former 896px global container. Primary workspaces are wide; account/settings retain a readable 896px cap.

Below 1024px, the closed header is one row with full H3 and a 44px menu control. The 160px SVG canvas provides about 142px of visible ink, preserving the approved y foot and guide clear space; the header is approximately **83px high**, including its border. It fits 320px without substituting yo, multi-row links or permanent bottom navigation.

The mobile menu uses a named native modal dialog: background inertness, initial focus on Close navigation, explicit Tab/Shift+Tab cycling, Escape/close/backdrop dismissal, modified-click preservation and ordinary-selection dismissal. Route changes and desktop resize dismiss it; focus returns to the menu control or active desktop rail link. No additional modal dependency was installed. The skip-navigation link targets the focusable workspace region.

Existing feature-owned main landmarks and inner width/padding conventions are retained through `pageProvidesMain` and `pageHasMain`, avoiding nested main landmarks without touching feature JSX. Those legacy wrappers may still provide additional inner spacing; normalising feature headings/containers belongs to the relevant later feature phases. No empty secondary/sidebar/right-panel slots, dashboard cards or new tab framework were added.

## Isolated development and local certification

Eight ProductShell stories cover desktop Priorities, active Customers, account loading, sign-out feedback, closed/open mobile, narrow 320px and tablet. They use real primitives/CSS/fonts and clearly labelled fictional display props, with no auth/accounting provider or live API client. Fullscreen is supported by a small preview-decorator exception; the existing 29 stories keep their original wrapper. This is not a blanket Storybook browser certificate.

`pnpm test:shell` uses the existing Playwright Test dependency with `playwright.shell.config.ts`, an isolated **loopback-6006-only** Storybook fixture. It writes no auth state and never bypasses the application's Supabase Test/global preflight. Its `.layout.ts` file is intentionally outside the application's `.spec.ts` match. Normal `pnpm test:e2e:smoke` remains the separately guarded real application suite.

Final evidence:

- **88 focused Node tests passed**, 0 failed/skipped: route/layout separation, active links, modal/landmark associations, shared sign-out success/error and existing auth/design/onboarding/UI contracts.
- **7 isolated shell browser checks passed**, 0 failed/skipped/retries, Chromium at desktop 1440px and touch-capable 320/390/768px. They cover wide content/overflow, skip focus, H3/closed header, modal focus cycle, Escape, ordinary/modified link selection, resize restoration, delayed-logo header stability and same-route history dismissal.
- **8 real local application smoke checks passed**, 0 failed/retries; **5 intentionally skipped** authenticated/financial journeys remain untouched. Public branding/auth/onboarding, destination preservation and signed-out API guards pass against the compiled Test application.
- Lint, application TypeScript, Storybook TypeScript, Storybook production build, application production build and SQL safety checks passed. No new dependency, environment-variable name or migration was added. A process-only empty Sentry upload token was used for local build verification; no persisted environment changed.
- Targeted agent-browser inspection and screenshots covered desktop, narrow closed/open menu, tablet, loading and sign-out error. Axe reported **zero violations** after placing the skip link in its own landmark. It marked the hidden native-dialog aria-controls relationship for manual review; unit/browser/DOM checks verified the referenced dialog ID and accessible name.
- During development, keyboard boundary cycling was corrected after Shift+Tab could leave DOM focus. Storybook's Link mock intercepts navigation before callbacks, so menu dismissal now handles ordinary selection independently without preventing routing. A concurrent-build/HMR reload caused one transient test retry; the final suite was rerun after builds were quiescent and passed without retries. Waits/retry limits were not raised.

Screenshots/result JSON are outside Git under the task's `yuohme-5a-qa/` workspace. Every product screenshot is explicitly a **component/layout simulation**, not a real authenticated application journey. No designated Test account/storageState was available; positive authenticated dashboard/customer/account workflows and native Safari/WebKit remain unverified. No sessions or financial fixtures were invented.

## Phase 5B handoff

The existing `/dashboard` queue can continue as children of the wide ProductShell content region; public/root routing and all data boundaries stay in place. Reuse the rail/mobile menu, Logo, semantic primitives, active navigation model and isolated stories. A future queue/customer design may intentionally remove its legacy own-main/inner-container wrapper and use the default shell main rather than nesting landmarks. Contextual panels should be introduced only for actual workflow needs, not empty global chrome.

Obtain a designated safe Test session before positive authenticated browser certification; keep the five financial journeys skipped until fixtures and failure-safe cleanup are implemented. Future hosted certification still requires approval to push/deploy and verifying the Preview alias's exact SHA (the separate alias-automation follow-up remains open). Phase 5B was not implemented.
