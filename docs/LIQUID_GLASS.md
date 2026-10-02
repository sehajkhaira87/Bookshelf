# Liquid Glass buttons

The lighter Contribute design from the earlier chat is preserved. The PYQ page now uses
a light cream background (`#EFE6D6`) with coordinated cream-beige cards (`#E2D2B9`)
and darker warm-brown borders (`#795B40`), scoped to `.pyqs-page`.
The button treatment does not set padding, dimensions, font, spacing, display, or border radius.

## Exact CSS

- [Shared button stylesheet](../static/liquid-glass.css): the complete reusable effect.
- [Original button-treatment CSS diff](liquid-glass-css.patch): compares against the saved pre-button-treatment
  CSS in `static/.glass-qa/before-*.css`, rather than Git HEAD, which predates the earlier
  approved Contribute/PYQ redesigns. Includes the entire new shared stylesheet.

The shared rules supply a translucent warm fill, a 4px backdrop blur fallback with
Safari prefix, a masked `::before` rim highlight, and an `::after` reflection behind
the label. Hover lifts 1px and press uses a 0.995 scale. `liquid-glass.js` adds
pointer lighting and progressive edge refraction; it never handles clicks or forms.
Opaque fallbacks, reduced motion, reduced transparency, keyboard focus, forced colors,
disabled controls, and selected/dimmed semester states are covered.

`contribute.css` retains the earlier page design and drops the superseded back-button
reflection. `pyqs.css` retains the existing geometry while moving the button surfaces,
reflections, and interaction rules into the shared file. Its original reduced-transparency
fallback for form inputs/selects is preserved.

## HTML classes

Each affected template loads `liquid-glass.css` after its existing styles and
`liquid-glass.js` with `defer`. No additional HTML classes or wrappers were needed
for the edge-refraction enhancement.
The dashboard is excluded at the user's request and uses its original button styling.

| Template | Existing controls receiving `liquid-glass` |
| --- | --- |
| `contribute.html` | Return, Shelf your Notes, Scan with Camera, Upload a File, Cancel, remove file, Place on the Shelf |
| `pyqs.html` | Return, Search, Clear, Open PDF, pagination, upload/delete controls when rendered |
| `resource-catalogue.html` | Return, library tabs, Search, Clear filters, Open file, pagination |
| `books.html`, `notes.html`, `assignments.html` | Return to Dashboard in the existing legacy templates |

`liquid-glass--dark` is also used on library controls with cream/gold text over dark
backgrounds. The dashboard does not load the shared stylesheet, so its notification
buttons are also unchanged, including buttons created dynamically by JavaScript.

The file-remove button also has `type="button"` and an accessible label.
Missing site-effects/appearance includes and dashboard role conditions/links inherited
from the unfinished work were restored. The existing role visibility and navigation
destinations are preserved. `pyqs-glass.js` remains a compatibility entry point for cached
templates; the shared `liquid-glass.js` now owns optional edge optics.

## Original button-treatment verification

- All 182 existing offline Python regression tests passed.
- Contribute start and choice states: identical measured geometry, typography, padding,
  and margins at 1440px and 390px widths compared with the pre-treatment CSS.
- PYQ controls/layout: identical measured geometry and typography at both widths.
- No horizontal overflow on the checked mobile pages.
- Browser checks exercised local file selection/removal/cancel, native search submission,
  return navigation, semester selection, and notification open/close/disabled controls.
- Previews used synthetic data and did not submit uploads or connect to production services.
- Safari prefixes/fallback rules were reviewed; a Safari device was not available for execution.


## Curved-edge refraction enhancement

- [Exact incremental CSS changes](liquid-glass-refraction.patch) compare the previous
  shared button stylesheet with this enhancement. [JavaScript](../static/liquid-glass.js)
  supplies the geometry-based maps and passive pointer-light updates.
- Chromium receives a rounded-rectangle displacement map based on a circular bevel
  and Snell's law (refractive indices 1.0 and 1.45). Sampling shifts are limited to
  5.5 CSS pixels in a narrow inner edge band. The center stays neutral. This is a
  lightweight optical approximation, not Apple's proprietary native material renderer.
- An SVG `feDisplacementMap` operates on the backdrop, followed by 0.65px blur and
  restrained saturation. Text/icons remain outside the filter. `sRGB` interpolation
  preserves neutral map channels. Canvas generates a map only for a new geometry;
  it does not capture the page, access media, or redraw every animation frame.
- Maps are shared by geometry, built for visible controls, and updated on resize or
  reveal. Unused cache entries are evicted above 64; active references are retained.
  There is no continuous animation loop. Pointer highlights update at most once per
  animation frame while the pointer moves over an enabled button.
- Safari, Firefox, and browsers without the required APIs keep ordinary frosted
  glass and curved rim highlights. SVG URL backdrop filters are gated to Chromium:
  `CSS.supports()` alone cannot verify that this rendering path actually works.
- Reduced motion disables pointer-following light and transforms. Reduced
  transparency/forced colors disable refraction and retain accessible solid fills.
  Native keyboard focus, links, form submission and disabled controls are preserved.
- Dashboard, landing-page, login-page, and PYQ card/background files are unchanged
  by this enhancement. Only the six already opted-in templates load the new script.

### Research

Apple describes lensing, geometry-aware highlights and content legibility as parts
of one adaptive material. The Bookshelf implementation adopts those visual cues
while retaining the existing warm palette and button layout.

- [Apple: Meet Liquid Glass (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/219/)
- [Apple: Liquid Glass overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
- [MDN: backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)
- [MDN: feDisplacementMap](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feDisplacementMap)
- [WebKit: SVG backdrop filter support issue](https://bugs.webkit.org/show_bug.cgi?id=245510)

### Refraction verification

- Chromium grid comparison visibly confirms curved edge distortion and a stable center.
- Contribution and PYQ button dimensions, padding and fonts match the previous version.
- Local preview checks cover contribution choice/Cancel and native PYQ search submission.
- Mobile frames at 390px show no horizontal overflow on Contribute/PYQs.
- An 80-size resize exercise retains refraction with the cache bounded to 64 entries.
- A Safari device was not available; its fallback was reviewed, not executed in Safari.

- Eight focused optics tests pass; 12 existing animation tests also pass.
- All 26 PYQ/catalogue regression tests pass using the bundled Python runtime.
