import { AdaptiveQuality } from './AdaptiveQuality';
import { createAsciiRenderer } from './AsciiRenderer';
import { GlyphBuffer } from './GlyphField';
import { PointerTracker } from './Pointer';
import { GlyphTransition } from './Transition';
import type { TransitionStyle } from './Transition';
import { GLYPH_FONT_WEIGHT, RAMPS } from './types';
import type {
  AsciiRendererAPI,
  EngineAPI,
  EngineOptions,
  EngineStats,
  Experiment,
  ExperimentFactory,
  ExperimentId,
  FrameContext,
  GlyphRamp,
  ParamValues,
  ProbeReadout,
  RendererMetrics,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════════
 *  GLYPHFIELD · ENGINE
 *
 *  One requestAnimationFrame loop turns an experiment's mathematics into a
 *  field of characters, about 60 times a second:
 *
 *      pointer snapshot → experiment.update(ctx) → field.clear()
 *        → experiment.render(field, ctx) → transition.apply(field)
 *        → renderer.draw(field)
 *
 *  Around that loop the engine owns: the glyph grid (sized from the stage and
 *  the font), adaptive quality, the glyph-scramble transitions between
 *  experiments, pointer input, tab-visibility handling and the bridge back to
 *  React (stats ≈ 4×/s, probe ≈ 8×/s). React never re-renders per frame, and
 *  the loop allocates nothing per frame.
 *
 *  Time
 *    realDt = wall-clock seconds since the last frame (clamped to 0.25 s)
 *    dt     = paused ? 0 : min(realDt, 1/20) × timeScale   (0.4 with reduced motion)
 *    time  += dt — so pausing freezes every equation exactly where it is.
 *
 *  Grid
 *    font = clamp(11, 0.0082·width, 15) × cellScale ÷ quality   (CSS px)
 *    cols = ⌊width / cellW⌋, rows = ⌊height / cellH⌋, centred on the stage.
 * ═══════════════════════════════════════════════════════════════════════════ */

const GLYPH_FAMILY = 'JetBrains Mono';
/** The face the atlas needs: `500 16px "JetBrains Mono"`. */
const FONT_PROBE = `${GLYPH_FONT_WEIGHT} 16px "${GLYPH_FAMILY}"`;
const FONT_TIMEOUT_MS = 2000;

const MAX_DPR = 2;
const BASE_FONT_MIN = 11;
const BASE_FONT_MAX = 15;
const BASE_FONT_PER_PX = 0.0082;
/** Font sizes snap to 1/8 CSS px so tiny changes never re-rasterise the atlas. */
const FONT_STEPS_PER_PX = 8;
/** cellScale must move by more than 0.5 % before the grid follows it. */
const CELL_SCALE_TOLERANCE = 0.005;
/** Rebuilds caused by resizes and quality steps settle 100 ms after the last change. */
const REBUILD_DEBOUNCE_MS = 100;
/** cellScale rebuilds (density slider drags) happen at most 8× per second. */
const REBUILD_MIN_GAP_MS = 125;
/** Resize events closer together than this are one "burst" (a window being dragged). */
const RESIZE_BURST_MS = 250;

const MAX_REAL_DT = 0.25;
const MAX_SIM_DT = 1 / 20;
const REDUCED_TIME_SCALE = 0.4;
/** A hitch (atlas rebuild, GC) may advance a transition by at most this much. */
const MAX_TRANSITION_STEP = 0.1;
const STATS_INTERVAL = 0.25;
const PROBE_INTERVAL = 0.125;
const GLOW_STRENGTH = 0.9;
const GLOW_MIN_QUALITY = 0.75;

/** Base glyph size in CSS px from the stage width: clamp(11, 0.0082·w, 15) → ≈ 150–230 columns. */
export function baseFontSize(stageWidth: number): number {
  return Math.min(BASE_FONT_MAX, Math.max(BASE_FONT_MIN, BASE_FONT_PER_PX * stageWidth));
}

function readDpr(): number {
  const ratio = window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? Math.min(MAX_DPR, ratio) : 1;
}

/** Does a CSS font-weight descriptor ("500", "100 900", "normal") include `weight`? */
function weightIncludes(descriptor: string, weight: number): boolean {
  const text = descriptor === 'normal' ? '400' : descriptor === 'bold' ? '700' : descriptor;
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return false;
  const lo = parts[0];
  const hi = parts.length > 1 ? parts[1] : lo;
  return weight >= lo && weight <= hi;
}

/** Is the glyph face (JetBrains Mono 500) loaded and ready to rasterise? */
function glyphFontLoaded(): boolean {
  let loaded = false;
  document.fonts.forEach((face) => {
    if (loaded || face.status !== 'loaded') return;
    if (face.family.replace(/["']/g, '').trim() !== GLYPH_FAMILY) return;
    loaded = weightIncludes(face.weight, GLYPH_FONT_WEIGHT);
  });
  return loaded;
}

const noop = (): void => {};

/** Stands in for an experiment whose factory threw, so the loop keeps running. */
function inertExperiment(id: ExperimentId): Experiment {
  return { id, resize: noop, setParams: noop, update: noop, render: noop, reset: noop };
}

/** Returned when no renderer could be created at all: a safe, silent API. */
const INERT_ENGINE: EngineAPI = {
  setMode: noop,
  setParams: noop,
  setPaused: noop,
  setAdaptive: noop,
  setReducedMotion: noop,
  resetSimulation: noop,
  destroy: noop,
};

/**
 * Create the engine. Returns synchronously; fonts load in the background and
 * the field fades in out of darkness once they are ready (≤ ~2 s).
 */
export function createEngine(options: EngineOptions): EngineAPI {
  let renderer: AsciiRendererAPI;
  try {
    renderer = createAsciiRenderer(options.canvas, options.glowCanvas ?? null);
  } catch (error) {
    console.error('GLYPHFIELD: the ASCII renderer could not start.', error);
    return INERT_ENGINE;
  }
  return new GlyphEngine(options, renderer);
}

class GlyphEngine implements EngineAPI {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: AsciiRendererAPI;
  private readonly factories: Record<ExperimentId, ExperimentFactory>;
  private readonly onStats: ((stats: EngineStats) => void) | undefined;
  private readonly onProbe: ((probe: ProbeReadout | null) => void) | undefined;

  /* experiments */
  private readonly params: Record<ExperimentId, Readonly<ParamValues>>;
  private readonly instances = new Map<ExperimentId, Experiment>();
  /** params changed while the instance was inactive — delivered on activation */
  private readonly staleParams = new Set<ExperimentId>();
  /** reset requested for an experiment that is not on stage yet */
  private readonly pendingReset = new Set<ExperimentId>();
  /** grid version each instance was last resized for */
  private readonly gridSeen = new Map<ExperimentId, number>();
  /** "source.call" keys already logged — every fault is reported once */
  private readonly faults = new Set<string>();
  private activeId: ExperimentId;
  private targetId: ExperimentId;
  private active: Experiment | null = null;

  /* subsystems */
  private readonly aq: AdaptiveQuality;
  private readonly pointer: PointerTracker;
  private readonly transition = new GlyphTransition();
  /** THE frame context — one object, refilled every frame */
  private readonly ctx: FrameContext;
  private field = new GlyphBuffer(0, 0);

  /* lifecycle */
  private destroyed = false;
  /** fonts awaited, first grid built, loop running */
  private initialized = false;
  /** first frame drawn */
  private ready = false;
  private paused: boolean;
  private reducedMotion: boolean;

  /* stage & grid */
  private stageW = 0;
  private stageH = 0;
  private dpr = 1;
  private metrics: RendererMetrics | null = null;
  private fontSize = 0;
  private fontDpr = 0;
  /** the atlas was built before the real font arrived */
  private fontStale = false;
  private surfaceW = -1;
  private surfaceH = -1;
  private surfaceDpr = -1;
  private gridScale = 1;
  private gridVersion = 0;
  /** performance.now() at which a pending rebuild runs (Infinity = none) */
  private rebuildDueAt = Infinity;
  private lastRebuildAt = -Infinity;
  private lastConfigureAt = -Infinity;
  private glow = -1;

  /* loop */
  private rafId = 0;
  private lastTime = -1;
  private simTime = 0;
  private frameCount = 0;
  private workMs = 0;
  private glyphCount = 0;
  private statsClock = 0;
  private probeClock = 0;
  private probeWasNull = false;

  /* platform hooks */
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;
  private cancelFontWait: (() => void) | null = null;
  private watchingFonts = false;

  constructor(options: EngineOptions, renderer: AsciiRendererAPI) {
    this.canvas = options.canvas;
    this.renderer = renderer;
    this.factories = options.factories;
    this.onStats = options.onStats;
    this.onProbe = options.onProbe;
    this.params = { ...options.params };
    this.activeId = options.mode;
    this.targetId = options.mode;
    this.paused = options.paused ?? false;
    this.reducedMotion = options.reducedMotion ?? false;
    this.aq = new AdaptiveQuality(options.adaptive ?? true);
    this.pointer = new PointerTracker(options.canvas);
    this.ctx = {
      cols: 0,
      rows: 0,
      cellW: 0,
      cellH: 0,
      width: 0,
      height: 0,
      originX: 0,
      originY: 0,
      time: 0,
      dt: 0,
      realDt: 0,
      paused: this.paused,
      reducedMotion: this.reducedMotion,
      pointer: this.pointer.state.snap,
      ramp: (candidates: string = RAMPS.classic): GlyphRamp => this.renderer.ramp(candidates),
      frame: 0,
    };
    this.dpr = readDpr();
    this.observeStage();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.init().catch((error: unknown) => this.fault('engine', 'init', error));
  }

  /* ─── Public API ─────────────────────────────────────────────────────── */

  setMode(id: ExperimentId): void {
    if (this.destroyed || !(id in this.factories)) return;
    this.targetId = id;
    if (!this.initialized) {
      // Nothing is visible yet: the first-load reveal will simply show `id`.
      this.activeId = id;
      return;
    }
    const tr = this.transition;
    if (tr.phase === 'idle') {
      if (id !== this.activeId) {
        tr.startOut(this.transitionStyle());
        this.aq.hold();
      }
    } else if (tr.phase === 'in') {
      // Mid-decode: run the reveal backwards from where it is, then go to `id`.
      if (id !== this.activeId) tr.rewind();
    } else if (id === this.activeId) {
      // Changed back mid-rewind: decode forward again. (A plain dissolve just
      // finishes and re-reveals the same experiment.)
      tr.resume();
    }
  }

  setParams(id: ExperimentId, values: Readonly<ParamValues>): void {
    if (this.destroyed) return;
    this.params[id] = values;
    const exp = this.instances.get(id);
    if (!exp) return; // created later with these values
    if (exp === this.active) {
      try {
        exp.setParams(values);
      } catch (error) {
        this.fault(id, 'setParams', error);
      }
    } else {
      this.staleParams.add(id); // inactive experiments get no calls
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setAdaptive(enabled: boolean): void {
    if (this.destroyed) return;
    if (this.aq.setEnabled(enabled) && this.initialized) this.scheduleRebuild(REBUILD_DEBOUNCE_MS);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  resetSimulation(): void {
    if (this.destroyed) return;
    const exp = this.active;
    if (exp !== null && this.targetId === this.activeId) {
      try {
        exp.reset();
      } catch (error) {
        this.fault(exp.id, 'reset', error);
      }
    } else {
      this.pendingReset.add(this.targetId);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.cancelFontWait?.();
    this.cancelFontWait = null;
    this.unwatchFonts();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.onStageResize);
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.pointer.destroy();
    this.transition.cancel();
    for (const exp of this.instances.values()) {
      try {
        exp.dispose?.();
      } catch (error) {
        this.fault(exp.id, 'dispose', error);
      }
    }
    this.instances.clear();
    this.active = null;
    try {
      this.renderer.destroy();
    } catch (error) {
      this.fault('renderer', 'destroy', error);
    }
  }

  /* ─── Startup ────────────────────────────────────────────────────────── */

  private async init(): Promise<void> {
    const fontsLoaded = await this.waitForFonts();
    if (this.destroyed) return; // destroyed while fonts loaded (React StrictMode) — abort cleanly
    if (!fontsLoaded) this.watchLateFonts();
    this.measureStage();
    this.pointer.snapshot(0); // drop input gathered while loading
    this.activate(this.targetId);
    this.initialized = true;
    this.transition.startIn(this.transitionStyle(), true); // out of darkness
    this.aq.hold(1.5);
    this.lastTime = -1;
    this.requestFrame();
  }

  /** Wait (≤ 2 s) for the glyph font. Resolves true when the real face is ready. */
  private async waitForFonts(): Promise<boolean> {
    const fonts = document.fonts;
    if (!fonts || typeof fonts.load !== 'function') return true; // no Font Loading API: nothing to wait for
    const timeout = new Promise<null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), FONT_TIMEOUT_MS);
      this.cancelFontWait = () => {
        window.clearTimeout(timer);
        resolve(null);
      };
    });
    try {
      const faces = await Promise.race([fonts.load(FONT_PROBE), timeout]);
      return (faces !== null && faces.length > 0) || glyphFontLoaded();
    } catch {
      return false;
    } finally {
      this.cancelFontWait?.();
      this.cancelFontWait = null;
    }
  }

  /** The font missed the deadline: rebuild the atlas once more when it arrives. */
  private watchLateFonts(): void {
    const fonts = document.fonts;
    if (!fonts || typeof fonts.addEventListener !== 'function') return;
    fonts.addEventListener('loadingdone', this.onFontsLoaded);
    this.watchingFonts = true;
  }

  private unwatchFonts(): void {
    if (!this.watchingFonts) return;
    this.watchingFonts = false;
    document.fonts.removeEventListener('loadingdone', this.onFontsLoaded);
  }

  private readonly onFontsLoaded = (): void => {
    if (this.destroyed || !glyphFontLoaded()) return;
    this.unwatchFonts();
    this.fontStale = true; // re-measure and re-rasterise with the real face
    this.rebuildDueAt = performance.now();
  };

  /* ─── Stage observation ──────────────────────────────────────────────── */

  private observeStage(): void {
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(this.onStageResize);
      this.resizeObserver.observe(this.canvas);
    } else {
      window.addEventListener('resize', this.onStageResize);
    }
    this.watchDpr();
  }

  /**
   * `(resolution: Xdppx)` matches only the current ratio, so it fires once when
   * the ratio changes (browser zoom, window dragged to a projector) — re-arm it.
   */
  private watchDpr(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    if (typeof window.matchMedia !== 'function') return;
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private readonly onDprChange = (): void => {
    if (this.destroyed) return;
    this.watchDpr();
    this.onStageResize();
  };

  /** Read the stage's CSS size and the device-pixel ratio. Returns true if either changed. */
  private measureStage(): boolean {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.setOrigin(rect.left, rect.top);
    const dpr = readDpr();
    const changed = rect.width !== this.stageW || rect.height !== this.stageH || dpr !== this.dpr;
    this.stageW = rect.width;
    this.stageH = rect.height;
    this.dpr = dpr;
    return changed;
  }

  private readonly onStageResize = (): void => {
    if (this.destroyed || !this.measureStage() || !this.initialized) return;
    // A lone resize (fullscreen, projector hand-off) rebuilds completely, now.
    // Inside a burst (window drag) only the layout follows each event — always
    // crisp, never stretched — and the font size settles 100 ms after the burst.
    const leading = performance.now() - this.lastConfigureAt >= RESIZE_BURST_MS;
    this.rebuildGrid(leading);
    if (!leading) this.scheduleRebuild(REBUILD_DEBOUNCE_MS);
    // ResizeObserver runs after layout and before paint: drawing right here means
    // the resized canvas never shows a blank or stretched frame.
    if (!document.hidden) this.step(0);
  };

  private readonly onVisibility = (): void => {
    if (this.destroyed) return;
    if (document.hidden) {
      if (this.rafId !== 0) cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      this.pointer.releaseAll();
    } else {
      this.lastTime = -1; // the first frame back uses a nominal dt — no time jump
      this.aq.hold();
      this.requestFrame();
    }
  };

  /* ─── Grid ───────────────────────────────────────────────────────────── */

  private scheduleRebuild(delayMs: number): void {
    this.rebuildDueAt = performance.now() + delayMs; // debounce: each request pushes it back
  }

  /** The active experiment's preferred cell-size multiplier, sanitised. */
  private readCellScale(): number {
    const exp = this.active;
    if (exp === null || typeof exp.cellScale !== 'function') return 1;
    let scale = 1;
    try {
      scale = exp.cellScale();
    } catch (error) {
      this.fault(exp.id, 'cellScale', error);
    }
    return Number.isFinite(scale) && scale > 0 ? Math.min(4, Math.max(0.25, scale)) : 1;
  }

  /** Follow cellScale changes (e.g. the TOPOLOGY density slider) at most 8× per second. */
  private followCellScale(now: number): void {
    const scale = this.readCellScale();
    if (Math.abs(scale - this.gridScale) <= CELL_SCALE_TOLERANCE * this.gridScale) return;
    const due = this.lastRebuildAt + REBUILD_MIN_GAP_MS;
    if (now >= due) this.rebuildGrid(true);
    else if (due < this.rebuildDueAt) this.rebuildDueAt = due;
  }

  /**
   * Fit the glyph grid to the stage. `full` may re-rasterise the atlas when
   * the font size should change; otherwise only the layout follows the stage.
   * Returns true when the grid changed (the active experiment has been resized).
   */
  private rebuildGrid(full: boolean): boolean {
    const ctx = this.ctx;
    const width = this.stageW;
    const height = this.stageH;
    const dpr = this.dpr;
    const scale = this.readCellScale();
    const font =
      Math.round(((baseFontSize(width) * scale) / this.aq.quality) * FONT_STEPS_PER_PX) / FONT_STEPS_PER_PX;
    const now = performance.now();
    this.lastRebuildAt = now;
    this.gridScale = scale;
    let changed = false;

    if (this.metrics === null || this.fontStale || dpr !== this.fontDpr || (full && font !== this.fontSize)) {
      try {
        this.metrics = this.renderer.configure(font, dpr);
        this.fontSize = font;
        this.fontDpr = dpr;
        this.fontStale = false;
        changed = true;
      } catch (error) {
        this.fault('renderer', 'configure', error);
      }
      this.lastConfigureAt = now;
    } else if (font !== this.fontSize) {
      this.scheduleRebuild(REBUILD_DEBOUNCE_MS); // settle the font once the burst is over
    }
    const metrics = this.metrics;
    if (metrics === null) return false;

    if (width !== this.surfaceW || height !== this.surfaceH || dpr !== this.surfaceDpr) {
      try {
        this.renderer.resize(width, height, dpr);
      } catch (error) {
        this.fault('renderer', 'resize', error);
      }
      this.surfaceW = width;
      this.surfaceH = height;
      this.surfaceDpr = dpr;
      changed = true;
    }
    this.applyGlow();

    const cellW = metrics.cellW;
    const cellH = metrics.cellH;
    // (+1e-6 so that an exact fit is not lost to floating-point dust)
    const cols = cellW > 0 ? Math.max(0, Math.floor(width / cellW + 1e-6)) : 0;
    const rows = cellH > 0 ? Math.max(0, Math.floor(height / cellH + 1e-6)) : 0;
    // Centre the grid, snapped to whole device pixels so every glyph lands crisply.
    const originX = Math.round(((width - cols * cellW) / 2) * dpr) / dpr;
    const originY = Math.round(((height - rows * cellH) / 2) * dpr) / dpr;

    if (
      !changed &&
      cols === ctx.cols &&
      rows === ctx.rows &&
      cellW === ctx.cellW &&
      cellH === ctx.cellH &&
      originX === ctx.originX &&
      originY === ctx.originY
    ) {
      return false;
    }

    if (cols !== this.field.cols || rows !== this.field.rows) this.field = new GlyphBuffer(cols, rows);
    ctx.cols = cols;
    ctx.rows = rows;
    ctx.cellW = cellW;
    ctx.cellH = cellH;
    ctx.width = width;
    ctx.height = height;
    ctx.originX = originX;
    ctx.originY = originY;
    this.pointer.setGeometry(ctx);
    this.gridVersion++;
    this.resizeActive();
    this.aq.hold(); // the rebuild itself is a hitch, not a frame rate
    return true;
  }

  private resizeActive(): void {
    const exp = this.active;
    if (exp === null || this.ctx.cols < 1 || this.ctx.rows < 1) return;
    try {
      exp.resize(this.ctx);
    } catch (error) {
      this.fault(exp.id, 'resize', error);
    }
    this.gridSeen.set(exp.id, this.gridVersion);
  }

  /** The phosphor glow costs fill-rate: switch it off below quality 0.75. */
  private applyGlow(): void {
    const glow = this.aq.quality < GLOW_MIN_QUALITY ? 0 : GLOW_STRENGTH;
    if (glow === this.glow) return;
    this.glow = glow;
    try {
      this.renderer.setGlow(glow);
    } catch (error) {
      this.fault('renderer', 'setGlow', error);
    }
  }

  /* ─── Experiments ────────────────────────────────────────────────────── */

  /** The instance for `id`, created on first use: factory() → setParams(all). */
  private instance(id: ExperimentId): Experiment {
    const existing = this.instances.get(id);
    if (existing) return existing;
    let exp: Experiment;
    try {
      exp = this.factories[id]();
    } catch (error) {
      this.fault(id, 'create', error);
      exp = inertExperiment(id);
    }
    try {
      exp.setParams(this.params[id]);
    } catch (error) {
      this.fault(id, 'setParams', error);
    }
    this.staleParams.delete(id);
    this.instances.set(id, exp);
    return exp;
  }

  /** Put `id` on stage: bring its params up to date, fit the grid to it, resize it. */
  private activate(id: ExperimentId): void {
    const exp = this.instance(id);
    if (this.staleParams.delete(id)) {
      try {
        exp.setParams(this.params[id]);
      } catch (error) {
        this.fault(id, 'setParams', error);
      }
    }
    this.activeId = id;
    this.active = exp;
    // The newcomer may prefer another cell size (cellScale) — rebuild if so.
    this.rebuildGrid(true);
    if (this.gridSeen.get(id) !== this.gridVersion) this.resizeActive();
    if (this.pendingReset.delete(id)) {
      try {
        exp.reset();
      } catch (error) {
        this.fault(id, 'reset', error);
      }
    }
  }

  private transitionStyle(): TransitionStyle {
    return this.reducedMotion ? 'fade' : 'scramble';
  }

  /** Report a failure once and keep going — one broken call must never stop the installation. */
  private fault(source: string, call: string, error: unknown): void {
    const key = `${source}.${call}`;
    if (this.faults.has(key)) return;
    this.faults.add(key);
    console.error(`GLYPHFIELD: ${key} failed; the engine keeps running.`, error);
  }

  /* ─── The loop ───────────────────────────────────────────────────────── */

  private requestFrame(): void {
    if (this.rafId !== 0 || this.destroyed || !this.initialized || document.hidden) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.rafId = 0;
    if (this.destroyed) return;
    this.requestFrame(); // schedule first: nothing below can ever stop the loop

    const realDt = this.lastTime < 0 ? 1 / 60 : Math.min(MAX_REAL_DT, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;

    if (this.aq.sample(realDt)) this.scheduleRebuild(REBUILD_DEBOUNCE_MS);
    if (now >= this.rebuildDueAt) {
      this.rebuildDueAt = Infinity;
      this.rebuildGrid(true);
    } else {
      this.followCellScale(now);
    }

    // Transitions run on wall-clock time, so they play even while paused.
    const tr = this.transition;
    if (tr.advance(Math.min(realDt, MAX_TRANSITION_STEP))) {
      this.activate(this.targetId); // end of OUT: switch (and re-fit the grid)
      tr.startIn(this.transitionStyle());
    }
    if (tr.active) this.aq.hold(); // judge performance 1 s after the effect, not during it

    this.step(realDt);
    this.publish(realDt);
  };

  /** One frame. `realDt` = 0 repaints the current state without advancing anything. */
  private step(realDt: number): void {
    const start = performance.now();
    const ctx = this.ctx;
    const dt = this.paused ? 0 : Math.min(realDt, MAX_SIM_DT) * (this.reducedMotion ? REDUCED_TIME_SCALE : 1);
    this.simTime += dt;
    ctx.time = this.simTime;
    ctx.dt = dt;
    ctx.realDt = realDt;
    ctx.paused = this.paused;
    ctx.reducedMotion = this.reducedMotion;
    ctx.frame = this.frameCount++;
    this.pointer.snapshot(realDt); // refills ctx.pointer in place

    const field = this.field;
    const exp = this.active;
    if (exp !== null && field.cols > 0 && field.rows > 0) {
      try {
        exp.update(ctx);
      } catch (error) {
        this.fault(exp.id, 'update', error);
      }
      field.clear();
      try {
        exp.render(field, ctx);
      } catch (error) {
        this.fault(exp.id, 'render', error);
      }
      if (this.transition.active) this.transition.apply(field, ctx.cellW, ctx.cellH);
    }
    try {
      this.glyphCount = this.renderer.draw(field, ctx.originX, ctx.originY);
    } catch (error) {
      this.fault('renderer', 'draw', error);
    }

    const work = performance.now() - start;
    this.workMs = this.workMs === 0 ? work : this.workMs + (work - this.workMs) * 0.08;
    if (!this.ready) {
      this.ready = true;
      this.emitStats(); // tell the UI at once — its entrance waits for this
    }
  }

  /** Engine → React, on timers: stats ≈ 4×/s, probe ≈ 8×/s. */
  private publish(realDt: number): void {
    this.statsClock += realDt;
    if (this.statsClock >= STATS_INTERVAL) {
      this.statsClock %= STATS_INTERVAL;
      this.emitStats();
    }
    this.probeClock += realDt;
    if (this.probeClock >= PROBE_INTERVAL) {
      this.probeClock %= PROBE_INTERVAL;
      this.emitProbe();
    }
  }

  private emitStats(): void {
    const onStats = this.onStats;
    if (!onStats) return;
    const ctx = this.ctx;
    const stats: EngineStats = {
      fps: Math.round(this.aq.fps * 10) / 10,
      frameMs: Math.round(this.workMs * 100) / 100,
      glyphs: this.glyphCount,
      cols: ctx.cols,
      rows: ctx.rows,
      cellW: ctx.cellW,
      cellH: ctx.cellH,
      quality: this.aq.quality,
      time: this.simTime,
      mode: this.activeId,
      paused: this.paused,
      transitioning: this.transition.active,
      ready: this.ready,
    };
    try {
      onStats(stats);
    } catch (error) {
      this.fault('onStats', 'callback', error);
    }
  }

  private emitProbe(): void {
    const onProbe = this.onProbe;
    if (!onProbe) return;
    const exp = this.active;
    let probe: ProbeReadout | null = null;
    // While the old field dissolves there is nothing meaningful to probe.
    if (exp !== null && typeof exp.probe === 'function' && this.transition.phase !== 'out' && this.field.cols > 0) {
      try {
        probe = exp.probe(this.ctx) ?? null;
      } catch (error) {
        this.fault(exp.id, 'probe', error);
      }
    }
    if (probe === null && this.probeWasNull) return; // don't repeat "nothing"
    this.probeWasNull = probe === null;
    try {
      onProbe(probe);
    } catch (error) {
      this.fault('onProbe', 'callback', error);
    }
  }
}
