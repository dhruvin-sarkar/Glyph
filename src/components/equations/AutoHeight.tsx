import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { cx } from '../ui/primitives';

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Animates its height to fit its content (measured with a ResizeObserver), so
 * the card glides when the equation changes length instead of jumping.
 * `open = false` collapses it to zero height.
 */
export function AutoHeight({ open = true, children, className }: { open?: boolean; children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.div
      className={cx('overflow-hidden', className)}
      initial={false}
      animate={{ height: open ? (height ?? 'auto') : 0, opacity: open ? 1 : 0 }}
      transition={{ height: { duration: 0.5, ease: EASE }, opacity: { duration: open ? 0.4 : 0.2 } }}
      aria-hidden={open ? undefined : true}
      inert={!open}
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}
