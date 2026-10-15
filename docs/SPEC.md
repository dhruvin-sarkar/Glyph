# GLYPHFIELD — Build Specification

> **EQUATIONS INTO MOTION.** An interactive study of mathematics, movement, and form.
> *Every character is a pixel. Every motion is an equation. Every design is a mathematical system.*
>
> Math Odyssey 2026 · Grade 12 exhibition · Theme: **Math in Design**.
> A mathematical instrument disguised as an interactive digital art installation.

This document is the single source of truth shared by every agent building GLYPHFIELD in parallel.
Read it fully before writing code. The binding code contract is **`src/engine/types.ts`**.

---

## 0. Quality bar

- Awwwards-level creative-coding installation — *not* a school template, dashboard or landing page.
  Dark, quiet, precise, luminous. The field is the hero.
- Every visual is computed live from its equation. No static/fake ASCII, no videos/GIFs, no decorative
  controls: **every control visibly changes the output**.
- Runs smoothly on a typical school laptop driving a projector (target 60 fps, adaptive quality).
- Production code: strict TypeScript, no `any` leaks, **no TODOs / placeholders / stubs left behind**,
  no console noise, no memory leaks, clean teardown (React StrictMode runs effects twice in dev).

## 1. Stack, commands, rules

Vite 8 · React 19 · TypeScript 5.9 (strict, `noUnusedLocals`) · Tailwind CSS 4 (CSS-first `@theme` in
`src/styles/index.css`) · motion 14 (`import { motion, AnimatePresence } from 'motion/react'`) ·
zustand 5 · lucide-react 1.x · vitest 5. Fonts are bundled by @fontsource: **"JetBrains Mono"** (400,
500, 400-italic) and **"Geist Variable"**. Zero network resources at runtime (exhibit must work offline).

```
npm run typecheck     # tsc --noEmit -p tsconfig.app.json
npm test              # vitest run
npm run build         # typecheck + vite build → dist/
npm run build:single  # one self-contained offline HTML → dist-single/
npm run dev           # http://localhost:5173
```

Rules for parallel agents:
- **Only write files you own** (§12). Never edit `package.json`, configs, or orchestrator files. Never
  add dependencies. If you need a contract change, put it in your final report instead.
- Other agents are editing at the same time. When type-checking, filter to your files:
  `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E "src/(your|paths)"`. Errors in others' files are not yours.
- A *GateGuard* hook may reject the **first** Write of each new file and ask for facts (callers, purpose,
  the user's instruction). State them briefly and retry the identical Write — the retry succeeds.
  To modify an existing stub, Read it first, then Write/Edit.
- Use the shared atoms in `src/components/ui/primitives.tsx` (`cx`, `MicroLabel`, `Kbd`, `Hairline`,
  `IconButton`, `GlassPanel`) and utilities `glass`, `micro`, `tabular`.

## 2. Architecture

```
React UI (components/*) ── reads/writes ──▶ useGlyphStore (state/store.ts): mode, params, paused, UI flags
        ▲                                         │  .subscribe() — outside React render
        │ useLiveStore (state/live.ts)            ▼
        └──── stats ~4 Hz · probe ~8 Hz ──── StageCanvas.tsx ── createEngine()  (engine/Engine.ts)
                                                               │  rAF loop · pointer · adaptive quality · transitions
                                                               ├─▶ Experiment (experiments/*.ts) ◀── math/*.ts (pure)
                                                               │      update(ctx) → render(GlyphField)
                                                               └─▶ AsciiRenderer (engine/AsciiRenderer.ts)
                                                                      glyph atlas → <canvas> (+ glow canvas)
```

- React never re-renders per frame. The engine owns the animation loop.
- Experiments never touch the DOM; they read `FrameContext` and write `GlyphField`.
- `math/*` is pure and unit-tested. Experiments **and** the UI equation displays import the same
  `derive*Constants` functions, so the numbers shown are exactly the numbers computed.

## 3. Contract essentials (`src/engine/types.ts`)

- **GlyphField** — flat row-major typed arrays: `glyph` (char code), `intensity` (0..1), `tone`. The
  engine clears it before every `render()`. `set()` writes; `plot()` writes only if brighter (splatting).
- **Tones** — `INK 0 #E9EDF2` (default) · `MINT 1 #B9F5D0` · `ICE 2 #A8C7FF` · `MUTED 3 #788696`.
  Accents are rare (≲ 5 % of drawn glyphs) and always *mean* something.
- Only emit characters from **`GLYPH_CHARSET`** (printable ASCII + `· ° × ± ÷`).
- **Ramps** — `ctx.ramp(RAMPS.classic)` returns a `GlyphRamp` calibrated by *measured ink coverage*;
  `codeFor(v)` maps v ∈ [0,1] to a char code (0 → space). Candidates: `classic`, `shade`, `fine`, `soft`.
- **Coordinates** (`src/engine/coords.ts`):
  - stage px — origin top-left of the canvas, +y down;
  - grid — cell (c, r) centre = (originX + (c+½)·cellW, originY + (r+½)·cellH); cells are ~2× taller than wide;
  - **world (u)** — origin at stage centre, 1 unit = half the stage height, +x right, **+y up**.
    Every experiment states its equation in world units → resolution-independent pictures.
- **Time** — `ctx.time` freezes while paused; `ctx.dt` = 0 while paused (else ≤ 1/20 s); `ctx.realDt` never freezes.
- **Pointer** — read the per-frame `ctx.pointer` snapshot (no callbacks). `clicks[]` = clicks completed this
  frame. `inside` is false when the pointer is over UI chrome. `idleTime` = seconds since last stage activity.

## 4. The mathematics (binding semantics)

### 4.1 WAVEFIELD — `experiments/wavefield.ts`, `math/waves.ts`

```
f(x, y, t) = A·sin(k₁·r − ω t) + A·sin(k₂·r − ω t) + Σᵢ ρᵢ(x, y, t)
```
- r = (x, y) in world units. |k₁| = |k₂| = k (param `frequency`). ω = c·k (param `speed` = c): non-dispersive.
- k₁ points at φ₁ = 18° from +x; k₂ at φ₂ = φ₁ + θ (param `angle`). θ = 180° → **standing wave**
  (nodes stand still); θ = 0° → the waves simply add.
- `second` off → A₂ = 0 (a single plain sine wave). `amplitude` = A. `disturb` = B (ripple strength).
- **Cursor ripples** — damped radial wave packets
  `ρᵢ = B·sᵢ·e^{−τ/T}·sin(k_r(d − c_r τ))·e^{−((d − c_r τ)/σ)²}`, d = |r − pᵢ|, τ = t − tᵢ.
  Click → strong pulse (sᵢ ≈ 1). Move/drag → small pulses emitted along the path, proportional to speed.
  Idle (no pointer ≥ ~4 s) → a "ghost" emitter on a slow Lissajous curve emits gentle pulses so the field
  is never static. Ring buffer of ~16 live ripples; cull ripples whose energy is negligible.
- **Normalise** with a FIXED scale so amplitude visibly changes contrast: `n = ½ + ½·tanh(f / 1.5)`
  (`normalizeField` in math/waves.ts).
- Glyph = calibrated `RAMPS.classic` at n; intensity shaped from n (dark troughs, luminous crests).
  MINT only for the very brightest crests (e.g. where recent ripples reinforce a peak) — rare.
- **Projection** (`view` param, same equation, different projection):
  - `horizon` (default, cinematic): the plane seen in perspective as an ocean receding to a horizon at
    ≈ 38–42 % from the top. Each cell below the horizon is mapped back to plane coordinates (x, y) by
    inverse perspective (depth Z = h·f / (y_screen − y_horizon), X = x_screen·Z / f); depth fog fades
    distant rows (and hides aliasing). Above the horizon: a quiet dark sky (sparse dim `·`/`.` stars at
    most). Pointer ripples are projected onto the plane too.
  - `plane`: top-down orthographic map — the clearest view of the interference lattice.
- **Required optimisation & talking point**: `sin(a + b) = sin a·cos b + cos a·sin b`. Precompute
  per-column and per-row sin/cos terms each frame so each cell costs a few multiply-adds instead of two
  `sin()` calls (plane view). In horizon view precompute per-row depth and per-row terms.
- **Probe**: at the cursor (or ghost) cell — x, y, t, f, n, glyph (`valueLabel: 'f(x,y,t)'`), `vars: { t }`.

### 4.2 ATTRACTOR — `experiments/attractor.ts`, `math/vectorField.ts`, `math/integrate.ts`

```
F(x, y) = Σⱼ wⱼ · [ s·(−Δy, Δx) − g·(Δx, Δy) ] / (Δx² + Δy² + ε),    Δ = p − aⱼ,    dp/dt = F(p)
```
- Rotational term (s, param `swirl`) = point vortex; radial term (g, param `strength`) = point sink.
  Together the streamlines are **logarithmic spirals** r = r₀·e^{−(g/s)θ}. s = 0 → straight inflow;
  g = 0 → circular orbits. ε (param `softening`) removes the singularity; speed is clamped to `V_MAX`.
- The vector field **is** the velocity. Integrate with classical **RK4** each frame (sub-step when dt is
  large). Respawn a particle when captured (r < r_capture), off-stage, or at end of lifetime; spawn over
  the whole stage (and slightly beyond) so streams arrive from everywhere.
- Main attractor a₀ follows the pointer with critically-damped smoothing. When the pointer is idle or
  outside, a₀ drifts along a slow Lissajous curve — alive by default.
- Click → temporary attractor at the click point with **opposite swirl**, weight fading 1 → 0 over ~6 s
  (max 3). Superposition: fields simply add.
- Glyph per particle = its direction of motion quantised to 8 sectors → `-  /  |  \` (careful: world
  y is up, screen y is down). Trails (`trails`) = per-cell decaying energy buffer drawn with `RAMPS.soft`.
  Brightness from speed. MINT near the main core / fastest particles; ICE for the temporary attractors.
- `field` toggle: faint MUTED quiver glyphs on a sparse lattice showing F's direction everywhere.
- `count` changes the live particle count smoothly (grow/shrink pools without a visible reset).
- **Probe**: a tracked particle highlighted with a short mint trail — position, velocity F(p), |F|,
  steps integrated; `vars: { ax, ay, t }` (attractor position).

### 4.3 TOPOLOGY — `experiments/topology.ts`, `math/mobius.ts`, `math/linalg.ts`

```
r(u, v) = ( (R + v·cos(nu/2))·cos u,  (R + v·cos(nu/2))·sin u,  v·sin(nu/2) ),   u ∈ [0, 2π), v ∈ [−w, w], R = 1
```
- n = half-twists, **integer 0…7 only**. Non-integer n does not close up — the slider clicks in whole
  half-twists. Never render a fractional n (no tearing at the seam, ever).
- Software 3D renderer: precompute surface samples (positions + analytic normals N = r_u × r_v) only when
  n or w change; per frame rotate (drag with inertia + auto-rotate), perspective-project to stage px →
  cells (account for non-square cells), per-cell z-buffer, two-sided Lambert + soft specular + ambient,
  depth fog → calibrated `RAMPS.shade`. Sampling dense enough to leave no holes at max density.
- `edges` (default on): boundary samples |v| ≈ w drawn depth-tested on top — odd n: ONE edge, all MINT
  ("one colour = one edge"); even n: TWO edges, MINT and ICE.
- `sides`: colour by sign(N̂·view): INK vs ICE. Orientable bands paint consistently with two colours; for
  odd n the colours swap across the seam u = 0 — **that seam is the proof of one-sidedness**.
- Facts from `deriveBandConstants`: sides, edges, orientable, χ = 0, edge curve = torus knot/link
  T(2, n) (unknot, Hopf link, trefoil, Solomon link, cinquefoil, …), linking number n/2 for even n.
- `density` → `cellScale() = 1 / density`. `spin` = auto-rotate rate; `autorotate` toggles it.
- Wheel zooms (clamped). Reset restores the camera.
- **Probe**: `facts` (SIDES, EDGES, ORIENTABLE, EDGE CURVE), yaw/pitch, samples drawn; value = N·L at
  the cursor cell (or screen centre), `valueLabel: 'N·L'`.

## 5. Engine behaviour — `engine/*`, `components/StageCanvas.tsx`

- **Fonts**: `await document.fonts.load('500 16px "JetBrains Mono"')` (timeout fallback ~2 s) before
  building the atlas; rebuild if fonts finish later.
- **Grid**: base font size from the stage width, ≈ clamp(11, 0.0082 × width, 15) CSS px → ~150–230
  columns. Effective size = base × `experiment.cellScale?.() ?? 1` ÷ quality. Line height ≈ 1.18–1.25 ×
  font size. Pixel-snap so cellW·dpr and cellH·dpr are integers; dpr capped at 2; grid centred.
- **Atlas**: pre-render `GLYPH_CHARSET` × `TONE_COUNT` (× brightness levels, or tint + globalAlpha) once
  per `configure()`. Draw with `drawImage` from the atlas at integer device pixels. Skip empty / ~0 cells.
- **Glow**: a low-res canvas with one pixel per cell (tone colour × a curve of intensity above ~0.55),
  CSS-upscaled with smoothing + `blur(8–14px)`, `mix-blend-mode: screen`, opacity ~0.35–0.5.
  Auto-off when quality < 0.75. Subtle — a phosphor halo, never a fog.
- **Loop**: rAF; dt clamp; `visibilitychange` pause/resume without a dt spike; stats every ~250 ms,
  probe every ~125 ms.
- **Adaptive quality** (toggleable): EMA fps; < 50 for 1.5 s → step down (1 → 0.9 → 0.8 → 0.7 → 0.6);
  > 58 for 4 s → step up (with hysteresis — don't oscillate). Quality multiplies cell size; grid rebuild is
  debounced and calls `experiment.resize()`.
- **Transitions** (`setMode`): glyph scramble. OUT ≈ 320 ms (cells dissolve into random glyphs and fade,
  noise-ordered sweep) → switch experiment (and grid) → IN ≈ 650 ms (cells decode from flickering MINT
  glyphs into the new field, radiating from the centre with noise). First load: IN ≈ 1400 ms out of
  darkness. Reduced motion: a 200 ms intensity fade only.
- **Pointer**: listen on the canvas (pointer events + wheel). Over UI chrome the canvas receives
  `pointerleave` → `inside = false`. `touch-action: none`. Click = press+release < 6 px and < 450 ms.
- **Reduced motion**: time scale ~0.4, no scramble, gentler ghosts.
- **StrictMode-safe**: create/destroy idempotent; destroy cancels rAF, removes every listener and
  observer, releases canvases. No leaks.
- **StageCanvas**: full-bleed `fixed inset-0` canvas with `data-glyph-stage` (+ glow canvas above it,
  `pointer-events: none`), `role="img"` + `aria-label` naming the current experiment, a visually hidden
  live region announcing experiment changes; pushes store changes into the engine via
  `useGlyphStore.subscribe` (mode, params, paused, adaptive, resetNonce) and engine readouts into
  `useLiveStore`; reads `useReducedMotion()`.

## 6. Art direction

**Mood** — a nocturnal measuring instrument. The field is the hero; chrome is hairline-thin, glassy and
quiet. Typography and spacing carry the luxury. Think experimental digital-art museum × research lab.

**Palette** — tokens in `index.css`: bg `#060A10`, surface `#0C121B`, raised `#111924`, ink `#E9EDF2`,
muted `#788696`, faint `#3D4855`, mint `#B9F5D0`, ice `#A8C7FF`, line white/8 %, line-strong white/12 %.
Mostly monochrome. Mint = "live / active / the value that just changed". Ice = "second / alternative".
Never neon, no decorative gradients, no emoji, no fake terminal styling, no Bootstrap-looking controls,
no cards-everywhere.

**Type**
- Display: Geist Variable, weight 560–620, tracking −0.045em…−0.055em, leading 0.85–0.9,
  size `clamp(64px, 10.5vw, 188px)`.
- Editorial body: Geist 15–17 px, muted, ≤ 38ch.
- Technical: JetBrains Mono — micro labels 10 px uppercase tracking 0.22em (`micro`); values 11–13 px
  `tabular`. Math variables in *JetBrains Mono italic*; live numbers in mint.
- Glyph availability: bundled fonts cover Basic Latin, Latin-1 (`² ³ · × ÷ ± °`), General Punctuation
  (`— – • ′ …`), Greek (`α–ω Σ Δ θ ω ε φ π`) and U+2212 `−`. Arrows/maths operators (`→ ∑ √ ∞ ∂`) fall
  back to system fonts — prefer drawing them (SVG) or avoid.

**Surfaces** — `glass` utility; radius 16–18 px panels, 999 px pills; 1 px hairlines; inner top highlight;
no heavy shadows.

**Motion** — ease-expo `cubic-bezier(.16,1,.3,1)`. UI enters with opacity + 8–14 px translate, staggered
50–70 ms, total ≤ 1.2 s, after the engine reports `ready`. Text scramble (`useScrambleText` /
`<ScrambleText>`) for headings and labels that change. Dock indicator spring (stiffness ~420, damping
~34). Reduced motion → opacity only, ≤ 150 ms.

**Atmosphere** — radial vignette; a soft left-side legibility gradient behind the hero text; gentle top &
bottom fades behind the bars; very subtle static grain (≤ 5 % opacity). No scanlines.

**Icons** — lucide-react, 14–16 px, `strokeWidth={1.5}`.

**Cursor** — over the stage only: a hairline ring that lags slightly + a 3 px mint dot; shrinks on press;
hidden over UI chrome (`[data-glyph-stage]` detection), on touch, and when UI is hidden only if idle.

## 7. Layout map

Desktop ≥ 1280 px (CSS vars: `--gutter` 28px, `--topbar-h` 64px, `--panel-w` 348px):

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TopBar  h=64 · GLYPHFIELD / MATH ODYSSEY   AN INTERACTIVE STUDY OF…   ● LIVE · EST. 2026 │
│                                                                                          │
│ HeroTitle (left: gutter, top ≈ 16–20vh)                        ParameterPanel            │
│   MATH IN DESIGN · MATH ODYSSEY 2026                           right: gutter             │
│   GLYPHFIELD                                                   top: topbar-h + 16        │
│   EQUATIONS INTO MOTION.                                       width: panel-w            │
│   An interactive study of mathematics, movement, and form.     max-height: 100dvh −     │
│   ─ 01 · WAVEFIELD — subtitle (scrambles on change)              topbar-h − 132px        │
│                                                                                          │
│                        InteractionHint (centre, bottom: gutter + 64)                     │
│ EquationCard (left: gutter,     Dock (centre, bottom: gutter)          StatsReadout     │
│   bottom: gutter, w 420)                                               (right, bottom)  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- 768–1279 px: gutter 20; EquationCard compact (equation only, w ≤ 356, probe hidden) and it must never
  overlap the Dock (collapse to a pill below 320px of available room); StatsReadout one line; panel w 312.
- < 768 px: TopBar compact (brand + live dot); hero smaller (`clamp(44px, 13vw, 64px)`); EquationCard
  hidden (maths via the drawer); ParameterPanel becomes a bottom sheet toggled from a "PARAMETERS" pill;
  Dock spans the width minus gutters; StatsReadout hidden.
- Hero condensing: when `heroCollapsed` (set on the first experiment switch) the giant word shrinks to a
  compact chapter heading (`GLYPHFIELD` stays in the TopBar) to free the field.
- z-index: canvas 0 · glow 1 · atmosphere 2 · overlay 10 · drawer 30 · shortcuts overlay 40 · cursor 50.
- The overlay layer is `pointer-events-none`; every interactive element sets `pointer-events-auto`.
- MathDrawer: left side, full height, width `min(520px, 100vw)`, `glass`, slides in from the left; the rest
  of the screen is dimmed ~30 % (field stays visible). Esc / M / close button close it.
  Six chapter links stay visible above the reading area. Start with a plain-language reading and a
  live formula; symbolic equations, longer explanations and ramp calibration use native disclosures.
  Space operates a focused disclosure, while the global pause shortcut remains available elsewhere.
- Parameter panels use 14px labels, 13px values and visible short effect hints. Mobile sheets may use
  up to 70dvh, bounded by the available screen height; their control list scrolls independently.
- Live equation labels separate wave contributions and show a sample value, normalised level and
  character. Mode-specific notes explain the mapping: speed and direction for particles, lighting
  and depth for the surface. Unavailable samples and observed space characters remain distinct.
  The introductory label keeps the sample collapsed; after an experiment switch it opens when
  at least 850px of screen height is available. Short introductory screens use a math pill.

## 8. Interaction & keyboard map

`Space` pause/play · `1` `2` `3` switch experiment · `←` `→` previous/next experiment · `R` reset experiment
(params → defaults + simulation reset) · `M` toggle THE MATH · `P` toggle parameter panel · `H` hide/show UI
(presentation mode) · `F` fullscreen · `?` shortcuts overlay · `Esc` close overlays.

- Ignore shortcuts while typing in a text field. When a range input is focused, let arrows adjust it.
  Space never scrolls the page and never "clicks" a focused button.
- **Auto tour** (exhibition attract mode): after 90 s with no input, cycle experiments every ~25 s and
  apply gentle presets (`content/presets.ts`); any input stops it. `store.touring` drives an "AUTO TOUR"
  indicator in the TopBar.

## 9. Stores

- `useGlyphStore` (`state/store.ts`) — mode, params, paused, adaptive, panelOpen, mathOpen, uiHidden,
  shortcutsOpen, heroCollapsed, touring, resetNonce, lastChange + actions (setMode, cycleMode, setParam,
  applyPreset, resetExperiment, resetSimulation, …). `registry.ts` has `META_BY_ID`, `EXPERIMENTS`,
  `defaultParams`, `sanitizeParam`, `formatParam`, `paramDecimals`.
- `useLiveStore` (`state/live.ts`) — `stats: EngineStats` (~4 Hz) and `probe: ProbeReadout | null` (~8 Hz).
- Always select narrowly: `useGlyphStore((s) => s.mode)`. Never subscribe to whole stores in components.

## 10. Content voice

For grades 9–12 and curious judges: short sentences, precise words, zero fluff, mathematically correct.
Equations shown exactly as computed, with live values. Each experiment: the equation · what each variable
means · what changing a parameter does to the design · one-sentence real-world connection · "Try this"
presets. An interactive exhibit label, not a textbook.

## 11. Performance budgets (mid laptop, 1920×1080, ~230×65 grid)

Experiment update+render ≤ 5 ms · renderer draw ≤ 6 ms · zero React work per frame · zero per-frame
allocations in hot loops (typed arrays, preallocated scratch) · GC-quiet.

## 12. File ownership

| Agent | Owns |
|---|---|
| **engine-renderer** | `src/engine/GlyphAtlas.ts`, `src/engine/GlyphRamp.ts`, `src/engine/AsciiRenderer.ts`, `src/engine/__tests__/*` |
| **engine-core** | `src/engine/Engine.ts`, `src/engine/Pointer.ts`, `src/engine/AdaptiveQuality.ts`, `src/engine/Transition.ts`, `src/components/StageCanvas.tsx` |
| **wavefield** | `src/math/waves.ts`, `src/math/__tests__/waves.test.ts`, `src/experiments/wavefield.ts`, `src/experiments/wavefield.params.ts` |
| **attractor** | `src/math/vectorField.ts`, `src/math/integrate.ts`, `src/math/__tests__/vectorField.test.ts`, `src/experiments/attractor.ts`, `src/experiments/attractor.params.ts` |
| **topology** | `src/math/mobius.ts`, `src/math/linalg.ts`, `src/math/__tests__/mobius.test.ts`, `src/experiments/topology.ts`, `src/experiments/topology.params.ts` |
| **ui-shell** | `src/components/{TopBar,HeroTitle,Dock,StatsReadout,InteractionHint,CustomCursor,Atmosphere}.tsx`, `src/hooks/useScrambleText.ts`, `src/components/ui/ScrambleText.tsx` |
| **ui-controls** | `src/components/{ParameterPanel,KeyboardShortcuts,ShortcutsOverlay,AutoTour}.tsx`, `src/components/controls/*`, `src/styles/controls.css` |
| **math-content** | `src/components/{EquationCard,MathDrawer}.tsx`, `src/components/equations/*`, `src/content/*` |
| **orchestrator** | everything else: `package.json`, configs, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles/index.css`, `src/engine/{types,GlyphField,coords}.ts`, `src/experiments/registry.ts`, `src/state/*`, `src/hooks/useReducedMotion.ts`, `src/components/ui/primitives.tsx`, `docs/*` |

Param schemas (`*.params.ts`): ids are frozen (UI, presets and equations depend on them). Owners may
tune `default`/`min`/`max`/`step`/copy for beauty, and must report any change.

## 13. Definition of done (per agent)

- Your files compile with zero TypeScript errors under strict mode; your tests pass; no placeholders.
- Behaviour matches this spec; visual quality meets §0 and §6.
- Final report: files written, key decisions, any deviation from this spec, and anything other agents or
  the integrator must know (e.g. an import you rely on).
