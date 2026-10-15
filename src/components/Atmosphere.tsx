import type { CSSProperties } from 'react';
import { useGlyphStore } from '../state/store';

/* Atmosphere (docs/SPEC.md §6) — the "air" between the field and the chrome:
 * vignette, legibility gradients and a whisper of static grain. Pure CSS:
 * nothing here runs per frame; the only changes are two opacity transitions.
 * All darkening uses the bg token #060A10 = rgb(6 10 16). */

/** Transparent centre → bg/75 % at the corners (farthest-corner ellipse). */
const VIGNETTE: CSSProperties = {
  background:
    'radial-gradient(ellipse at 50% 45%, rgb(6 10 16 / 0) 0%, rgb(6 10 16 / 0) 40%, rgb(6 10 16 / 0.32) 70%, rgb(6 10 16 / 0.75) 100%)',
};

/** Soft shadow pooled behind the hero copy (top-left), so type stays legible over a bright field. */
const LEGIBILITY: CSSProperties = {
  background:
    'radial-gradient(72% 88% at 0% 34%, rgb(6 10 16 / 0.8) 0%, rgb(6 10 16 / 0.52) 40%, rgb(6 10 16 / 0) 100%), ' +
    'linear-gradient(90deg, rgb(6 10 16 / 0.32) 0%, rgb(6 10 16 / 0) 48%)',
};

/** Behind the top bar (~140 px). */
const TOP_FADE: CSSProperties = {
  background: 'linear-gradient(180deg, rgb(6 10 16 / 0.82) 0%, rgb(6 10 16 / 0.38) 48%, rgb(6 10 16 / 0) 100%)',
};

/** Behind the dock, equation card and stats (~180 px). */
const BOTTOM_FADE: CSSProperties = {
  background: 'linear-gradient(0deg, rgb(6 10 16 / 0.88) 0%, rgb(6 10 16 / 0.44) 46%, rgb(6 10 16 / 0) 100%)',
};

/* Static film grain: fractal noise from an SVG feTurbulence filter, desaturated to grey
 * (the colour matrix averages R, G, B and forces alpha = 1). Rasterised once by the browser
 * and tiled; soft-light at 4.5 % only modulates the luminance of what lies beneath. */
const GRAIN_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>" +
  "<filter id='g' x='0' y='0'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/>" +
  "<feColorMatrix values='0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1'/></filter>" +
  "<rect width='100%' height='100%' filter='url(#g)'/></svg>";

const GRAIN: CSSProperties = {
  backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG)}")`,
  backgroundSize: '180px 180px',
};

/** Opacity of the hero shadow: full behind the giant title, softer behind the compact chapter heading. */
function legibilityOpacity(heroCollapsed: boolean, uiHidden: boolean): number {
  if (uiHidden) return 0;
  return heroCollapsed ? 0.5 : 1;
}

export default function Atmosphere() {
  const heroCollapsed = useGlyphStore((s) => s.heroCollapsed);
  const uiHidden = useGlyphStore((s) => s.uiHidden);
  // Presentation mode (H): no chrome to protect, so the bars' fades relax and the field opens up.
  const barFade = uiHidden ? 0.4 : 1;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2] overflow-hidden">
      <div className="absolute inset-0" style={VIGNETTE} />
      <div
        className="absolute inset-0 transition-opacity duration-[1400ms] ease-expo"
        style={{ ...LEGIBILITY, opacity: legibilityOpacity(heroCollapsed, uiHidden) }}
      />
      <div
        className="absolute inset-x-0 top-0 h-[140px] transition-opacity duration-700 ease-expo"
        style={{ ...TOP_FADE, opacity: barFade }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-[180px] transition-opacity duration-700 ease-expo"
        style={{ ...BOTTOM_FADE, opacity: barFade }}
      />
      <div className="absolute inset-0 opacity-[0.045] mix-blend-soft-light" style={GRAIN} />
    </div>
  );
}
