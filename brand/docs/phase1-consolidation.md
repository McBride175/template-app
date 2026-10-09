# Phase 1 consolidation record — 9 October 2026

**Asset checkpoint complete; comprehensive standards reconciliation remains open.** All eight approved SVGs, four definitive masters, editing font/licence and essential provenance are consolidated. The standalone comprehensive “Visual Identity Specification v1” could not be located and its location was requested. The existing usage guide was reconciled with the recovered approved Phase 4A foundations and implemented v1 theme; no substitute comprehensive specification was invented.

## Preservation and cleanup

Work started on `develop` at `3af1d483`, with only the previously generated `brand/` and `public/` untracked. No unrelated local changes were found. Every byte of both asset directories was copied to an external snapshot and verified by SHA-256 before cleanup. The approved ZIP passed integrity checks, every manifest hash matched disk, and every archived entry matched its corresponding repository file.

The external archive is `~/.codex/visualizations/2026/10/09/01a1226e-541c-7c20-a789-88721f8de175/yuohme-phase1-archive/`. It contains `snapshot/`, the original ZIP, `before.json`, per-file `disposition.json`, temporary Phase 1 QA and the recovered `phase4a-approved-foundation-brief.txt`. Historical locations are evidence only; portable canonical paths and validation do not depend on them.

| Original file disposition | Count | Reason |
| --- | --- | --- |
| Retained | 25 | Masters, SVGs, purposeful PNG/ICO, font/licence and current metadata/docs |
| Relocated | 3 | Original specification image and two decisive approval comparisons; one copy each |
| Archived externally | 91 | Duplicate historical sources, 38 unnecessary PNGs, ZIP/checksum, generated QA/previews, old contact sheets, scripts and duplicate manifest documentation |

The snapshot preserves all 119 original files. The 91 archived files were removed only from the active repository after preservation and lack of application references were verified. No original experimental workspace was altered. Removed PNGs include all 4096/2048px wordmark exports, unused stacked/monochrome rasters, repetitive sizes and duplicate standalone ICO-frame PNGs. Machine-specific generation recipes are archived; the single remaining validator is portable and does not regenerate artwork.

All eight production SVGs remain. Six useful PNGs and one six-resolution ICO remain, compared with 44 PNGs previously. The eight SVGs and four masters retain exactly their approved geometry. Only square/yo title/description metadata changed to record full approval. Principal masters remain byte-identical to the pack. The only exact duplicates are the two outlined-master/principal-public-SVG pairs, intentionally required for source-versus-delivery roles.

Counts/storage are recorded in the manifest: initially **119 files / 5,337,669 bytes (~5.34 MB)** across `brand/` and `public/brand/`; the final consolidated inventory is **31 files / approximately 1.01 MB**, an **81.1%** reduction in repository asset bytes. The root `.gitignore` addition is excluded from the asset-folder count. Archive preservation uses local storage outside Git and is not a global disk-space saving.

## Existing architecture and references

`app/theme.css` already defines approved palette, neutral/status foundations, typography, radius and semantic mappings. `app/layout.tsx` loads Plus Jakarta Sans 400/500/600/700 through `next/font/google`; bespoke logo glyphs independently use the preserved ExtraBold face and custom paths. `app/components/ui/` already contains semantic Button/Input/Card/Badge/feedback recipes. None was modified or duplicated.

No application, library, test or script references the new `public/brand/` files. The active Next.js file-convention favicon remains `app/favicon.ico`; its before/after hash matches. Navigation's start flow still uses its existing text `YUOHME`. AuthScaffold and Footer have no logo implementation. Existing provider SVG icons (including Google) and inline feature icons are unrelated and remain intact. All tracked application/configuration files except the narrow `.gitignore` addition are hash-identical to the starting checkpoint.

Historical comparison PNGs retain original labels as source-selection evidence; the right-hand stacked design and fourth H3 row alone are canonical. The new native-size review shows all eight as approved. The original raster production specification is a historical source image, not a competing current geometry/minimum-size standard.

## Verification

- The existing vector-production helper validated all eight SVGs: finite viewBoxes, genuine vectors, six glyph paths per principal/square or two for yo, and no font/text/raster/external-resource dependencies. Icon backgrounds remain native rounded rectangles.
- Inkscape **1.4.4 (dcaf3e7)** queried every object bound and rendered all eight at 512px. Every render is pixel-identical to the approved pack. Live editable/outlined master renders also agree exactly; fresh font outlining matches the selected paths/transforms.
- Colours are exactly `#171A1C`, `#0F6B5D`, `#0A5047`, `#FFFFFF`; principal colour variants share geometry. Retained PNG and ICO bytes match the pack. Native ICO frames remain 16/32/48/64/128/256px.
- Large editable/outlined previews and the native-size review were opened and inspected: no clipping/distortion, preserved y feet/counters and centred `me`. H3 needs about 80.4px vertical space at 140px ink width with the original clear-space rule. The full stack is unsuitable at favicon sizes; yo is clearer, with a compact o counter at 16px. Geometry was not adjusted for these constraints.
- Independent librsvg/Cairo evidence from the pack remains applicable because geometry and Inkscape pixels are unchanged. All eight comparisons passed with mean RGB differences below 1/255. No renderer/dependency was installed.
- The portable validator checks approved geometry/raster hashes, raster/ICO headers, exact manifest inventory/hashes, local documentation links and unplanned duplicates. The manifest records every retained file with an intended role; its self-hash is omitted to avoid recursion.
- `pnpm lint`, `pnpm typecheck`, `pnpm build` and `pnpm security:sqlcheck` passed. Focused design-token/contrast/UI tests passed: **24 passed, 0 failed, 0 skipped**. The full application suite was not rerun because assets/docs are inactive and application code is unchanged. The build used network access for the existing Google font and emitted the existing Node `module.register()` deprecation warning.
- `git diff --check` passed for tracked edits. The staged whitespace check passes with the unchanged upstream `fonts/OFL.txt` excluded: it contains one original trailing space, deliberately retained and hash-verified rather than altering the licence. Only Phase 1 assets/docs/validator files and the narrow `.gitignore` addition are staged. No migration/environment-variable name was added or changed. No push, deployment, Production operation or history rewrite occurred.

## Phase 2 mapping — recommendation only

| Future touchpoint | Approved asset | Requirement |
| --- | --- | --- |
| Shared future Logo component | Principal SVG variants | Select layout/colour explicitly; preserve ratio and accessible name |
| Nav/start/onboarding | H3; yo for constrained slots | Allow full y descent and clear space; do not squeeze/crop |
| Homepage/authentication | Stacked or H3 | Follow available space and the usage guide |
| Footer/light or inverse surfaces | H3 two-colour/dark or white | Match background contrast; SVG preferred |
| Email compatibility | Horizontal 512px PNG, colour/white | Meaningful alt text and matching aspect ratio |
| Later browser/favicon phase | yo SVG, 32px PNG, ICO | Keep active favicon until authorised integration |
| Later touch/app/social phase | Square SVG / 180,192,512px PNGs | Review platform masks; no maskable certification inferred |

No Logo component, metadata/navigation change or application reference was implemented. The comprehensive v1 document still needs to be supplied/located to close full standards reconciliation before implementation beyond the verified asset guide and existing foundations.
