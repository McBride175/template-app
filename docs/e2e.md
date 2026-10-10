# Playwright E2E workflow

Playwright Test 1.64.0 and Next environment loader 16.1.1 are pinned with Chromium as the sole initial browser. Existing
Node, jsdom and disposable-database tests remain separate and unchanged. The
Next.js 16 / React 19 / TypeScript application runs once per invocation through
Playwright's `webServer` in supported Webpack development mode, with one worker, fresh contexts, one retry, automatic
waiting, failure screenshots and traces on the first retry. Successful runs do
not collect screenshots, traces or video. HTML reports never open automatically.
The JSON report at `test-results/results.json` gives Codex structured counts and
failure names without reading screenshots or repeating browser interactions.

## Commands

```sh
pnpm exec playwright install chromium       # once after installing/updating dependencies
pnpm test:e2e:smoke                         # small certification suite
pnpm test:e2e tests/e2e/public.smoke.spec.ts -g "onboarding"
pnpm test:e2e:ui                            # interactive runner
pnpm test:e2e:report                        # last HTML report
pnpm exec playwright show-trace test-results/<failed-test>/trace.zip
```

`pnpm test:e2e` also leaves room for future regression specs without adding them
to the `@smoke` group. During development run relevant Node tests first, use
Storybook for components, agent-browser for exploration and Playwright for
repeatable workflows. Run only the affected spec/group after meaningful workflow
changes. At certification run the complete smoke group and report skips as
untested coverage, never as passing journeys. Fix failures using the report/trace
instead of adding sleeps or retries.

## Local server and environment boundary

The default URL is `http://127.0.0.1:3000`. Configuration loads the existing Next development environment and
refuses any Supabase URL except Test `rbmxegyiwntomhpbepnu`. Global setup also
checks the served browser scripts for the Test URL before tests execute, so a
reused server with different configuration fails closed. The exact documented
develop Preview is also allowed after the same served-build preflight; other
hosted URLs and Production are rejected. No database schema, migration or deployment
configuration is changed.

To verify the deployed Test application without local compilation:

```sh
E2E_BASE_URL=https://template-app-git-develop-james-mcbrides-projects.vercel.app pnpm test:e2e:smoke
```

Preview results certify that deployment, not uncommitted local application changes.
Local remains the default for focused development. Preview uses a separate
`playwright/.auth/test-user-preview.json` session file and starts no local server.
At installation this Preview does not contain the newer Dashboard bootstrap or
customer-detail bootstrap endpoints (both returned 404). The small initial API
smoke checks the existing queue/history/dispute/promise routes with valid request
shapes; it does not claim coverage of the undeployed performance endpoints.

Server reuse is enabled locally after the served-build preflight. Set
`E2E_REUSE_SERVER=0` to require a fresh server; CI always requires a fresh server. For focused repeat runs, start a server once and then reuse it:

```sh
pnpm dev --webpack --hostname 127.0.0.1 --port 3000
E2E_REUSE_SERVER=1 pnpm test:e2e:smoke
```

A different port still shares the Next development lock: stop the existing dev
server before changing ports. Do not run a production build concurrently with a development server in this
checkout: both use `.next`. Playwright stops servers it starts; it leaves reused
servers alone. `E2E_PORT` can select another loopback port if needed.
An already built local Test application can also be reused with `pnpm start`;
build once, then repeat focused tests without compiling on every invocation.

Browser fixtures allow local GET/HEAD and Test Auth user validation only. They
abort accounting-refresh intent, Xero sync/OAuth, external assets, Turnstile and
telemetry. Application writes fail fixture validation. Browser guards cannot
intercept server-to-server calls; no protected journeys run without an explicitly
designated account, and no production credentials/configuration are changed.
Collection reads can claim a free-use day for that Test account. Capture/use a
dedicated account only, with existing Test entitlement and sandbox accounting.

## Dedicated reusable authentication

No E2E credentials/session were present at installation. Signed-out tests run
immediately; authenticated tests report skipped until a dedicated account is
available. CAPTCHA/OAuth is handled once through a fresh interactive browser,
then Playwright `storageState` supplies each isolated test context. No full Xero
OAuth is needed or allowed by capture.

1. Start the guarded local server on port 3000 as above.
2. Run `pnpm test:e2e:auth`, then sign in with the dedicated **Test** account.
3. Add its UUID as `E2E_TEST_USER_ID` in ignored `.env.local`. Global setup validates
   the saved session against Test Auth and requires this exact user ID.
4. Run smoke. For queue coverage, also set `E2E_TENANT_ID` and
   `E2E_CUSTOMER_NAME` to a designated Test tenant/customer with actionable debt.

The file is `playwright/.auth/test-user-3000.json` (port-specific), ignored with
restricted file permissions. Delete/recapture it when expired; the runner fails
clearly on invalid or mismatched configured sessions rather than silently logging
in or skipping. Use the capture command again for absent/expired sessions.
Saved sessions and diagnostics may
contain sensitive data: do not commit, share or paste them into agent context.

## Coverage and pending isolation

| Journey | Initial coverage |
| --- | --- |
| Authentication/onboarding | Protected destination preservation, sign-in/signup round trip, password onboarding route, invalid callback recovery; dedicated authenticated dashboard spec needs session |
| Collection queue/customer | Signed-out page/API boundary; authenticated queue-to-invoice-context spec needs session and designated actionable customer |
| Action history | Protected history page/API boundary; outcome creation + follow-up/history assertion explicitly pending |
| Disputes | Protected worklist/invoice API boundary; mutation + disputed/To-chase assertions explicitly pending |
| Promises | Protected invoice API boundary; creation + promised/To-chase assertions explicitly pending |

Pending mutations are `fixme` entries in the smoke report, not mocked successes.
Existing fixtures are Node/jsdom mocks or disposable PostgreSQL databases, not
browser-addressable Auth/REST environments. Local Docker has an existing
`template-app` stack while current Supabase config expects `yuohme`; it was not
reset, migrated or repurposed. No dedicated hosted Test account/customer/reset
contract was established, so persistent writes are disabled. No generated
financial state requires cleanup in this initial suite; contexts and owned
servers close automatically.

Highest-value next step: establish a disposable browser-addressable Supabase
fixture using the canonical migrations and existing accounting-evidence fixture
builders. Seed a unique user/tenant/customer/invoice per run, certify a generation
for Promise creation, prevent provider dispatch, and revoke sessions/delete only
that run's user in failure-safe teardown. Verify cleanup after failed tests and
retries before enabling mutations. Add action outcome/follow-up/history first,
then dispute, then promise. Avoid generic page-object/framework layers.

New optional local variable names: `E2E_BASE_URL`, `E2E_PORT`, `E2E_REUSE_SERVER`,
`E2E_TEST_USER_ID`, `E2E_TENANT_ID`, `E2E_CUSTOMER_NAME`. No hosted variables or
migrations are added. Playwright's owned server overrides existing
`NEXT_PUBLIC_SITE_URL` to its loopback URL and sets `NEXT_TELEMETRY_DISABLED=1`.
Installation's isolated build also temporarily cleared `SENTRY_AUTH_TOKEN` to
disable source-map upload; no persisted environment values were changed.

## Installation verification (2026-10-10)

- Current local compiled Test build: **5 passed, 0 failed, 5 skipped**, no retries,
  in **3.3 seconds**. Success artifacts contained JSON only, with no screenshots/traces.
- Existing develop Test Preview: **5 passed, 0 failed, 5 skipped**, no retries,
  in **11.8 seconds**. Its results do not certify newer undeployed bootstrap APIs.
- Automatic development-server startup/teardown: focused onboarding test
  **1 passed** in **28.3 seconds**, including startup and compilation.
- Chromium launch/close and an isolated intentional failure probe succeeded:
  HTML report, failure screenshots and a first-retry trace were verified.
- Production-project and Production-origin preflights both rejected execution.
- Full lint, TypeScript, isolated production build and SQL safety check passed.
- Focused existing Node tests: **72 passed, 1 failed**. The existing onboarding
  source assertion expects literal `YUOHME` navigation text instead of the Logo
  component. No existing tests were edited. The broad Node run was stopped under
  resource pressure and was not certified.

Local cold development compilation stalled under host resource pressure during
installation. The successful local evidence above uses the actual compiled
application and real route handlers, with Test Supabase configuration; no mocked
application responses were substituted. Dedicated-session authentication and the
five skipped positive/mutation journeys remain unverified as described above.

References: [Playwright installation](https://playwright.dev/docs/intro),
[authentication](https://playwright.dev/docs/auth),
[web server configuration](https://playwright.dev/docs/test-webserver).
