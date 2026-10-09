# Yuohme approved brand assets

All eight variants are **APPROVED FINAL**, including the square icon, yo micro-mark and favicon derivatives. The user's Phase 1 instruction on **9 October 2026** confirms that approval. Geometry is unchanged from the approved pack.

Start with the existing [brand usage guide](docs/usage-guide.md): the authoritative asset-use reference for subsequent implementation. The established v1 foundation/semantic source remains [app/theme.css](../app/theme.css); font loading remains [app/layout.tsx](../app/layout.tsx). The original Phase 4A approved foundation brief was recovered from “Audit Frontend Styling Architecture”. A standalone comprehensive **Visual Identity Specification v1** was not located; full reconciliation with that document remains open. This guide does not claim to replace an unavailable specification.

## Canonical files

| Role | Location |
| --- | --- |
| Editable masters | `masters/editable/logo-stacked-editable.svg`, `logo-horizontal-editable.svg` |
| Outlined masters | `masters/outlined/logo-stacked-outlined.svg`, `logo-horizontal-outlined.svg` |
| Production SVGs | `../public/brand/`: the eight variants below |
| Purposeful PNGs | `../public/brand/png/`, `../public/brand/icons/` |
| Provenance | [sources/provenance.json](sources/provenance.json) |
| Font and licence | `fonts/PlusJakartaSans-ExtraBold.ttf`, [fonts/OFL.txt](fonts/OFL.txt) |
| Inventory | [asset-manifest.json](asset-manifest.json) |
| Cleanup and verification | [docs/phase1-consolidation.md](docs/phase1-consolidation.md) |

The final stack is **centred-me v15**, the RIGHT-hand “AFTER / CENTRED me” in the preserved [comparison](review/stacked-approved-comparison.png). The horizontal is **H3 bespoke lowercase**, the FOURTH row in the [four-direction comparison](review/horizontal-approved-comparison.png). Earlier recommendation/exploration captions in those historical images are superseded by explicit final approval. D2/H0/H1/H2 are not canonical.

Only one editable and one outlined master exist for each principal design. The two outlined masters are intentionally duplicated byte-for-byte as the corresponding principal public SVGs: one production source and one served file. Other historical master copies are archived externally. Editable masters require the bundled ExtraBold face; outlined masters and all web SVGs are font independent.

## Production variants and compatibility exports

| SVG filename under public/brand/ | Use |
| --- | --- |
| `logo-stacked.svg` | Two-colour stack on light backgrounds |
| `logo-horizontal.svg` | Two-colour lowercase H3 on light backgrounds |
| `logo-stacked-monochrome.svg` | Complete dark stack |
| `logo-horizontal-monochrome.svg` | Complete dark H3 |
| `logo-stacked-white.svg` | Transparent white stack on dark backgrounds |
| `logo-horizontal-white.svg` | Transparent white H3 on dark backgrounds |
| `logo-square.svg` | White approved stack on rounded deep-teal square |
| `mark-yo.svg` | White yo micro-mark on rounded deep teal |

PNG retention is deliberate: `png/logo-horizontal-512.png` and `logo-horizontal-white-512.png` for email/raster-only compatibility; `icons/logo-square-180.png`, `logo-square-192.png` and `logo-square-512.png` for touch/app/social delivery; `icons/mark-yo-32.png` for PNG favicon compatibility. `icons/favicon-yo.ico` retains native 16/32/48/64/128/256px frames without storing duplicate standalone PNGs for every frame. Platform-specific masks/submission constraints still require implementation review; approved artwork is not changed for them.

The [approved-assets/native-size review](review/approved-assets-native.png) shows the final set and small-size samples. SVG is preferred for principal web logos. Masters, source records, fonts and review evidence belong outside `public/`; only files intended for delivery are in that directory.

## Archive and verification

The full original pack, ZIP, original source copies, 38 unnecessary web PNGs, historical working scripts and diagnostic/review outputs were verified and preserved **outside the repository**. The archive location and original pack hash are recorded in provenance; per-file disposition is recorded in the external archive. No unique source/provenance was discarded. Packaging and diagnostic directories plus oversized raster outputs are excluded in the root `.gitignore`.

Run `python3 brand/scripts/validate.py` for portable structural, approved-geometry/hash, manifest, relative-link, raster/ICO-header and duplicate checks. It uses Python's standard library and writes no files. Inkscape 1.4.4 rendering/font-resolution checks are documented in the consolidation record; temporary render outputs are external.

Phase 1 does not activate these assets. Navigation, components, design tokens, interface typography and the existing `app/favicon.ico` are unchanged. No push/deployment, hosted schema change or environment-variable change is authorised by this checkpoint.
