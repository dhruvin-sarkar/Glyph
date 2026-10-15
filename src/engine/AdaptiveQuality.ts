/* ═══════════════════════════════════════════════════════════════════════════
 *  GLYPHFIELD · ADAPTIVE QUALITY
 *
 *  Keeps the installation fluid on a modest school laptop by trading glyph
 *  density for frame rate.
 *
 *  1. Measure — frame time is smoothed with an exponential moving average
 *         m ← m + α·(Δt − m),    α = 1 − e^(−Δt/τ),    τ = 0.25 s
 *     α depends on Δt, so the filter behaves the same at 60, 120 or 144 Hz.
 *     fps = 1 / m.
 *  2. Decide — quality q ∈ {1, 0.9, 0.8, 0.7, 0.6} divides the font size, so
 *     the number of cells (and the work per frame) falls roughly like q².
 *         fps < 50 for 1.5 s → one step down      fps > 58 for 4 s → one step up
 *     The dead band between 50 and 58 fps is the hysteresis: a level that is
 *     "fine" simply stays.
 *  3. Never oscillate — after every down-step there is a cool-down, and each
 *     time a level proves too heavy, the calm period required before trying it
 *     again triples (exponential back-off, like a network retry timer).
 *  4. Never degrade for nothing — if a down-step does not raise the frame rate,
 *     the limit is the display or the browser (a 50 Hz projector, a 30 fps
 *     power-saver cap), not our work: the step is undone and down-steps pause.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Quality levels, best first. The engine divides the glyph font size by the quality. */
export const QUALITY_LEVELS: readonly number[] = [1, 0.9, 0.8, 0.7, 0.6];

/** Tunables (seconds unless stated). */
export const AQ_TUNING = {
  /** EMA time constant */
  tau: 0.25,
  /** step down below this smoothed frame rate… */
  lowFps: 50,
  /** …sustained for this long */
  downAfter: 1.5,
  /** step up above this smoothed frame rate… */
  highFps: 58,
  /** …sustained for this long (× backoff^failures of the level above) */
  upAfter: 4,
  /** samples ignored after rebuilds, transitions and tab resume */
  hold: 1,
  /** no up-step can be earned this soon after a down-step */
  cooldown: 3,
  /** time (after the hold) to judge whether a down-step helped */
  verifyAfter: 2,
  /** a useful down-step raises the frame rate by at least 6 % */
  minGain: 1.06,
  /** down-steps paused after the first futile one (the second pauses them until fps recovers) */
  futilePause: 60,
  /** growth factor of the up-step proof period per failure of that level */
  backoff: 3,
  /** frames longer than this are hitches, not a frame rate */
  maxSample: 0.1,
} as const;

const T = AQ_TUNING;

export class AdaptiveQuality {
  private on: boolean;
  private level = 0;
  /** smoothed frame time, s */
  private ema = 1 / 60;
  private lowTime = 0;
  private highTime = 0;
  private holdLeft: number = T.hold;
  private cooldownLeft = 0;
  /** seconds spent judging the last down-step (−1 = not judging) */
  private verifying = -1;
  private fpsBeforeDown = 0;
  private downPausedLeft = 0;
  private futileSteps = 0;
  /** how many times each level has proven too heavy — drives the back-off */
  private readonly failures = new Uint8Array(QUALITY_LEVELS.length);

  constructor(enabled = true) {
    this.on = enabled;
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Current quality multiplier (1 = full density). Always 1 while disabled. */
  get quality(): number {
    return this.on ? QUALITY_LEVELS[this.level] : 1;
  }

  /** Smoothed frames per second (measured even while disabled). */
  get fps(): number {
    return 1 / this.ema;
  }

  /** Turn adaptation on/off. Returns true when `quality` changed as a result. */
  setEnabled(enabled: boolean): boolean {
    if (enabled === this.on) return false;
    const before = this.quality;
    this.on = enabled;
    this.level = 0;
    this.failures.fill(0);
    this.verifying = -1;
    this.cooldownLeft = 0;
    this.downPausedLeft = 0;
    this.futileSteps = 0;
    this.hold();
    return this.quality !== before;
  }

  /** Ignore the next `seconds` of samples (grid rebuilds, transitions, tab resume). */
  hold(seconds: number = T.hold): void {
    if (seconds > this.holdLeft) this.holdLeft = seconds;
    this.lowTime = 0;
    this.highTime = 0;
  }

  /** Feed one frame's wall-clock duration in seconds. Returns true when `quality` changed. */
  sample(frameSeconds: number): boolean {
    if (!(frameSeconds > 0)) return false;
    const s = frameSeconds < T.maxSample ? frameSeconds : T.maxSample;
    this.ema += (1 - Math.exp(-s / T.tau)) * (s - this.ema);
    if (!this.on) return false;

    if (this.cooldownLeft > 0) this.cooldownLeft = Math.max(0, this.cooldownLeft - s);
    if (this.downPausedLeft > 0) this.downPausedLeft = Math.max(0, this.downPausedLeft - s);
    if (this.holdLeft > 0) {
      this.holdLeft = Math.max(0, this.holdLeft - s);
      return false;
    }

    const fps = 1 / this.ema;

    // Did the last down-step actually help?
    if (this.verifying >= 0) {
      this.verifying += s;
      if (this.verifying >= T.verifyAfter) {
        this.verifying = -1;
        if (fps < T.lowFps && fps < this.fpsBeforeDown * T.minGain) return this.undoFutileStep();
      }
    }

    if (fps < T.lowFps) {
      this.highTime = 0;
      this.lowTime += s;
      if (
        this.lowTime >= T.downAfter &&
        this.verifying < 0 &&
        this.downPausedLeft <= 0 &&
        this.level < QUALITY_LEVELS.length - 1
      ) {
        return this.stepDown(fps);
      }
    } else if (fps > T.highFps) {
      this.lowTime = 0;
      this.highTime = this.cooldownLeft > 0 ? 0 : this.highTime + s;
      if (this.highTime >= T.upAfter && this.futileSteps > 0) {
        // The frame-rate cap has lifted: down-steps may be judged afresh.
        this.futileSteps = 0;
        this.downPausedLeft = 0;
      }
      if (this.level > 0) {
        const proof = T.upAfter * T.backoff ** Math.min(4, this.failures[this.level - 1]);
        if (this.highTime >= proof) return this.stepUp();
      }
    } else {
      // Inside the dead band: content.
      this.lowTime = 0;
      this.highTime = 0;
    }
    return false;
  }

  private stepDown(fps: number): boolean {
    this.failures[this.level] = Math.min(255, this.failures[this.level] + 1);
    this.level++;
    this.fpsBeforeDown = fps;
    this.verifying = 0;
    this.cooldownLeft = T.cooldown;
    this.hold();
    return true;
  }

  private stepUp(): boolean {
    this.level--;
    this.hold();
    return true;
  }

  /** The down-step changed nothing: restore the finer grid and pause further down-steps. */
  private undoFutileStep(): boolean {
    this.level--;
    this.failures[this.level] = Math.max(0, this.failures[this.level] - 1);
    this.futileSteps++;
    this.downPausedLeft = this.futileSteps >= 2 ? Infinity : T.futilePause;
    this.hold();
    return true;
  }
}
