/* ═══════════════════════════════════════════════════════════════════════════
 *  Small, allocation-free 3-D linear algebra for the TOPOLOGY software renderer.
 *
 *  Matrices are row-major Float64Array(9):      | m0 m1 m2 |
 *                                               | m3 m4 m5 |
 *                                               | m6 m7 m8 |
 *
 *  Vectors are any indexable number storage (number[], Float32Array,
 *  Float64Array). Every helper takes an optional offset so packed xyz arrays
 *  (positions[3k], positions[3k+1], positions[3k+2]) work without copying.
 *  Nothing here allocates unless you omit an `out` argument.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Row-major 3×3 matrix. */
export type Mat3 = Float64Array;
/** Readable vector storage. */
export type VecIn = ArrayLike<number>;
/** Writable vector storage. */
export type VecOut = { [index: number]: number };

/** A new identity matrix (allocates — call once, then reuse). */
export function createMat3(): Mat3 {
  const m = new Float64Array(9);
  m[0] = 1;
  m[4] = 1;
  m[8] = 1;
  return m;
}

/**
 * Orbit-camera rotation built from two angles:
 *   1. yaw ψ   — turn the object about its own z-axis (a turntable spin);
 *   2. pitch θ — raise the eye θ radians above the object's xy-plane
 *                (θ = 0: edge-on, θ = π/2: looking straight down).
 *
 * The result maps object coordinates → camera coordinates
 * (x → screen right, y → screen up, z → toward the viewer):
 *
 *         |  cos ψ           −sin ψ           0     |
 *   M  =  |  sin θ · sin ψ    sin θ · cos ψ   cos θ |
 *         | −cos θ · sin ψ   −cos θ · cos ψ   sin θ |
 *
 * The rows are orthonormal and det M = +1, so M is a pure rotation: it keeps
 * lengths and angles, and it turns surface normals exactly like positions.
 */
export function rotationFromYawPitch(yaw: number, pitch: number, out: Mat3 = new Float64Array(9)): Mat3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  out[0] = cy;
  out[1] = -sy;
  out[2] = 0;
  out[3] = sp * sy;
  out[4] = sp * cy;
  out[5] = cp;
  out[6] = -cp * sy;
  out[7] = -cp * cy;
  out[8] = sp;
  return out;
}

/** out[o..o+2] = M · (x, y, z). Safe when `out` is the array the inputs were read from. */
export function transformPoint(m: Mat3, x: number, y: number, z: number, out: VecOut, o = 0): void {
  const tx = m[0] * x + m[1] * y + m[2] * z;
  const ty = m[3] * x + m[4] * y + m[5] * z;
  const tz = m[6] * x + m[7] * y + m[8] * z;
  out[o] = tx;
  out[o + 1] = ty;
  out[o + 2] = tz;
}

/** a · b */
export function dot(a: VecIn, b: VecIn, ai = 0, bi = 0): number {
  return a[ai] * b[bi] + a[ai + 1] * b[bi + 1] + a[ai + 2] * b[bi + 2];
}

/** out = a × b (right-handed). Safe when `out` aliases `a` or `b`. */
export function cross(a: VecIn, b: VecIn, out: VecOut, ai = 0, bi = 0, oi = 0): void {
  const ax = a[ai];
  const ay = a[ai + 1];
  const az = a[ai + 2];
  const bx = b[bi];
  const by = b[bi + 1];
  const bz = b[bi + 2];
  out[oi] = ay * bz - az * by;
  out[oi + 1] = az * bx - ax * bz;
  out[oi + 2] = ax * by - ay * bx;
}

/** |v| */
export function length3(v: VecIn, i = 0): number {
  return Math.sqrt(v[i] * v[i] + v[i + 1] * v[i + 1] + v[i + 2] * v[i + 2]);
}

/**
 * Scale v (in place) to unit length. Returns the length it had.
 * A zero vector is left untouched (returns 0) instead of becoming NaN.
 */
export function normalize(v: VecIn & VecOut, i = 0): number {
  const len = length3(v, i);
  if (len > 0) {
    const inv = 1 / len;
    v[i] *= inv;
    v[i + 1] *= inv;
    v[i + 2] *= inv;
  }
  return len;
}
