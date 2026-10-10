# Phase 4E hosted certification — 10 October 2026

**PARTIALLY CERTIFIED.** Hosted public navigation, login/signup, focused onboarding, approved SVGs, icon metadata, keyboard focus and responsive brand layouts pass. Authenticated dashboard/customer/account branding is unverified because no designated Test account or Preview storageState is configured. The five existing authenticated/financial journeys remain skipped; skipped tests are not passes. Chromium was tested. WebKit's executable is not installed, and neither Playwright WebKit nor native Safari is claimed as tested.

## Deployment and alias correction

Preflight found local/remote `develop` already at `4de00e19089c31618d5a8a63d41ac77eb0daf11e`, including both `d5af0e5` and `bc2b9c0` plus the installed testing tools. The user authorised certification of that checkpoint; no redundant push was performed. The tree was clean.

Vercel project `template-app` (`prj_KP5fDQnF923Ibr1AOlkq29FkXa4h`) had a READY Preview for that SHA: `dpl_5RLvXc5EZGyCsj3e9WecrXYAeS4M`, `template-qqhuzzqwl-james-mcbrides-projects.vercel.app`. However, the documented alias still routed to `dpl_4hqodmD9K5SvCeMztRfJh4JwCtDt`; H3 returned 404 there. With explicit user approval, only the existing develop Preview alias was rebound to the verified 4de00e1 deployment. API identity and the exact H3 response bytes were checked after correction.

The focused regression checkpoint `ac612f78f0bb3bade46b90a658ccbecf55dd6f4b` was committed and pushed to `develop`, as authorised for certification fixes. It changes only E2E coverage and a stale unit assertion, not application code, tokens or artwork. Its READY Preview is `dpl_DxdMT5LEzTeEMD55uja1JenCRdkh`, `template-19kuz4fqb-james-mcbrides-projects.vercel.app`. The alias did not advance automatically. After a second explicit user approval and exact project/branch/READY/SHA preflight, only the same existing alias was rebound to this deployment. Vercel API confirmed `dpl_DxdMT5LEzTeEMD55uja1JenCRdkh`; the final complete smoke was run against that exact deployment through the stable alias. No other alias or configuration was modified.

Stable Preview: https://template-app-git-develop-james-mcbrides-projects.vercel.app

No main/Production push, promotion, Production alias, environment setting, custom domain, Supabase schema, Stripe or email configuration was changed. Apart from the expressly approved Preview alias correction, infrastructure was left alone. Future pushes must verify alias ID/SHA rather than assume automatic advancement; changing alias-assignment policy is outside this task.

## Automated and visual evidence

The existing guarded Playwright Test setup, environment preflight, safe network fixture and smoke tests were reused. Three narrowly scoped brand tests were added in `tests/e2e/branding.smoke.spec.ts`; no page-object framework, new dependency or financial fixture was introduced.

- Final complete hosted smoke on the verified ac612f7 alias: **8 passed, 0 failed, 5 skipped, 0 retries/flaky**, 20.7 seconds. The earlier corrected 4de00e1 checkpoint also passed the complete smoke (8 passed/5 skipped) before publishing the test correction. Coverage includes homepage, pricing, Guides index, contact, login/signup, focused start, protected destination/auth boundaries, canonical SVG/icon bytes and MIME, proportions/containment/overflow, decorative naming, brand keyboard focus, navigation and delayed SVG loading without dimension shifts. Public pages use 1440px; representative shared layouts additionally use 390px and 768px.
- Initial brand run: 6 passed, 2 failed, 5 skipped, with one retry on each failed case. The two failures were assertion errors caused by comparing aspect ratios more precisely than Chromium's 1/64 CSS-pixel layout quantum. The assertion now compares physical dimensions within that quantum; no artwork, image sizing, waits or retry settings changed. The focused three-test rerun passed, then the complete smoke passed without retries.
- Focused Node regression group: **40 passed, 0 failed, 0 skipped**. The previous onboarding test incorrectly required literal `>YUOHME<`; it now checks the shared Logo in the focused header while retaining the existing progress/footer assertions. No authentication behaviour was changed.
- Lint, TypeScript, local production build and SQL safety check passed. The local build temporarily suppressed Sentry source-map upload using a process-only blank token; no persisted/hosted environment-variable name or value was added or changed.
- agent-browser 0.39.0 reviewed the 4de00e1 deployment (ac612f7 changes only tests, with identical runtime/artwork) using one worktree-scoped isolated session, compact scoped snapshots and four targeted captures: H3 desktop navigation, yo mobile navigation, login stack and start H3. Signup was inspected via its compact accessibility snapshot, reusing the authentication layout. H3's y foot is intact, proportions/clearance and alignment are suitable, and no cropped glyphs/overflow were seen. No personal profile/session was used, no form submitted, and the session was closed.
- All eight hosted SVG responses match the approved repository bytes. A fresh Playwright context confirmed one filesystem favicon link with its content fingerprint, the approved six-frame ICO, and one canonical 180px Apple touch icon with correct response MIME/bytes. Open Graph/Twitter identity/card metadata passed; the square icon was not substituted for a dedicated social-preview design.

Private/ignored Playwright diagnostics and minimal outside-Git screenshots are kept out of commits. The compact visual comparison and full result JSON are in the task's `yuohme-hosted-qa/` workspace, not the delivered brand asset pack. Storybook was not needed to diagnose the test precision issue, and its browser visual certification remains unverified.


## Read-only automatic-alias investigation

Project API shows `autoAssignCustomDomains=true`, GitHub deployment creation `enabled`, the correct McBride175/template-app repository, and Production branch `main`. No Preview suffix override is configured; `vercel.json` contains only the approved `arn1` region. Both Git-source READY previews recorded the correct develop SHA and calculated `automaticAliases` for the documented branch URL, with `aliasAssigned=true` and `aliasError=null`, but no actual alias binding before the manual corrections. The project domain list has no explicit develop Preview domain binding; absence alone is not proof of a defect, because generated Git branch URLs should be automatic. Successful build logs exposed no alias-assignment error.

**Likely cause (inference, not proven root cause):** the Git branch URL finalisation/ownership path is failing to advance its binding in Vercel's control plane despite correct project/Git metadata. This is not supported as a disabled auto-assignment setting, wrong branch, wrong project, app code or failed build. [Vercel's generated-URL documentation](https://vercel.com/docs/deployments/generated-urls#generated-from-git) says a Git branch URL should show the latest deployment.

**Recommended permanent follow-up:** reconcile/repair the generated develop branch-alias association in Vercel, keeping Production on main; if the supported project/Git settings remain correct, give Vercel Support the project and two deployment IDs and request repair of automatic branch-URL assignment. An explicit branch-bound Preview domain is a possible separately reviewed alternative. Verify automatic movement across two subsequent authorised develop deployments. Do not rely indefinitely on manual rebinding, and do not blindly toggle unrelated domain/Production settings. No configuration repair was performed during this certification.

## Limits and Phase 4E closeout

No new UI defect requiring application changes was found. The operational alias drift and stale test expectations were corrected narrowly. Principal horizontal/stacked artwork, monochrome/white variants and square/yo assets are available through the existing Logo API; actual hosted shared surfaces use the approved colour variants appropriate to their light backgrounds. No dark theme or unused decorative placement was invented.

Outstanding required positive coverage: safe authenticated dashboard/shared header, customer navigation and account/settings with a designated Test session. The five skipped dashboard/queue/action/dispute/promise journeys remain untouched; mutations still require per-run fixtures and failure-safe cleanup. Signed-out access-boundary tests do not certify positive authenticated views. Dedicated social-preview artwork remains deferred to the marketing programme; external Supabase/Resend email branding remains outside scope.

## Phase 5A handoff — no implementation

Reuse `app/layout.tsx`, Nav, Footer, AuthScaffold, `app/components/ui/Logo.tsx`, and the existing semantic UI primitives/theme. Preserve auth/navigation behaviour and the source artwork. H3 at its default 160px canvas needs approximately 82px vertical space with clear space; use the approved yo for genuinely compact/collapsed rail slots, rather than trimming its descender or changing glyph geometry. The current max-width containers/wrapped navigation and start/footer exceptions must be accounted for when planning the left-rail workspace.

Reuse the public/branding Playwright specs and safety fixture. Keep authenticated/mutation coverage skipped until the proper Test fixtures exist. The existing 29 Button/Input/Checkbox/Select/Card Storybook stories can support isolated future work; no Logo story or Storybook browser certificate was created here. Complete the missing authenticated branding check before claiming full Phase 4E certification. Phase 5A was not designed or implemented.

The certificate records the deployed/pushed application-and-tests SHA `ac612f78f0bb3bade46b90a658ccbecf55dd6f4b`. The subsequent documentation checkpoint is local only, to preserve the exact certified Preview and avoid another unnecessary deployment/alias correction. No runtime files differ between those checkpoints.
