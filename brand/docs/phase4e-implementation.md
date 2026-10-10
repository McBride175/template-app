# Phase 4E — approved asset integration

**Locally implemented; hosted Preview certification is separate.** The starting checkpoint was `develop@d5af0e52afd6e145ef521e44ab139eec38e1b414`, with a clean working tree. Phase 4D consolidation is preserved. The eight approved production SVGs, four masters, font and canonical PNG/ICO sources are unchanged; no artwork was regenerated.

## Shared Logo API and placements

`app/components/ui/Logo.tsx` is the sole component mapping semantic logo choices to the canonical public SVGs. `variant` is `horizontal` (default), `stacked`, `square` or `micro`; principal layouts accept `colour="brand"`, `"monochrome"` or `"white"`. Icon variants use their approved white-on-deep-teal artwork. `width` is the original SVG canvas width before external clear space. `label` defaults to “Yuohme”; `decorative` emits empty alt text and hides the graphic from accessibility naming when a containing link already has a name.

Images use Next Image with unoptimised canonical SVG URLs, explicit intrinsic dimensions and proportional display width/height. The wrapper reserves one lowercase o-body-height clear space around visible principal artwork, accounting for the original SVG margins. This protects the full H3 y descent without clipping, stretching, changing viewBoxes or re-creating glyphs. Measurements in the component are intrinsic artwork dimensions, not another theme/token dictionary. `className` affects wrapper placement; callers should not override its image size or crop it.

| Existing shared surface | Actual implementation |
| --- | --- |
| Global navigation | H3 at existing `lg`/desktop widths; yo at smaller widths where links/actions are crowded. Brand link named “Yuohme home”; images decorative. All existing links/auth handlers remain. |
| Start/onboarding header | H3 replaces the existing `YUOHME` placeholder, including subsequent `/start/*` screens through the existing shared branch. |
| Authentication shared card | Approved stack in AuthScaffold, used by login/signup. Existing form controls, errors and actions remain. |
| Footer | H3 home link on its existing light surface. Existing links and suppression during `/start/*` remain. |
| Homepage and other routes | Receive shared navigation/footer branding. No additional hero logo or marketing redesign. |

H3 uses a 160px SVG canvas, about 142.3px visible ink width, and an approximately 81.8px wrapper height including the original clear-space rule. Authentication uses an 80px stacked canvas, above the guide's inspected minimum. Compact yo uses a 40px square. The existing navigation wrapping remains; the sign-out control is kept on one line to accommodate the new brand placement. No left rail, runtime theme state, new palette, typography change or feature migration was introduced.

## Icons, metadata and email review

- `app/favicon.ico` is replaced byte-for-byte with `public/brand/icons/favicon-yo.ico`. The old placeholder remains in Git history. The filesystem convention emits one icon link with Next's content-fingerprinted query URL; no explicit duplicate favicon metadata is declared. The ICO contains native 16/32/48/64/128/256px frames. Next currently labels the discovered link `16x16`, reflecting the first ICO directory entry; the served file still contains all six verified frames.
- Root metadata references the canonical `public/brand/icons/logo-square-180.png` as one 180×180 Apple touch icon. No duplicate filesystem Apple copy, web-app manifest, service worker or PWA infrastructure was added. The 192/512px canonical square PNGs remain available for later application/platform requirements; they are not advertised as a maskable PWA.
- Existing Open Graph/Twitter titles, descriptions, URLs and card choices remain. No suitable dedicated social-preview artwork exists in the approved pack. A separately reviewed Open Graph/Twitter image is a small follow-up deliverable; the square icon is not presented as a finished social card.
- The repository's contact notification uses Resend **plain text**; it has no HTML logo slot to update. Supabase Auth templates/senders are external configuration, documented in `AUTH_EMAIL_OPERATIONS.md`, and were not changed or re-certified here. Future HTML email work can use the retained 512px horizontal colour/white PNGs with meaningful alt text, proportional dimensions and an approved stable publicly accessible origin. Domain, SMTP, external templates and Production email changes remain separately authorised work.

## Standards provenance

The original comprehensive Visual Identity Specification v1 was authored in an earlier ChatGPT conversation; no separately saved original has been confirmed. The user explicitly designates [the reconciled usage guide](usage-guide.md) and `app/theme.css` as implementation references. [The Phase 1 record](phase1-consolidation.md), index, provenance and manifest reflect that clarification. No original specification was invented, transcribed from memory or reconstructed. The existing theme/token architecture remains unchanged.

## Local certification and limits

Focused tests cover every variant/path/aspect ratio, naming/decorative semantics, reserved H3 descent/clear space, signed-out/signed-in navigation destinations, sign-out availability, onboarding/footer behaviour, the approved favicon bytes and absence of conflicting declarations. Existing design-token, contrast, UI-primitive, SEO, auth-client and first-value journey checks are included. All **53 focused tests passed**, with 0 failed/skipped. Lint, TypeScript, the final production build, SQL/security and scoped diff checks passed. The build emitted the existing Node `module.register()` deprecation warning. No full-suite rerun was needed for this asset-only change.

Automated screenshots use the already installed Playwright/Chrome against the locally built production server. External browser requests are blocked; no login, OAuth, email, billing or accounting actions are submitted. Public routes `/`, `/start`, `/login`, `/signup`, `/reset-password`, `/pricing` and `/contact` passed at **320, 390, 768 and 1440px**: 28 real page/viewport checks. Four frozen example signed-in Nav/Footer fixtures checked the crowded shell without retrieving a real user's session/customer data; the sign-out label stays on one line. A separate all-eight-variant fixture checks white on the existing inverse surface and coloured/monochrome on light surfaces; the live application currently uses light logo backgrounds.

Checks passed for asset load success, proportional image rectangles, containment, no horizontal overflow/clipping, responsive selection, unchanged dimensions while SVG loads were deliberately delayed, metadata target responses and byte equality. Pricing navigation, the login-to-signup link and visible keyboard focus on the named brand link passed. Selected mobile/tablet/desktop and all-variant screenshots were opened for visual inspection. Screenshot QA lives outside Git under `~/.codex/visualizations/2026/10/09/01a1226e-541c-7c20-a789-88721f8de175/yuohme-4e-qa/`. This is local browser certification, not a claim that Vercel Preview, authenticated business workflows, iOS installation, social crawlers or external email systems were tested.

## Hosted Preview readiness

After approval to push, both the local consolidation checkpoint `d5af0e5` and the Phase 4E checkpoint must reach `origin/develop`. That triggers Vercel **Preview/Test**, using Supabase Test `rbmxegyiwntomhpbepnu`, not Production. Check the stable alias `https://template-app-git-develop-james-mcbrides-projects.vercel.app` and verify the deployment's commit before certification.

Certify Safari/Chrome and mobile/tablet/desktop on homepage, login/signup/reset, start and authenticated onboarding/result states; authenticated dashboard/customers/account shell with short/long account labels, sign-out/error states; footer visibility; keyboard focus and brand naming; SVG response MIME/loading, no clipping/overflow, favicon content/cache refresh and Apple icon. Verify existing navigation/authentication journeys with Test accounts. No production release or external email change is implied.

Before Phase 5A, complete hosted Preview branding certification and decide whether the separate social-preview image deliverable is required for that release. The conversation-only original v1 is accurately recorded and is not an implementation blocker under this task's explicit references. Broader product-shell/design-system migration remains out of scope.
