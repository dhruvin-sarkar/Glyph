import type { PointerSnapshot, StageClick } from './types';

/* ═══════════════════════════════════════════════════════════════════════════
 *  GLYPHFIELD · POINTER INPUT
 *
 *  Experiments never receive event callbacks. Input is gathered between frames
 *  and handed over as ONE snapshot per frame (ctx.pointer), so an experiment
 *  sees a consistent picture: where the pointer is, how fast it moves, and
 *  which clicks completed during this frame.
 *
 *  • PointerState   — the pure state machine (no DOM; unit-tested directly).
 *  • PointerTracker — binds it to the canvas' pointer + wheel events.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** A click is a press + release that travels less than this (CSS px)… */
export const CLICK_MAX_TRAVEL = 6;
/** …and lasts less than this (ms). */
export const CLICK_MAX_MS = 450;
/** A held pointer that has travelled more than this (CSS px) is dragging. */
export const DRAG_THRESHOLD = 4;
/** Velocity smoothing time constant (s). */
const VELOCITY_TAU = 0.06;
/** At most this many clicks are queued between two frames. */
const MAX_PENDING_CLICKS = 8;

export interface PointerGeometry {
  originX: number;
  originY: number;
  cellW: number;
  cellH: number;
}

/** The pointer state machine. Feed it events, read one snapshot per frame. */
export class PointerState {
  /** The one snapshot object, refilled every frame (never reallocated). */
  readonly snap: PointerSnapshot;
  private readonly frameClicks: StageClick[] = [];
  private readonly pendingClicks: StageClick[] = [];

  private originX = 0;
  private originY = 0;
  private cellW = 1;
  private cellH = 1;

  private x = 0;
  private y = 0;
  private hasPosition = false;
  /** movement accumulated since the last snapshot */
  private moveX = 0;
  private moveY = 0;
  private wheelSum = 0;
  private pressedFlag = false;
  private releasedFlag = false;
  private down = false;
  private captured = false;
  private over = false;
  private pressX = 0;
  private pressY = 0;
  private pressTime = 0;
  /** farthest distance from the press point during this press */
  private travel = 0;
  private activity = false;
  private touch = false;
  private idle = Infinity;
  private vx = 0;
  private vy = 0;

  constructor() {
    this.snap = {
      x: 0,
      y: 0,
      col: 0,
      row: 0,
      dx: 0,
      dy: 0,
      vx: 0,
      vy: 0,
      speed: 0,
      inside: false,
      down: false,
      pressed: false,
      released: false,
      dragging: false,
      clicks: this.frameClicks,
      wheel: 0,
      idleTime: Infinity,
      isTouch: false,
    };
  }

  /** Grid geometry used for the fractional (col, row) coordinates. */
  setGeometry(g: PointerGeometry): void {
    this.originX = g.originX;
    this.originY = g.originY;
    this.cellW = g.cellW > 0 ? g.cellW : 1;
    this.cellH = g.cellH > 0 ? g.cellH : 1;
  }

  /** Is the pointer physically over the stage (not over UI chrome)? */
  setOver(over: boolean): void {
    this.over = over;
  }

  /** Pointer capture keeps a drag "inside" even when it crosses the UI. */
  setCaptured(captured: boolean): void {
    this.captured = captured;
  }

  /** The pointer arrived over the stage: jump there without inventing a movement. */
  enter(x: number, y: number, touch: boolean): void {
    this.place(x, y);
    this.over = true;
    this.touch = touch;
    this.activity = true;
  }

  move(x: number, y: number, touch: boolean): void {
    if (this.hasPosition) {
      this.moveX += x - this.x;
      this.moveY += y - this.y;
    }
    this.place(x, y);
    this.touch = touch;
    this.activity = true;
    if (this.down) {
      const d = Math.hypot(x - this.pressX, y - this.pressY);
      if (d > this.travel) this.travel = d;
    }
  }

  press(x: number, y: number, timeMs: number, touch: boolean): void {
    if (this.down) return;
    // A touch "teleports" to where the finger lands — that is not a movement.
    if (this.hasPosition && !touch) {
      this.moveX += x - this.x;
      this.moveY += y - this.y;
    }
    this.place(x, y);
    this.down = true;
    this.pressedFlag = true;
    this.pressX = x;
    this.pressY = y;
    this.pressTime = timeMs;
    this.travel = 0;
    this.touch = touch;
    this.over = true;
    this.activity = true;
  }

  release(x: number, y: number, timeMs: number): void {
    if (!this.down) return;
    this.move(x, y, this.touch);
    this.down = false;
    this.captured = false;
    this.releasedFlag = true;
    if (
      this.travel < CLICK_MAX_TRAVEL &&
      timeMs - this.pressTime < CLICK_MAX_MS &&
      this.pendingClicks.length < MAX_PENDING_CLICKS
    ) {
      // A fresh object per click (rare, user-paced) so an experiment may keep it safely.
      this.pendingClicks.push({ x, y, col: this.colOf(x), row: this.rowOf(y) });
    }
  }

  /** The press ended without a release (touch cancelled, window lost focus…): no click. */
  cancel(): void {
    if (!this.down) return;
    this.down = false;
    this.captured = false;
    this.releasedFlag = true;
    this.activity = true;
  }

  /** Wheel delta in CSS px (positive = scroll down). */
  wheel(deltaY: number): void {
    if (!Number.isFinite(deltaY)) return;
    this.wheelSum += deltaY;
    this.activity = true;
  }

  /** Forget any held state (window blur, tab hidden). */
  releaseAll(): void {
    this.cancel();
    this.captured = false;
    this.over = false;
  }

  /**
   * Fill and return the shared snapshot for this frame, then clear the
   * per-frame accumulators (pressed, released, clicks, wheel, dx, dy).
   * `realDt` = 0 delivers the pending input without advancing velocity/idle time.
   */
  snapshot(realDt: number): PointerSnapshot {
    const s = this.snap;
    s.x = this.x;
    s.y = this.y;
    s.col = this.colOf(this.x);
    s.row = this.rowOf(this.y);
    s.dx = this.moveX;
    s.dy = this.moveY;

    if (realDt > 0) {
      // Exponential smoothing of this frame's velocity, time constant ≈ 60 ms.
      const k = 1 - Math.exp(-realDt / VELOCITY_TAU);
      this.vx += (this.moveX / realDt - this.vx) * k;
      this.vy += (this.moveY / realDt - this.vy) * k;
      if (Math.abs(this.vx) < 1e-3) this.vx = 0;
      if (Math.abs(this.vy) < 1e-3) this.vy = 0;
      if (this.activity) this.idle = 0;
      else if (this.idle !== Infinity) this.idle += realDt;
    } else if (this.activity) {
      this.idle = 0;
    }
    s.vx = this.vx;
    s.vy = this.vy;
    s.speed = Math.hypot(this.vx, this.vy);

    s.inside = this.over || (this.down && this.captured);
    s.down = this.down;
    s.pressed = this.pressedFlag;
    s.released = this.releasedFlag;
    s.dragging = this.down && this.travel > DRAG_THRESHOLD;

    const clicks = this.frameClicks;
    clicks.length = 0;
    for (let i = 0; i < this.pendingClicks.length; i++) clicks.push(this.pendingClicks[i]);
    this.pendingClicks.length = 0;

    s.wheel = this.wheelSum;
    s.idleTime = this.idle;
    s.isTouch = this.touch;

    this.moveX = 0;
    this.moveY = 0;
    this.wheelSum = 0;
    this.pressedFlag = false;
    this.releasedFlag = false;
    this.activity = false;
    return s;
  }

  private place(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.hasPosition = true;
  }

  private colOf(x: number): number {
    return (x - this.originX) / this.cellW;
  }

  private rowOf(y: number): number {
    return (y - this.originY) / this.cellH;
  }
}

function isTouchLike(e: PointerEvent): boolean {
  return e.pointerType === 'touch' || e.pointerType === 'pen';
}

/**
 * Binds a PointerState to the stage canvas. Only the primary pointer counts
 * (first finger, the mouse). Over UI chrome the canvas receives `pointerleave`
 * and the snapshot reports `inside = false` — unless a drag holds pointer
 * capture, which keeps it on the stage until release.
 */
export class PointerTracker {
  readonly state = new PointerState();
  private readonly el: HTMLElement;
  private left = 0;
  private top = 0;
  private captureId = -1;
  private disposed = false;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerenter', this.onEnter);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('lostpointercapture', this.onLostCapture);
    el.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onBlur);
    this.refreshRect();
  }

  /** Re-read the stage's page offset (call after the stage resizes). */
  refreshRect(): void {
    const r = this.el.getBoundingClientRect();
    this.setOrigin(r.left, r.top);
  }

  /** Page offset of the stage (from a bounding rect the caller already has). */
  setOrigin(left: number, top: number): void {
    this.left = left;
    this.top = top;
  }

  setGeometry(g: PointerGeometry): void {
    this.state.setGeometry(g);
  }

  snapshot(realDt: number): PointerSnapshot {
    return this.state.snapshot(realDt);
  }

  releaseAll(): void {
    this.releaseCapture();
    this.state.releaseAll();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseCapture();
    const el = this.el;
    el.removeEventListener('pointerenter', this.onEnter);
    el.removeEventListener('pointerleave', this.onLeave);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('lostpointercapture', this.onLostCapture);
    el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onBlur);
  }

  private readonly onEnter = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    this.state.enter(e.clientX - this.left, e.clientY - this.top, isTouchLike(e));
  };

  private readonly onLeave = (e: PointerEvent): void => {
    if (!e.isPrimary || this.captureId !== -1) return; // a captured drag stays on the stage
    this.state.setOver(false);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    // An uncaptured move delivered to the canvas means the pointer is over it.
    if (this.captureId === -1) this.state.setOver(true);
    this.state.move(e.clientX - this.left, e.clientY - this.top, isTouchLike(e));
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    try {
      // Keep receiving moves while the drag crosses UI chrome or leaves the window.
      this.el.setPointerCapture(e.pointerId);
      this.captureId = e.pointerId;
    } catch {
      this.captureId = -1;
    }
    this.state.setCaptured(this.captureId !== -1);
    this.state.press(e.clientX - this.left, e.clientY - this.top, e.timeStamp, isTouchLike(e));
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    this.state.release(e.clientX - this.left, e.clientY - this.top, e.timeStamp);
    this.releaseCapture();
    // A drag may end over UI chrome: re-check what is really under the pointer.
    this.state.setOver(this.isStageAt(e.clientX, e.clientY));
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    this.state.cancel();
    this.releaseCapture();
  };

  private readonly onLostCapture = (e: PointerEvent): void => {
    if (e.pointerId !== this.captureId) return;
    this.captureId = -1;
    this.state.setCaptured(false);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey) return; // pinch / ctrl+wheel is the browser's zoom, not ours
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.el.clientHeight || 800 : 1;
    this.state.wheel(e.deltaY * unit);
    if (this.captureId === -1) this.state.setOver(true);
  };

  private readonly onBlur = (): void => {
    this.releaseAll();
  };

  private releaseCapture(): void {
    if (this.captureId === -1) return;
    try {
      if (this.el.hasPointerCapture(this.captureId)) this.el.releasePointerCapture(this.captureId);
    } catch {
      // the pointer is already gone — nothing to release
    }
    this.captureId = -1;
    this.state.setCaptured(false);
  }

  private isStageAt(clientX: number, clientY: number): boolean {
    if (typeof document.elementFromPoint !== 'function') return true;
    return document.elementFromPoint(clientX, clientY) === this.el;
  }
}
