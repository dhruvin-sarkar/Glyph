import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveQuality } from '../AdaptiveQuality';
import { baseFontSize, createEngine } from '../Engine';
import { GlyphBuffer } from '../GlyphField';
import { PointerState } from '../Pointer';
import { GlyphTransition, SCRAMBLE_CHARS, TRANSITION_DURATIONS, XorShift32, hash32 } from '../Transition';
import { Tone } from '../types';
import type {
  AsciiRendererAPI,
  EngineOptions,
  EngineStats,
  ExperimentFactory,
  ExperimentId,
  GlyphField,
  GlyphRamp,
  ParamValues,
  ProbeReadout,
  RendererMetrics,
} from '../types';

/* ═══════════════════════════════════════════════════════════════════════════
 *  engine-core tests: PointerState, AdaptiveQuality and GlyphTransition as pure
 *  logic, then the whole engine loop driven frame by frame against a fake
 *  renderer and fake browser globals (no DOM needed).
 * ═══════════════════════════════════════════════════════════════════════════ */

const FRAME = 1 / 60;

/* ─── PointerState ──────────────────────────────────────────────────────── */

describe('PointerState', () => {
  const geo = { originX: 4, originY: 2, cellW: 8, cellH: 16 };

  it('reports a short, still press as one click, then clears every per-frame flag', () => {
    const p = new PointerState();
    p.setGeometry(geo);
    p.enter(100, 50, false);
    p.press(100, 50, 1000, false);
    p.release(103, 52, 1120);
    const s = p.snapshot(FRAME);
    expect(s.pressed).toBe(true);
    expect(s.released).toBe(true);
    expect(s.down).toBe(false);
    expect(s.clicks).toHaveLength(1);
    expect(s.clicks[0]).toEqual({ x: 103, y: 52, col: (103 - 4) / 8, row: (52 - 2) / 16 });
    expect(s.dx).toBe(3);
    expect(s.dy).toBe(2);

    const clicks = s.clicks;
    const next = p.snapshot(FRAME);
    expect(next).toBe(s); // one reusable snapshot object…
    expect(next.clicks).toBe(clicks); // …and one reusable clicks array
    expect(next.clicks).toHaveLength(0);
    expect(next.pressed).toBe(false);
    expect(next.released).toBe(false);
    expect(next.dx).toBe(0);
    expect(next.dy).toBe(0);
    expect(next.wheel).toBe(0);
  });

  it('does not count a long press or a drag as a click', () => {
    const p = new PointerState();
    p.press(10, 10, 0, false);
    p.release(10, 10, 500); // too long
    expect(p.snapshot(FRAME).clicks).toHaveLength(0);

    p.press(10, 10, 1000, false);
    p.move(20, 10, false);
    expect(p.snapshot(FRAME).dragging).toBe(true); // moved > 4 px while held
    p.move(10, 10, false); // back to the start — but it travelled 10 px
    p.release(10, 10, 1100);
    const s = p.snapshot(FRAME);
    expect(s.clicks).toHaveLength(0);
    expect(s.dragging).toBe(false);
  });

  it('smooths velocity with a ~60 ms time constant', () => {
    const p = new PointerState();
    p.enter(0, 0, false);
    p.snapshot(FRAME);
    let x = 0;
    for (let i = 0; i < 30; i++) {
      x += 10;
      p.move(x, 0, false);
      p.snapshot(FRAME);
    }
    const moving = p.snapshot(FRAME); // this frame had no movement: one decay step
    expect(moving.vx).toBeGreaterThan(0.75 * 600);
    for (let i = 0; i < 30; i++) p.snapshot(FRAME);
    expect(p.snapshot(FRAME).speed).toBeLessThan(1);

    const q = new PointerState();
    q.enter(0, 0, false);
    q.snapshot(FRAME);
    for (let i = 1; i <= 30; i++) {
      q.move(i * 10, 0, false);
      const s = q.snapshot(FRAME);
      if (i === 30) {
        expect(s.vx).toBeCloseTo(600, 0); // 10 px per 1/60 s
        expect(s.speed).toBeCloseTo(600, 0);
      }
    }
  });

  it('counts idle time from the last stage activity', () => {
    const p = new PointerState();
    expect(p.snapshot(FRAME).idleTime).toBe(Infinity);
    p.move(5, 5, false);
    expect(p.snapshot(FRAME).idleTime).toBe(0);
    for (let i = 0; i < 30; i++) p.snapshot(FRAME);
    expect(p.snapshot(FRAME).idleTime).toBeCloseTo(31 * FRAME, 6);
    p.wheel(120);
    const s = p.snapshot(FRAME);
    expect(s.idleTime).toBe(0);
    expect(s.wheel).toBe(120);
  });

  it('keeps a captured drag inside while it crosses UI chrome', () => {
    const p = new PointerState();
    p.enter(10, 10, false);
    expect(p.snapshot(FRAME).inside).toBe(true);
    p.press(10, 10, 0, false);
    p.setCaptured(true);
    p.setOver(false); // now over a UI panel
    expect(p.snapshot(FRAME).inside).toBe(true);
    p.release(300, 10, 200);
    expect(p.snapshot(FRAME).inside).toBe(false);
  });

  it('treats a touch landing elsewhere as a jump, not a movement', () => {
    const p = new PointerState();
    p.move(50, 50, false);
    p.snapshot(FRAME);
    p.press(200, 100, 0, true);
    const s = p.snapshot(FRAME);
    expect(s.dx).toBe(0);
    expect(s.dy).toBe(0);
    expect(s.x).toBe(200);
    expect(s.isTouch).toBe(true);
    expect(s.pressed).toBe(true);
  });

  it('releaseAll ends a held press without a click', () => {
    const p = new PointerState();
    p.press(10, 10, 0, false);
    p.releaseAll();
    const s = p.snapshot(FRAME);
    expect(s.down).toBe(false);
    expect(s.released).toBe(true);
    expect(s.clicks).toHaveLength(0);
    expect(s.inside).toBe(false);
  });
});

/* ─── AdaptiveQuality ───────────────────────────────────────────────────── */

/** Feed `seconds` of frames whose rate depends on the current quality. Returns the change times. */
function simulate(aq: AdaptiveQuality, seconds: number, fpsOf: (quality: number) => number): number[] {
  const changes: number[] = [];
  for (let t = 0; t < seconds; ) {
    const dt = 1 / fpsOf(aq.quality);
    t += dt;
    if (aq.sample(dt)) changes.push(t);
  }
  return changes;
}

describe('AdaptiveQuality', () => {
  it('stays at full quality at 60 fps', () => {
    const aq = new AdaptiveQuality();
    expect(simulate(aq, 60, () => 60)).toHaveLength(0);
    expect(aq.quality).toBe(1);
    expect(aq.fps).toBeCloseTo(60, 3);
  });

  it('steps down once when that restores a healthy frame rate, then holds still', () => {
    const aq = new AdaptiveQuality();
    const changes = simulate(aq, 60, (q) => (q > 0.95 ? 40 : 55)); // 55 fps sits in the dead band
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeGreaterThan(2); // 1 s grace + 1.5 s below 50 fps
    expect(changes[0]).toBeLessThan(3.5);
    expect(aq.quality).toBe(0.9);
  });

  it('undoes a down-step that did not help (display- or browser-capped frame rate)', () => {
    const aq = new AdaptiveQuality();
    const changes = simulate(aq, 300, () => 30); // capped at 30 fps whatever we do
    expect(changes).toHaveLength(4); // down, undo, (pause 60 s) down, undo — then never again
    expect(aq.quality).toBe(1);
  });

  it('backs off exponentially instead of oscillating', () => {
    const aq = new AdaptiveQuality();
    const upTimes: number[] = [];
    const downTimes: number[] = [];
    for (let t = 0; t < 300; ) {
      const before = aq.quality;
      const dt = 1 / (aq.quality > 0.95 ? 45 : 60); // full density is just too heavy
      t += dt;
      if (aq.sample(dt)) (aq.quality > before ? upTimes : downTimes).push(t);
    }
    expect(downTimes.length + upTimes.length).toBeLessThanOrEqual(8);
    // the calm period before each retry grows: 12 s, 36 s, 108 s…
    const waits = upTimes.map((up, i) => up - downTimes[i]);
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThan(2 * waits[i - 1]);
  });

  it('ignores samples during a hold and does nothing while disabled', () => {
    const held = new AdaptiveQuality();
    held.hold(10);
    expect(simulate(held, 5, () => 20)).toHaveLength(0);

    const off = new AdaptiveQuality(false);
    expect(simulate(off, 30, () => 20)).toHaveLength(0);
    expect(off.quality).toBe(1);
    expect(off.fps).toBeCloseTo(20, 1); // still measured

    const aq = new AdaptiveQuality();
    simulate(aq, 5, (q) => (q > 0.95 ? 40 : 55));
    expect(aq.quality).toBe(0.9);
    expect(aq.setEnabled(false)).toBe(true); // quality returned to 1
    expect(aq.quality).toBe(1);
    expect(aq.setEnabled(false)).toBe(false);
  });
});

/* ─── GlyphTransition ───────────────────────────────────────────────────── */

const CELL_W = 8;
const CELL_H = 16;

function makeField(cols = 48, rows = 24): GlyphBuffer {
  const f = new GlyphBuffer(cols, rows);
  for (let i = 0; i < f.size; i++) {
    if (i % 7 === 3) continue; // some empty cells
    f.glyph[i] = 35;
    f.intensity[i] = 0.4 + (i % 5) * 0.12;
    f.tone[i] = Tone.INK;
  }
  return f;
}

function corners(f: GlyphBuffer): number[] {
  return [0, f.cols - 1, (f.rows - 1) * f.cols, f.rows * f.cols - 1];
}

describe('GlyphTransition', () => {
  it('reports the end of an OUT exactly once and then rests', () => {
    const tr = new GlyphTransition();
    tr.startOut('scramble');
    let done = 0;
    for (let i = 0; i < 60; i++) if (tr.advance(FRAME)) done++;
    expect(done).toBe(1);
    expect(tr.phase).toBe('idle');
    expect(tr.active).toBe(false);
  });

  it('dissolves from the centre outward into darkness', () => {
    const tr = new GlyphTransition();
    const ref = makeField();
    tr.startOut('scramble');
    tr.advance(0.002);
    const early = makeField();
    tr.apply(early, CELL_W, CELL_H);
    for (const i of corners(early)) {
      expect(early.glyph[i]).toBe(ref.glyph[i]); // the front has not reached the corners
      expect(early.intensity[i]).toBe(ref.intensity[i]);
    }
    tr.advance(TRANSITION_DURATIONS.out - 0.002 - 1e-4);
    const late = makeField();
    tr.apply(late, CELL_W, CELL_H);
    expect(Math.max(...late.intensity)).toBeLessThan(1e-3);
  });

  it('decodes out of darkness: a central MINT glimmer first, the exact field at the end', () => {
    const tr = new GlyphTransition();
    const ref = makeField();
    tr.startIn('scramble');
    tr.advance(1e-4);
    const start = makeField();
    tr.apply(start, CELL_W, CELL_H);
    for (const i of corners(start)) expect(start.intensity[i]).toBe(0);
    let lit = 0;
    for (let i = 0; i < start.size; i++) {
      if (start.intensity[i] === 0) continue;
      lit++;
      expect(SCRAMBLE_CHARS).toContain(String.fromCharCode(start.glyph[i]));
      expect([Tone.MINT, Tone.INK]).toContain(start.tone[i]);
    }
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(0.25 * start.size);

    tr.advance(TRANSITION_DURATIONS.in - 2e-4);
    const end = makeField();
    tr.apply(end, CELL_W, CELL_H);
    expect(Array.from(end.glyph)).toEqual(Array.from(ref.glyph));
    expect(Array.from(end.intensity)).toEqual(Array.from(ref.intensity));
    expect(Array.from(end.tone)).toEqual(Array.from(ref.tone));
    expect(tr.advance(1)).toBe(false); // an IN ending is not an OUT ending
    expect(tr.active).toBe(false);
  });

  it('retargets seamlessly: a rewind starts exactly where the decode was', () => {
    const tr = new GlyphTransition();
    tr.startIn('scramble');
    tr.advance(0.25);
    const before = makeField();
    tr.apply(before, CELL_W, CELL_H);
    expect(tr.rewind()).toBe(true);
    expect(tr.phase).toBe('out');
    expect(tr.isRewinding).toBe(true);
    const after = makeField();
    tr.apply(after, CELL_W, CELL_H);
    expect(Array.from(after.glyph)).toEqual(Array.from(before.glyph));
    expect(Array.from(after.intensity)).toEqual(Array.from(before.intensity));
    expect(Array.from(after.tone)).toEqual(Array.from(before.tone));

    tr.advance(0.05);
    const rewound = makeField();
    tr.apply(rewound, CELL_W, CELL_H);
    expect(tr.resume()).toBe(true);
    expect(tr.phase).toBe('in');
    const resumed = makeField();
    tr.apply(resumed, CELL_W, CELL_H);
    let glyphDiffs = 0;
    for (let i = 0; i < resumed.size; i++) {
      if (resumed.glyph[i] !== rewound.glyph[i]) glyphDiffs++;
      expect(resumed.intensity[i]).toBeCloseTo(rewound.intensity[i], 6);
    }
    expect(glyphDiffs).toBeLessThanOrEqual(1);
  });

  it('only fades intensity in reduced-motion style', () => {
    const tr = new GlyphTransition();
    const ref = makeField();
    tr.startOut('fade');
    tr.advance(TRANSITION_DURATIONS.fadeOut / 2);
    const f = makeField();
    tr.apply(f, CELL_W, CELL_H);
    expect(Array.from(f.glyph)).toEqual(Array.from(ref.glyph));
    for (let i = 0; i < f.size; i++) expect(f.intensity[i]).toBeCloseTo(ref.intensity[i] * 0.5, 6);
  });

  it('never gets stuck, whatever the sequence of requests', () => {
    const rng = new XorShift32(99);
    const tr = new GlyphTransition();
    for (let k = 0; k < 2000; k++) {
      const op = rng.nextU32() % 5;
      if (op === 0) tr.startOut('scramble');
      else if (op === 1) tr.startIn('scramble', rng.next() < 0.1);
      else if (op === 2) tr.rewind();
      else if (op === 3) tr.resume();
      if (tr.advance(rng.next() * 0.05)) tr.startIn('scramble'); // the engine's rule
      const f = makeField(16, 8);
      tr.apply(f, CELL_W, CELL_H);
      for (let i = 0; i < f.size; i++) {
        expect(f.intensity[i]).toBeGreaterThanOrEqual(0);
        expect(f.intensity[i]).toBeLessThanOrEqual(1);
      }
    }
    for (let i = 0; i < 200 && tr.active; i++) if (tr.advance(FRAME)) tr.startIn('scramble');
    expect(tr.active).toBe(false);
  });

  it('uses a deterministic xorshift generator and integer hash', () => {
    const a = new XorShift32(1);
    const b = new XorShift32(1);
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(hash32(12345)).toBe(hash32(12345));
    expect(hash32(1)).not.toBe(hash32(2));
    expect(Number.isInteger(hash32(-7)) && hash32(-7) >= 0 && hash32(-7) < 2 ** 32).toBe(true);
  });
});

/* ─── Engine (fake renderer + fake browser) ─────────────────────────────── */

interface RendererRecord {
  fonts: number[];
  resizes: Array<[number, number, number]>;
  draws: number;
  glow: number[];
  destroyed: boolean;
}

const harness = vi.hoisted(() => ({ renderers: [] as RendererRecord[] }));

vi.mock('../AsciiRenderer', () => ({
  createAsciiRenderer: (): AsciiRendererAPI => {
    const record: RendererRecord = { fonts: [], resizes: [], draws: 0, glow: [], destroyed: false };
    harness.renderers.push(record);
    let metrics: RendererMetrics = { cellW: 8, cellH: 16, fontSize: 14, dpr: 1 };
    const ramp = (chars: string): GlyphRamp => {
      const codes = Uint16Array.from(chars, (ch) => ch.charCodeAt(0));
      const coverage = Float32Array.from(chars, (_ch, i) => i / Math.max(1, chars.length - 1));
      const indexFor = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * (chars.length - 1));
      return { chars, codes, coverage, indexFor, codeFor: (v: number) => codes[indexFor(v)] };
    };
    return {
      configure(fontSize: number, dpr: number): RendererMetrics {
        record.fonts.push(fontSize);
        metrics = {
          cellW: Math.round(fontSize * 0.6 * dpr) / dpr,
          cellH: Math.round(fontSize * 1.2 * dpr) / dpr,
          fontSize,
          dpr,
        };
        return metrics;
      },
      resize(width: number, height: number, dpr: number): void {
        record.resizes.push([width, height, dpr]);
      },
      draw(field: GlyphField): number {
        record.draws++;
        let n = 0;
        for (let i = 0; i < field.glyph.length; i++) if (field.glyph[i] !== 0 && field.intensity[i] >= 0.02) n++;
        return n;
      },
      ramp,
      setGlow(strength: number): void {
        record.glow.push(strength);
      },
      get metrics(): RendererMetrics {
        return metrics;
      },
      destroy(): void {
        record.destroyed = true;
      },
    };
  },
}));

type Listener = EventListenerOrEventListenerObject;

class FakeTarget {
  readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, fn: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  emit(type: string, event: object = {}): void {
    for (const fn of Array.from(this.listeners.get(type) ?? [])) {
      if (typeof fn === 'function') fn(event as Event);
      else fn.handleEvent(event as Event);
    }
  }

  get listenerCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

class FakeCanvas extends FakeTarget {
  width = 0;
  height = 0;
  cssWidth: number;
  cssHeight: number;
  readonly dataset: Record<string, string> = {};

  constructor(width: number, height: number) {
    super();
    this.cssWidth = width;
    this.cssHeight = height;
  }

  get clientHeight(): number {
    return this.cssHeight;
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.cssWidth, height: this.cssHeight };
  }

  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean {
    return false;
  }
}

const GLYPH_FACE = { family: '"JetBrains Mono"', weight: '500', status: 'loaded' };

class FakeFonts extends FakeTarget {
  available = true;

  load(): Promise<Array<typeof GLYPH_FACE>> {
    return Promise.resolve(this.available ? [GLYPH_FACE] : []);
  }

  forEach(cb: (face: typeof GLYPH_FACE) => void): void {
    if (this.available) cb(GLYPH_FACE);
  }
}

class FakeDocument extends FakeTarget {
  hidden = false;
  readonly fonts = new FakeFonts();

  elementFromPoint(): null {
    return null;
  }
}

class FakeWindow extends FakeTarget {
  devicePixelRatio = 1;
  readonly queries: FakeTarget[] = [];

  matchMedia(): FakeTarget {
    const query = new FakeTarget();
    this.queries.push(query);
    return query;
  }

  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    return setTimeout(fn, ms);
  }

  clearTimeout(id: ReturnType<typeof setTimeout>): void {
    clearTimeout(id);
  }
}

class FakeResizeObserver {
  static readonly instances: FakeResizeObserver[] = [];
  connected = true;
  readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(): void {}

  disconnect(): void {
    this.connected = false;
  }
}

interface Env {
  clock: { now: number };
  raf: Array<{ id: number; cb: FrameRequestCallback }>;
  canvas: FakeCanvas;
  doc: FakeDocument;
  win: FakeWindow;
}

let env: Env;

beforeEach(() => {
  harness.renderers.length = 0;
  FakeResizeObserver.instances.length = 0;
  const clock = { now: 1000 };
  const raf: Env['raf'] = [];
  let nextId = 1;
  env = { clock, raf, canvas: new FakeCanvas(1280, 720), doc: new FakeDocument(), win: new FakeWindow() };
  vi.stubGlobal('document', env.doc);
  vi.stubGlobal('window', env.win);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    const id = nextId++;
    raf.push({ id, cb });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    const i = raf.findIndex((r) => r.id === id);
    if (i >= 0) raf.splice(i, 1);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Run one animation frame `ms` after the previous one. */
function frame(ms = 1000 / 60): void {
  env.clock.now += ms;
  const due = env.raf.splice(0, env.raf.length);
  for (const r of due) r.cb(env.clock.now);
}

function run(seconds: number): void {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) frame();
}

/** Let the font promise chain settle. */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

interface Hooks {
  throwRender?: boolean;
  scale?: number;
}

function makeLab() {
  const log: string[] = [];
  const hooks: Record<ExperimentId, Hooks> = { waves: {}, attractor: {}, topology: {} };
  const seen = {
    dt: [] as number[],
    time: [] as number[],
    realDt: [] as number[],
    clearedBeforeRender: true,
    params: {} as Partial<Record<ExperimentId, Readonly<ParamValues>>>,
  };
  const make =
    (id: ExperimentId): ExperimentFactory =>
    () => {
      log.push(`${id}:factory`);
      return {
        id,
        resize: () => {
          log.push(`${id}:resize`);
        },
        setParams: (p) => {
          log.push(`${id}:setParams`);
          seen.params[id] = p;
        },
        update: (ctx) => {
          log.push(`${id}:update`);
          seen.dt.push(ctx.dt);
          seen.time.push(ctx.time);
          seen.realDt.push(ctx.realDt);
        },
        render: (field) => {
          log.push(`${id}:render`);
          for (let i = 0; i < field.glyph.length; i++) {
            if (field.glyph[i] !== 0 || field.intensity[i] !== 0) {
              seen.clearedBeforeRender = false;
              break;
            }
          }
          if (hooks[id].throwRender) throw new Error(`${id} render failed`);
          field.glyph.fill(35);
          field.intensity.fill(0.8);
        },
        reset: () => {
          log.push(`${id}:reset`);
        },
        probe: () => ({ heading: id, rows: [] }),
        cellScale: () => hooks[id].scale ?? 1,
        dispose: () => {
          log.push(`${id}:dispose`);
        },
      };
    };
  const factories: Record<ExperimentId, ExperimentFactory> = {
    waves: make('waves'),
    attractor: make('attractor'),
    topology: make('topology'),
  };
  return { log, hooks, seen, factories };
}

const PARAMS: Record<ExperimentId, ParamValues> = { waves: { a: 1 }, attractor: { b: 2 }, topology: { c: 3 } };

async function start(overrides: Partial<EngineOptions> = {}) {
  const lab = makeLab();
  const onStats = vi.fn<(stats: EngineStats) => void>();
  const onProbe = vi.fn<(probe: ProbeReadout | null) => void>();
  const engine = createEngine({
    canvas: env.canvas as unknown as HTMLCanvasElement,
    factories: lab.factories,
    mode: 'waves',
    params: PARAMS,
    onStats,
    onProbe,
    ...overrides,
  });
  const renderer = harness.renderers[harness.renderers.length - 1];
  await settle();
  const lastStats = (): EngineStats => onStats.mock.calls[onStats.mock.calls.length - 1][0];
  const lastProbe = (): ProbeReadout | null => onProbe.mock.calls[onProbe.mock.calls.length - 1][0];
  return { engine, lab, renderer, onStats, onProbe, lastStats, lastProbe };
}

function last<T>(values: readonly T[]): T {
  return values[values.length - 1];
}

describe('engine', () => {
  it('sizes the base font from the stage width', () => {
    expect(baseFontSize(1280)).toBe(11);
    expect(baseFontSize(1600)).toBeCloseTo(13.12, 6);
    expect(baseFontSize(2560)).toBe(15);
  });

  it('aborts cleanly when destroyed before the fonts arrive (StrictMode), and can start again', async () => {
    const lab = makeLab();
    const engine = createEngine({
      canvas: env.canvas as unknown as HTMLCanvasElement,
      factories: lab.factories,
      mode: 'waves',
      params: PARAMS,
    });
    engine.destroy();
    await settle();
    expect(lab.log).toEqual([]);
    expect(env.raf).toHaveLength(0);
    expect(env.canvas.listenerCount).toBe(0);
    expect(env.doc.listenerCount).toBe(0);
    expect(env.win.listenerCount).toBe(0);
    expect(harness.renderers[0].destroyed).toBe(true);

    const again = await start();
    frame();
    expect(again.lab.log).toContain('waves:render');
  });

  it('drives the lifecycle in contract order and clears the field before every render', async () => {
    const { lab } = await start();
    frame();
    expect(lab.log.slice(0, 5)).toEqual([
      'waves:factory',
      'waves:setParams',
      'waves:resize',
      'waves:update',
      'waves:render',
    ]);
    run(0.5);
    expect(lab.seen.clearedBeforeRender).toBe(true);
  });

  it('reports ready after the first frame, stats ~4×/s, and reveals out of darkness for ~1.4 s', async () => {
    const { onStats, lastStats } = await start();
    expect(onStats).not.toHaveBeenCalled();
    frame();
    expect(onStats).toHaveBeenCalledTimes(1);
    expect(lastStats()).toMatchObject({ ready: true, mode: 'waves', transitioning: true, cols: 182, rows: 55 });
    run(1);
    expect(onStats.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(onStats.mock.calls.length).toBeLessThanOrEqual(6);
    expect(lastStats().transitioning).toBe(true);
    run(0.8);
    expect(lastStats().transitioning).toBe(false);
  });

  it('switches with OUT → switch → IN; inactive experiments receive no calls', async () => {
    const { engine, lab, lastStats } = await start();
    run(2);
    lab.log.length = 0;
    engine.setMode('attractor');
    run(0.25);
    expect(lab.log).not.toContain('attractor:factory'); // still dissolving the old field
    expect(lab.log).toContain('waves:render');
    run(0.15);
    const i = lab.log.indexOf('attractor:factory');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(lab.log.slice(i, i + 3)).toEqual(['attractor:factory', 'attractor:setParams', 'attractor:resize']);
    expect(lab.log.slice(i).some((e) => e.startsWith('waves:'))).toBe(false);
    run(1);
    expect(lastStats()).toMatchObject({ mode: 'attractor', transitioning: false });
  });

  it('retargets rapid mode changes and never gets stuck', async () => {
    const { engine, lab, lastStats } = await start();
    run(0.5); // mid first-load reveal
    const ids: ExperimentId[] = ['waves', 'attractor', 'topology'];
    const rng = new XorShift32(7);
    let wanted: ExperimentId = 'waves';
    for (let k = 0; k < 120; k++) {
      wanted = ids[rng.nextU32() % 3];
      engine.setMode(wanted);
      for (let f = 1 + (rng.nextU32() % 12); f > 0; f--) frame();
    }
    run(2.5);
    expect(lastStats()).toMatchObject({ mode: wanted, transitioning: false });
    lab.log.length = 0;
    frame();
    expect(lab.log).toEqual([`${wanted}:update`, `${wanted}:render`]);
  });

  it('publishes a null probe while the old field dissolves', async () => {
    const { engine, lastProbe } = await start();
    run(2);
    expect(lastProbe()).toMatchObject({ heading: 'waves' });
    engine.setMode('topology');
    run(0.2);
    expect(lastProbe()).toBeNull();
    run(1);
    expect(lastProbe()).toMatchObject({ heading: 'topology' });
  });

  it('logs a failing experiment once and keeps the loop running', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { lab, renderer } = await start();
    lab.hooks.waves.throwRender = true;
    const draws = renderer.draws;
    run(0.5);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(renderer.draws - draws).toBe(30);
  });

  it('freezes time while paused, slows it with reduced motion, and clamps dt', async () => {
    const { engine, lab } = await start();
    run(0.1);
    engine.setPaused(true);
    const frozen = last(lab.seen.time);
    lab.seen.dt.length = 0;
    run(0.2);
    expect(lab.seen.dt.every((d) => d === 0)).toBe(true);
    expect(last(lab.seen.time)).toBe(frozen);

    engine.setPaused(false);
    engine.setReducedMotion(true);
    lab.seen.dt.length = 0;
    run(0.1);
    for (const d of lab.seen.dt) expect(d).toBeCloseTo(FRAME * 0.4, 9);

    engine.setReducedMotion(false);
    frame(200);
    expect(last(lab.seen.dt)).toBeCloseTo(1 / 20, 9);
    expect(last(lab.seen.realDt)).toBeCloseTo(0.2, 9);
    frame(5000);
    expect(last(lab.seen.realDt)).toBeCloseTo(0.25, 9);
  });

  it('pauses the loop while the tab is hidden and resumes without a time jump', async () => {
    const { lab } = await start();
    run(0.1);
    env.doc.hidden = true;
    env.doc.emit('visibilitychange');
    expect(env.raf).toHaveLength(0);
    env.clock.now += 5000;
    env.doc.hidden = false;
    env.doc.emit('visibilitychange');
    expect(env.raf).toHaveLength(1);
    frame();
    expect(last(lab.seen.realDt)).toBeCloseTo(FRAME, 9);
  });

  it('repaints synchronously on resize; bursts settle the font afterwards', async () => {
    const { lab, renderer } = await start();
    run(0.5);
    const draws = renderer.draws;
    lab.log.length = 0;
    env.canvas.cssWidth = 1920;
    env.canvas.cssHeight = 1080;
    FakeResizeObserver.instances[0].callback();
    expect(last(renderer.resizes)).toEqual([1920, 1080, 1]);
    expect(last(renderer.fonts)).toBe(15); // a lone resize rebuilds completely, at once
    expect(renderer.draws).toBe(draws + 1); // …and paints before the browser does
    expect(lab.log).toContain('waves:resize');

    run(0.5);
    const configured = renderer.fonts.length;
    for (let k = 0; k < 10; k++) {
      env.canvas.cssWidth = 1400 + k * 20;
      FakeResizeObserver.instances[0].callback();
      frame();
    }
    expect(renderer.fonts.length - configured).toBe(1); // only the leading edge re-rasterised
    run(0.2);
    expect(last(renderer.fonts)).toBe(Math.round(baseFontSize(1580) * 8) / 8);
    expect(last(renderer.resizes)).toEqual([1580, 1080, 1]);
  });

  it('follows cellScale (density slider) at most ~8 rebuilds per second', async () => {
    const { lab, renderer } = await start();
    run(0.5);
    const before = renderer.fonts.length;
    for (let k = 0; k < 60; k++) {
      lab.hooks.waves.scale = 0.8 + k * 0.01;
      frame();
    }
    const during = renderer.fonts.length - before;
    expect(during).toBeGreaterThanOrEqual(6);
    expect(during).toBeLessThanOrEqual(9);
    run(0.3);
    expect(last(renderer.fonts)).toBe(Math.round(11 * 1.39 * 8) / 8);
  });

  it('rebuilds the atlas once more when the font arrives late', async () => {
    env.doc.fonts.available = false;
    const { renderer } = await start();
    run(0.1);
    const configured = renderer.fonts.length;
    expect(env.doc.fonts.listenerCount).toBe(1);
    env.doc.fonts.available = true;
    env.doc.fonts.emit('loadingdone');
    frame();
    expect(renderer.fonts.length).toBe(configured + 1);
    expect(env.doc.fonts.listenerCount).toBe(0);
  });

  it('stores params, forwards them to the active experiment and delivers stale ones on activation', async () => {
    const { engine, lab } = await start();
    run(2);
    engine.setMode('attractor');
    run(1.5);
    lab.log.length = 0;
    const next = { a: 42 };
    engine.setParams('waves', next);
    run(0.1);
    expect(lab.log.some((e) => e.startsWith('waves:'))).toBe(false); // inactive: no calls
    engine.setMode('waves');
    run(0.5);
    const i = lab.log.indexOf('waves:setParams');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(lab.seen.params.waves).toBe(next);
    expect(lab.log.indexOf('waves:update')).toBeGreaterThan(i);

    lab.log.length = 0;
    const live = { a: 7 };
    engine.setParams('waves', live);
    expect(lab.log).toEqual(['waves:setParams']);
    expect(lab.seen.params.waves).toBe(live);
    engine.resetSimulation();
    expect(lab.log).toContain('waves:reset');
  });

  it('lowers quality only when that helps, and keeps the glow while quality ≥ 0.75', async () => {
    const { renderer, lastStats } = await start();
    for (let i = 0; i < 300; i++) frame(1000 / 30); // a 30 fps cap that density cannot fix
    expect(lastStats().quality).toBe(1);
    expect(renderer.fonts).toContain(12.25); // it tried 11 ÷ 0.9 …
    expect(last(renderer.fonts)).toBe(11); // … and gave the full grid back
    expect(renderer.glow.every((g) => g > 0)).toBe(true);
  });

  it('destroy removes every listener, disposes experiments and is idempotent', async () => {
    const { engine, lab, renderer } = await start();
    run(0.1);
    engine.setMode('attractor');
    run(1);
    engine.destroy();
    engine.destroy();
    expect(lab.log.filter((e) => e.endsWith(':dispose')).sort()).toEqual(['attractor:dispose', 'waves:dispose']);
    expect(env.canvas.listenerCount).toBe(0);
    expect(env.doc.listenerCount).toBe(0);
    expect(env.doc.fonts.listenerCount).toBe(0);
    expect(env.win.listenerCount).toBe(0);
    expect(env.win.queries.every((q) => q.listenerCount === 0)).toBe(true);
    expect(FakeResizeObserver.instances.every((o) => !o.connected)).toBe(true);
    expect(env.raf).toHaveLength(0);
    expect(renderer.destroyed).toBe(true);
    const calls = lab.log.length;
    engine.setMode('topology');
    engine.setParams('waves', { a: 0 });
    engine.resetSimulation();
    expect(lab.log.length).toBe(calls);
  });
});
