import type { ExperimentId, RAMPS } from '../engine/types';

/* ═══════════════════════════════════════════════════════════════════════════
 *  THE MATH — the exhibit label of every experiment (grades 9–12, for judges).
 *
 *  Copy conventions (rendered by components/equations/MathText.tsx):
 *    $…$    inline maths: single letters italic, sin/cos upright, k_1 subscripts,
 *           e^{…} powers, √ε roots, ∈ ≈ → drawn as SVG
 *    {key}  a live value slot (see VALUE_KEYS), filled with the number the
 *           simulation is using right now — computed by the same derive*()
 *           functions as the experiments.
 *  Negative numbers use the true minus sign (U+2212). No arrows or maths
 *  operators in plain text: the bundled font does not contain them.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The live values each experiment can show (variables table + {slots} in the copy). */
export const VALUE_KEYS = {
  waves: ['f', 'A', 'k', 'lambda', 'c', 'omega', 'theta', 'phi', 'phi1', 't', 'B', 'lanes', 'period', 'F0'],
  attractor: ['F', 'a', 's', 'g', 'eps', 'ratio', 'pitch', 'vmax', 'N', 'core'],
  topology: ['u', 'v', 'R', 'w', 'n', 'turn', 'chi', 'edge'],
} as const satisfies Record<ExperimentId, readonly string[]>;

export type ValueKey<M extends ExperimentId> = (typeof VALUE_KEYS)[M][number];

export interface VariableSpec<M extends ExperimentId> {
  /** maths markup of the symbol, e.g. "k", "φ_1, φ_2", "V_{max}" */
  symbol: string;
  name: string;
  /** what it means — prose with $maths$ */
  meaning: string;
  /** the live value shown (mint) */
  value?: ValueKey<M>;
  /** shown instead of a value when the variable has no single value — prose with $maths$ */
  note?: string;
}

export interface EffectSpec {
  /** parameter id (frozen ids from experiments/*.params.ts) */
  param: string;
  /** maths markup shown beside the line ('' for a switch) */
  symbol: string;
  /** the move, e.g. "Raise $k$" */
  cause: string;
  /** what the design does in response */
  effect: string;
}

export interface IdeaSpec {
  /** short title (may contain $maths$) */
  title: string;
  /** one or two sentences — prose with $maths$ and {slots} */
  body: string;
}

export interface PipelineStep {
  /** micro label, e.g. "NORMALISE" */
  step: string;
  /** maths markup ('' when the step is described in words only) */
  math: string;
  /** prose with $maths$ and {slots} */
  note: string;
  /** glyphs this step can print, shown as tiles (e.g. the four direction strokes) */
  glyphs?: string;
}

export interface Explanation<M extends ExperimentId = ExperimentId> {
  id: M;
  /** the quantity being computed, as maths markup — e.g. "f(x, y, t)" (compact equation pill) */
  symbol: string;
  /** micro line of the ideas covered */
  topics: readonly string[];
  /** the general (symbolic) form — one display line per entry, maths markup */
  general: readonly string[];
  /** what the symbols of the general form are — prose */
  where: string;
  /** 01 · one-line plain-English reading of the equation */
  reading: string;
  /** 01 · the key ideas behind the equation */
  ideas: readonly IdeaSpec[];
  /** 02 · THE VARIABLES */
  variables: ReadonlyArray<VariableSpec<M>>;
  /** 03 · WHAT CHANGES WHAT — exactly one line per parameter */
  effects: readonly EffectSpec[];
  /** 05 · FROM NUMBER TO GLYPH — this experiment's pipeline */
  pipeline: readonly PipelineStep[];
  /** the candidate ramp this experiment draws with (shown calibrated in 05) */
  ramp: keyof typeof RAMPS;
  /** symbol of the normalised intensity in the probe pipeline */
  intensitySymbol: string;
  /** 06 · IN THE REAL WORLD */
  realWorld: string;
  realWorldMore?: string;
}

/* ─── 01 · WAVEFIELD ─────────────────────────────────────────────────────── */

const waves: Explanation<'waves'> = {
  id: 'waves',
  symbol: 'f(x, y, t)',
  topics: ['SUPERPOSITION', 'INTERFERENCE', 'STANDING WAVES'],
  general: ['f(x, y, t) = A_1·sin(k_{1x}x + k_{1y}y − ωt) + A_2·sin(k_{2x}x + k_{2y}y − ωt) + Σ_i ρ_i'],
  where:
    'Each wave vector points along its heading: $k_1 = k·(cos φ_1, sin φ_1)$ and $k_2 = k·(cos φ_2, sin φ_2)$, ' +
    'with $φ_1$ = {phi1} and $φ_2 = φ_1 + θ$. Both waves share the amplitude $A$ and the angular frequency $ω = c·k$.',
  reading:
    'Add two sine waves sweeping across the plane, plus the ripples you make: the sum f is the height of the water at every point, at every instant.',
  ideas: [
    {
      title: 'Superposition',
      body: 'Waves do not bounce off each other — they add. The field is simply $f = f_1 + f_2$ plus your ripples, and each wave passes through the other unchanged.',
    },
    {
      title: 'Interference',
      body:
        'With both waves on and no cursor ripples, crest meets crest adds to $2A$ (constructive); crest meets trough cancels to $0$ (destructive). ' +
        'Because $sin a + sin b = 2·sin((a + b)/2)·cos((a − b)/2)$, the sum is a travelling wave times a fixed pattern $cos(q·r)$ with $q = (k_1 − k_2)/2$. ' +
        'Where $cos(q·r) = 0$ the water stays calm at every instant — lanes $π/(k·sin(θ/2))$ apart, right now {lanes}.',
    },
    {
      title: 'Standing waves',
      body:
        'With both waves on and no cursor ripples, $θ = 180°$ makes the waves meet head-on ($k_2 = −k_1$): $f = −2A·cos(k_1·r)·sin(ωt)$. ' +
        'Space and time separate — the pattern breathes in place, and its nodes, where $cos(k_1·r) = 0$, never move.',
    },
    {
      title: 'Why $ω = c·k$',
      body:
        'A crest is a point of constant phase: $k·x − ωt$ stays fixed, so $x = (ω/k)·t + const$ and the crest moves at speed $ω/k$. ' +
        'Choosing $ω = c·k$ sends every wavelength at the same speed $c$. A crest passes each point every $T = 2π/ω$ = {period}.',
    },
    {
      title: 'Your ripples',
      body:
        'A click adds $ρ_i = B·s_i·e^{−τ/T_r}·sin(k_r(d − c_rτ))·e^{−((d − c_rτ)/σ)²}$, where $d$ is the distance from the click and $τ$ the time since: ' +
        'a ring of radius $c_rτ$ inside a Gaussian envelope that fades with time. Moving the cursor sends smaller ones. They all just add.',
    },
  ],
  variables: [
    { symbol: 'f', name: 'Field value', meaning: 'Height of the surface at a point and an instant.', value: 'f' },
    { symbol: 'A', name: 'Amplitude', meaning: 'Height of each wave; $A_2 = 0$ when wave 2 is off.', value: 'A' },
    { symbol: 'k', name: 'Wave number', meaning: 'Radians of phase per unit of distance.', value: 'k' },
    { symbol: 'λ', name: 'Wavelength', meaning: 'Crest-to-crest distance, $λ = 2π/k$.', value: 'lambda' },
    { symbol: 'c', name: 'Wave speed', meaning: 'How fast every crest travels.', value: 'c' },
    { symbol: 'ω', name: 'Angular frequency', meaning: 'Radians of phase per second, $ω = c·k$.', value: 'omega' },
    { symbol: 'θ', name: 'Crossing angle', meaning: 'Angle between the two directions of travel.', value: 'theta' },
    { symbol: 'φ_1, φ_2', name: 'Headings', meaning: 'Directions of $k_1$ and $k_2$, measured from $+x$.', value: 'phi' },
    { symbol: 't', name: 'Time', meaning: 'Seconds of simulation; frozen while paused.', value: 't' },
    { symbol: 'B', name: 'Ripple strength', meaning: 'Scales every cursor ripple $ρ_i$.', value: 'B' },
  ],
  effects: [
    {
      param: 'amplitude',
      symbol: 'A',
      cause: 'Raise $A$',
      effect: 'taller crests and deeper troughs push more cells to the dense end of the ramp — more contrast.',
    },
    {
      param: 'frequency',
      symbol: 'k',
      cause: 'Raise $k$',
      effect: 'the crests crowd together: $λ = 2π/k$ shrinks, and $ω = c·k$ rises with it.',
    },
    {
      param: 'speed',
      symbol: 'c',
      cause: 'Raise $c$',
      effect: 'every crest travels faster; at $c = 0$ the pattern freezes ($ω = 0$).',
    },
    {
      param: 'angle',
      symbol: 'θ',
      cause: 'Turn $θ$',
      effect: 'the lattice re-forms: $0°$ merges the waves into one, $90°$ weaves a grid, $180°$ makes a standing wave.',
    },
    {
      param: 'second',
      symbol: 'A_2',
      cause: 'Switch off wave 2',
      effect: '$A_2 = 0$: the lattice dissolves into a single train of parallel crests.',
    },
    {
      param: 'disturb',
      symbol: 'B',
      cause: 'Raise $B$',
      effect: 'your ripples hit harder; at $B = 0$ the field ignores you.',
    },
    {
      param: 'view',
      symbol: '',
      cause: 'Change the projection',
      effect: 'the same $f(x, y, t)$, seen as an ocean receding to the horizon or as a flat top-down map.',
    },
  ],
  pipeline: [
    { step: 'EVALUATE', math: 'f(x, y, t)', note: 'The equation at the centre of every cell, every frame.' },
    {
      step: 'NORMALISE',
      math: String.raw`n = ½ + ½·tanh\left(\frac{f}{F_0}\right)`,
      note: 'Squeezes $f$ into $(0, 1)$ with a fixed scale $F_0$ = {F0}, so more amplitude really means more ink.',
    },
    { step: 'CHOOSE', math: 'glyph = ramp(n)', note: 'The character whose measured ink coverage is closest to $n$.' },
  ],
  ramp: 'classic',
  intensitySymbol: 'n',
  realWorld:
    'Noise-cancelling headphones play an inverted copy of the incoming sound, so the two waves add up to almost nothing — destructive interference, on purpose.',
  realWorldMore:
    'The same sum shapes crossing ocean swells and the Wi-Fi dead spots in a home, where reflected signals arrive out of step and cancel.',
};

/* ─── 02 · ATTRACTOR ─────────────────────────────────────────────────────── */

const attractor: Explanation<'attractor'> = {
  id: 'attractor',
  symbol: 'F(x, y)',
  topics: ['VECTOR FIELDS', 'LOGARITHMIC SPIRALS', 'RK4 INTEGRATION'],
  general: [
    String.raw`F(x, y) = Σ_j w_j·\left[\frac{s·(−Δy, Δx) − g·(Δx, Δy)}{Δx² + Δy² + ε}\right]`,
    String.raw`\frac{dp}{dt} = F(p)`,
  ],
  where:
    'Here $Δ = p − a_j$ points from attractor $j$ to the particle at $p$. The main attractor has weight $w_0 = 1$; ' +
    'each click adds one that spins the other way, its weight fading from 1 to 0. $|F|$ is capped at $V_{max}$ = {vmax}.',
  reading:
    'Every point of the plane carries an arrow F; thousands of glyphs simply follow the arrows, swirling around the attractor as they sink into it.',
  ideas: [
    {
      title: 'A field of arrows',
      body: 'A vector field attaches an arrow to every point: $F(x, y)$ says which way to move and how fast. A particle just follows the arrows, $dp/dt = F(p)$ — its path is a stream line.',
    },
    {
      title: 'Vortex + sink',
      body:
        '$(−Δy, Δx)$ is $Δ$ turned through 90°, so $s·(−Δy, Δx)$ pushes sideways: a vortex. $−g·(Δx, Δy)$ points straight at the attractor: a sink. ' +
        'Both fade like $1/r$, and the field is simply their sum. Extra attractors add too: $F = Σ_j w_j·F_j$.',
    },
    {
      title: 'Logarithmic spirals',
      body:
        'For one fixed attractor, the inward and sideways speeds keep the same ratio at every radius. Each path crosses every circle at one fixed angle ' +
        '$α = arctan(g/|s|)$ — right now {pitch} — and winds as $r = r_0·e^{−(g/s)θ}$, the spiral of shells, storms and galaxies.',
    },
    {
      title: 'Euler vs RK4',
      body:
        'The computer cannot solve $dp/dt = F(p)$ exactly, so it takes small steps $h$. Euler’s method, $p + h·F(p)$, samples the field once and drifts off every circle. ' +
        'RK4 samples it four times — at the start, twice at the midpoint, at the end — and blends $(k_1 + 2k_2 + 2k_3 + k_4)/6$: the error per step shrinks like $h^5$ instead of $h^2$.',
    },
    {
      title: 'Softening',
      body:
        'At $Δ = 0$ the formula would divide by zero. Adding $ε$ keeps $F$ finite: the swirl is fastest at radius $√ε$ = {core}, ' +
        'and the speed limit $V_{max}$ keeps the core stable.',
    },
  ],
  variables: [
    { symbol: 'F', name: 'Velocity field', meaning: 'The arrow at each point; particles obey $dp/dt = F(p)$.', value: 'F' },
    { symbol: 'a', name: 'Attractor', meaning: 'Its position; it follows your cursor with critically damped smoothing.', value: 'a' },
    { symbol: 'Δ', name: 'Offset', meaning: '$Δ = p − a$, from the attractor to the particle.', note: 'per particle' },
    { symbol: 's', name: 'Swirl', meaning: 'Strength of the vortex term; its sign sets the direction.', value: 's' },
    { symbol: 'g', name: 'Attraction', meaning: 'Strength of the sink term.', value: 'g' },
    { symbol: 'ε', name: 'Softening', meaning: 'Keeps $F$ finite at $Δ = 0$; sets the core radius $√ε$.', value: 'eps' },
    { symbol: 'g/s', name: 'Spiral rate', meaning: 'How fast $r$ shrinks per radian: $r = r_0·e^{−(g/s)θ}$.', value: 'ratio' },
    { symbol: 'α', name: 'Pitch angle', meaning: 'The fixed angle between every path and every circle.', value: 'pitch' },
    { symbol: 'V_{max}', name: 'Speed limit', meaning: '$|F|$ is capped here so the core stays stable.', value: 'vmax' },
    { symbol: 'N', name: 'Particles', meaning: 'Glyphs riding the field.', value: 'N' },
  ],
  effects: [
    {
      param: 'strength',
      symbol: 'g',
      cause: 'Raise $g$',
      effect: 'a stronger inward pull: spirals tighten into a fast inflow; at $g = 0$ only circular orbits remain.',
    },
    {
      param: 'swirl',
      symbol: 's',
      cause: 'Raise $|s|$',
      effect: 'more sideways push: paths wind more turns before arriving; negative $s$ spins clockwise, $s = 0$ falls straight in.',
    },
    {
      param: 'count',
      symbol: 'N',
      cause: 'Raise $N$',
      effect: 'more glyph-particles sample the same field: denser, smoother streams (and more computation).',
    },
    {
      param: 'softening',
      symbol: 'ε',
      cause: 'Raise $ε$',
      effect: 'the core widens to about $√ε$: the eye of the storm calms and the brightest ring spreads out.',
    },
    {
      param: 'trails',
      symbol: '',
      cause: 'Turn trails on',
      effect: 'each particle leaves a fading wake that draws the stream lines of $F$.',
    },
    {
      param: 'field',
      symbol: 'F',
      cause: 'Show the field',
      effect: 'a faint arrow-glyph on a lattice shows $F$ itself, even where no particle is.',
    },
  ],
  pipeline: [
    {
      step: 'INTEGRATE',
      math: String.raw`p(t + h) = p(t) + \frac{h}{6}·(k_1 + 2k_2 + 2k_3 + k_4)`,
      note: 'One RK4 step moves each particle along $F$, sampling the field four times.',
    },
    { step: 'MEASURE', math: '|F(p)|', note: 'The speed sets the brightness, capped at $V_{max}$ = {vmax}.' },
    {
      step: 'CHOOSE',
      math: 'atan2(F_y, F_x)',
      note: 'The direction falls in one of 8 sectors of 45°; opposite directions share a stroke. Trails fade in a separate buffer drawn with the soft ramp below.',
      glyphs: '-/|\\',
    },
  ],
  ramp: 'soft',
  intensitySymbol: 'I',
  realWorld:
    'Hurricanes and bathtub drains are a vortex plus a sink, just like this field — and spiral galaxies wear the same logarithmic spiral in their arms.',
  realWorldMore:
    'Weather maps draw wind as exactly this kind of vector field, and game engines move their particles through it with the same RK4 step.',
};

/* ─── 03 · TOPOLOGY ──────────────────────────────────────────────────────── */

const topology: Explanation<'topology'> = {
  id: 'topology',
  symbol: 'r(u, v)',
  topics: ['PARAMETRIC SURFACES', 'ORIENTABILITY', 'TORUS KNOTS'],
  general: ['x(u, v) = (R + v·cos(nu/2))·cos u', 'y(u, v) = (R + v·cos(nu/2))·sin u', 'z(u, v) = v·sin(nu/2)'],
  where:
    'For $u ∈ [0, 2π)$ around the loop and $v ∈ [−w, w]$ across it, with main radius $R$ = {R} and a whole number of half-twists $n$ from 0 to 7.',
  reading:
    'Sweep a short segment once around a circle while it slowly turns: after one lap it has made n half-turns, and that number decides how many sides and edges the surface has.',
  ideas: [
    {
      title: 'A parametric surface',
      body: 'Two numbers make one point in space: $u$ runs around the loop, $v$ across the strip. Let both sweep their ranges and $r(u, v)$ paints a whole surface.',
    },
    {
      title: 'The half-twist',
      body:
        'At angle $u$ the cross-section is tilted by $nu/2$. After one lap ($u = 2π$) it has turned through $nπ$ — right now {turn}. ' +
        'Even $n$ brings it back as it started; odd $n$ brings it back upside down, so the point $(2π, v)$ lands on $(0, −v)$.',
    },
    {
      title: 'One side, one edge',
      body:
        'On an odd-$n$ band a brush that never lifts paints front and back in one stroke: one side, one edge — non-orientable. Even $n$ gives two of each. ' +
        'Both have Euler characteristic $χ = V − E + F = 0$, so orientability, not $χ$, tells them apart.',
    },
    {
      title: 'The edge is a knot',
      body:
        'Follow the boundary: it circles the loop twice while winding $n$ times around the core — the torus knot $T(2, n)$. ' +
        'Odd $n$ gives one knotted curve, even $n$ two circles linked $n/2$ times. Right now: {edge}.',
    },
  ],
  variables: [
    { symbol: 'u', name: 'Around the loop', meaning: 'Angle along the centre circle.', value: 'u' },
    { symbol: 'v', name: 'Across the strip', meaning: 'Signed distance from the centre line.', value: 'v' },
    { symbol: 'R', name: 'Main radius', meaning: 'Radius of the centre circle.', value: 'R' },
    { symbol: 'w', name: 'Half-width', meaning: '$v$ runs from $−w$ to $w$.', value: 'w' },
    { symbol: 'n', name: 'Half-twists', meaning: 'Half-turns the cross-section makes in one lap.', value: 'n' },
    { symbol: 'nu/2', name: 'Twist angle', meaning: 'Tilt of the cross-section at $u$; one lap adds $nπ$.', value: 'turn' },
    { symbol: 'χ', name: 'Euler characteristic', meaning: '$V − E + F$ for any mesh of the band.', value: 'chi' },
    { symbol: 'T(2, n)', name: 'Edge curve', meaning: 'The knot or link traced by the boundary.', value: 'edge' },
  ],
  effects: [
    {
      param: 'twists',
      symbol: 'n',
      cause: 'Change $n$',
      effect: 'odd $n$: one side and one edge (a Möbius band); even $n$: two of each. The edge becomes the knot $T(2, n)$.',
    },
    { param: 'width', symbol: 'w', cause: 'Raise $w$', effect: 'a wider ribbon — the shape changes, the topology never does.' },
    {
      param: 'density',
      symbol: '',
      cause: 'Raise the density',
      effect: 'smaller glyphs and more cells: a finer image of the same surface (and more computation).',
    },
    { param: 'spin', symbol: 'ω', cause: 'Raise $ω$', effect: 'faster automatic turning, in radians per second.' },
    { param: 'autorotate', symbol: '', cause: 'Stop auto-rotate', effect: 'the band holds still — drag to turn it yourself.' },
    {
      param: 'edges',
      symbol: '',
      cause: 'Highlight the edges',
      effect: 'the boundary lights up: odd $n$ shows one colour (one edge), even $n$ shows two.',
    },
    {
      param: 'sides',
      symbol: '',
      cause: 'Paint the sides',
      effect: 'front in ink, back in ice. On a Möbius band the colours swap at the seam: there is no back.',
    },
  ],
  pipeline: [
    { step: 'SAMPLE', math: 'r(u, v),   N = r_u × r_v', note: 'Points and normals, recomputed only when $n$ or $w$ change.' },
    { step: 'PROJECT', math: '', note: 'Rotate, apply perspective, and keep the nearest point in each cell (a z-buffer).' },
    { step: 'SHADE', math: 'N·L', note: 'Lambert lighting plus a soft highlight, ambient light and depth fog.' },
    { step: 'CHOOSE', math: 'glyph = ramp(I)', note: 'The brighter the light, the denser the glyph on the shade ramp.' },
  ],
  ramp: 'shade',
  intensitySymbol: 'I',
  realWorld: 'Möbius conveyor belts wear evenly on their single side, so they last about twice as long.',
  realWorldMore: 'The recycling symbol is drawn as a Möbius loop, and a Möbius resistor cancels its own magnetic field.',
};

export const EXPLANATIONS: { readonly [M in ExperimentId]: Explanation<M> } = { waves, attractor, topology };

/* ─── Shared copy ────────────────────────────────────────────────────────── */

/** The ASCII pipeline every experiment shares. {cells} = live grid size. */
export const ASCII_PIPELINE =
  'Every frame, each of the {cells} cells runs the same pipeline: evaluate the equation at the cell’s point, ' +
  'squeeze the number into an intensity between 0 and 1, then print the character whose measured ink coverage is closest to it. ' +
  'Nothing is pre-drawn — the picture is the equation, sampled again 60 times a second.';

/** Why the ramp is calibrated by measurement. */
export const COVERAGE_NOTE =
  'A $#$ covers far more of its cell than a $.$, so it reads brighter. Instead of trusting a hand-made order, the engine rasterises every candidate ' +
  'character, counts its lit pixels and sorts by that measurement — so the ink in each cell is proportional to the number it stands for.';

/** The central idea of the whole exhibit (drawer footer). */
export const CENTRAL_IDEA = [
  'Every character is a pixel.',
  'Every motion is an equation.',
  'Every design is a mathematical system.',
] as const;
