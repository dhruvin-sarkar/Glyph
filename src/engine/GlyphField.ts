import type { GlyphField, Tone } from './types';

/** Typed-array implementation of the GlyphField contract. One allocation per grid size. */
export class GlyphBuffer implements GlyphField {
  readonly cols: number;
  readonly rows: number;
  readonly glyph: Uint16Array;
  readonly intensity: Float32Array;
  readonly tone: Uint8Array;

  constructor(cols: number, rows: number) {
    this.cols = Math.max(0, Math.floor(cols));
    this.rows = Math.max(0, Math.floor(rows));
    const n = this.cols * this.rows;
    this.glyph = new Uint16Array(n);
    this.intensity = new Float32Array(n);
    this.tone = new Uint8Array(n);
  }

  get size(): number {
    return this.glyph.length;
  }

  clear(): void {
    this.glyph.fill(0);
    this.intensity.fill(0);
    this.tone.fill(0);
  }

  index(col: number, row: number): number {
    return row * this.cols + col;
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  set(col: number, row: number, charCode: number, intensity: number, tone: Tone = 0): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    const i = (row | 0) * this.cols + (col | 0);
    this.glyph[i] = charCode;
    this.intensity[i] = intensity;
    this.tone[i] = tone;
  }

  plot(col: number, row: number, charCode: number, intensity: number, tone: Tone = 0): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    const i = (row | 0) * this.cols + (col | 0);
    if (intensity < this.intensity[i]) return;
    this.glyph[i] = charCode;
    this.intensity[i] = intensity;
    this.tone[i] = tone;
  }

  /** Copy another field of identical size into this one. */
  copyFrom(other: GlyphField): void {
    if (other.cols !== this.cols || other.rows !== this.rows) return;
    this.glyph.set(other.glyph);
    this.intensity.set(other.intensity);
    this.tone.set(other.tone);
  }
}
