# Yuohme brand usage guide

Use the exact approved centred-me stack and lowercase H3 wordmark. Scale uniformly. Preserve all letterforms, the teal `oh`, the centred `me` row and the full y foot. Do not crop, stretch, redraw, re-kern, shorten the descender, or substitute typed text for the logo.

## Palette and typography

| Colour | Value | Asset use |
| --- | --- | --- |
| Primary text | `#171A1C` | `yu` and `me`; complete monochrome logos |
| Brand primary | `#0F6B5D` | `oh` in both principal logos |
| Brand dark | `#0A5047` | Square and micro-mark backgrounds |
| White | `#FFFFFF` | Reversed logos and approved icon glyphs |

The existing broader interface palette and **Plus Jakarta Sans** interface typography remain unchanged. No mint/display-teal reversal from the exploration sheet is an official asset.

The editable logo sources use **Plus Jakarta Sans ExtraBold**, upright, weight **800**, PostScript name `PlusJakartaSans-ExtraBold`. The font's naming table calls this face's subfamily “Regular”; its full face is ExtraBold. The exact original packaged TTF is included in `../fonts/`, with **SIL Open Font License 1.1** in `OFL.txt`; source lineage and file hash are in [provenance](../sources/provenance.json). The original production notes record Tokotype and the [official font project](https://github.com/tokotype/PlusJakartaSans/tree/master/fonts/ttf); their unchanged historical copy is preserved in the external archive recorded in provenance. The bundled [OFL.txt](../fonts/OFL.txt) is the authoritative editing-font licence. Install that face for editing. Fresh Inkscape conversion matches the selected outlines exactly. Production SVGs contain paths and need no font installation.

## Choosing an asset

Use two-colour logos on white or another suitably light background. Use dark monochrome when colour reproduction is unavailable. Use all-white on dark backgrounds. White SVGs and PNGs are transparent, so they can appear blank in a white preview.

Prefer H3 for website navigation, horizontal email headers and narrow placements when there is sufficient height. Use the stack in spacious brand placements. For email, use PNG at twice the display dimensions where practical and provide meaningful alt text such as “Yuohme”; set matching width/height and preserve aspect ratio.

The fully approved square icon is for app/social/profile placements. The fully approved yo micro-mark is for favicons and very small elements. All eight variants and their retained icon/favicon derivatives were explicitly approved in the Phase 1 instruction on 9 October 2026. Their 512-unit rounded containers have a 64-unit corner radius; transparent rounded corners are intentional. Some app stores require full-bleed square backgrounds or their own platform masks. These assets are not certified platform submissions or maskable PWA assets; review any required platform-specific treatment separately.

## Clear space and sizes

Retain external clear space equal to **one lowercase character height** around the visible principal artwork, as in the original specification. Use the `o` body height as the measurement: 39.9 source units. Export-canvas padding does not supply this full clear space; reserve it in the surrounding layout. Dedicated approved icon containers use their own intentional internal composition; do not alter their internal geometry to satisfy a wordmark clear-space rule.

| Asset | Practical guidance from current visual inspection |
| --- | --- |
| Stacked principal | Minimum 40px visible artwork width; prefer 55px or larger |
| H3 principal | Minimum 140px visible artwork width; prefer 180px or larger |
| Full-stack square icon | Prefer 64px or larger; 16/32/48px samples are retained in the native-size review evidence |
| yo micro-mark | 16px is a favicon floor for a familiar brand; prefer 32px or larger for clearer recognition |

These are reproduction guidance from this identity's inspected samples, subject to background, device and medium. Earlier 24px stack/64px capital-Y guidance belongs to superseded geometry and is not carried forward as proof for the final identity. The full stack is too dense at 16px; use the approved yo micro-mark. At 16px yo the y foot remains present, while the o counter is necessarily compact.

## H3 website-header positioning

The original viewBox is **292 × 90**. Visible bounds are **x=11.25, y=9.01, width=259.704, height=69.43**. Its y descender reaches **y=78.44**, extending **16.44 source units below the body baseline y=62**. The SVG page includes this descender; retain the full page and use a contained image with automatic height.

| Visible ink width | Visible ink height | Full SVG image size | Vertical slot including one body-height clear space above/below |
| --- | --- | --- | --- |
| 140px | 37.4px | 157.4 × 48.5px | 80.4px |
| 180px | 48.1px | 202.4 × 62.4px | 103.4px |
| 240px | 64.2px | 269.8 × 83.2px | 137.9px |

These widths refer to visible ink, not the CSS image box. For example, setting the image width to 140px produces about 124.5px of visible ink. Reserve the complete silhouette's height and align against its visible bounds rather than the body baseline alone. Avoid containers that hide overflow, fixed-height crops, or `object-fit: cover`. A short navigation header may require a taller header, a smaller placement that still meets the reviewed minimum, or the approved yo micro-mark. Do not solve layout constraints by changing approved glyph geometry.

## Contrast

Computed flat-colour ratios are 17.49:1 for dark on white, 6.40:1 for brand teal on white, and 9.33:1 for white on deep teal. These support the supplied background choices. Verify actual backgrounds and small-size antialiasing in implementation; these values are not an accessibility certification of an application.

The SVGs are RGB/sRGB artwork. The pack provides no CMYK conversion, spot-colour specification or print-process certification. Obtain a printer proof for specialist reproduction.

## Existing Visual Identity v1 foundations

The implemented v1 foundation and semantic-token source remains [app/theme.css](../../app/theme.css), with font loading in [app/layout.tsx](../../app/layout.tsx) and shared primitives under `app/components/ui/`. The original Phase 4A approved foundation brief was located in the prior “Audit Frontend Styling Architecture” task; the values already encoded in the theme match that brief. This asset guide supplements that existing system without changing its architecture, tokens or application typography.

The broader palette remains Brand Accent `#45A995`, Brand Tint `#DDF2ED`, Warm Background `#FAF9F6`, Secondary Text `#5C6468`, Border `#DDE2E0` and Muted Surface `#F4F6F5`; success/warning/error/information remain separate semantic meanings. Bespoke logo glyphs are finished artwork, while interface typography remains Plus Jakarta Sans 400/500/600/700. Do not re-create the wordmarks using interface text or add logo-specific font weights to the interface loader.
