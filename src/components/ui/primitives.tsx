import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

/* Shared UI atoms (orchestrator-owned, stable). Use them for consistency; style
 * further with className. See docs/SPEC.md §6 (Art direction). */

/** Join class names, skipping falsy parts. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Tiny uppercase technical label (JetBrains Mono 10px, tracking 0.22em, muted). */
export function MicroLabel({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx('micro text-muted', className)} {...rest}>
      {children}
    </span>
  );
}

/** Keyboard key cap. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-line-strong',
        'bg-white/[0.03] px-1 font-mono text-[10px] leading-none text-ink/80',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** 1px separator. */
export function Hairline({ className, vertical = false }: { className?: string; vertical?: boolean }) {
  return <div aria-hidden="true" className={cx(vertical ? 'w-px self-stretch' : 'h-px w-full', 'bg-line', className)} />;
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** accessible name (also used as tooltip) */
  label: string;
  active?: boolean;
  size?: 'sm' | 'md';
}

/** Round hairline icon button (place a 14–16px lucide icon inside). */
export function IconButton({ label, active = false, size = 'md', className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'pointer-events-auto inline-flex shrink-0 items-center justify-center rounded-full border',
        'transition-[background-color,border-color,color,transform] duration-200 ease-expo active:scale-95',
        size === 'sm' ? 'h-7 w-7' : 'h-9 w-9',
        active
          ? 'border-mint/40 bg-mint/10 text-mint'
          : 'border-line bg-white/[0.02] text-ink/75 hover:border-line-strong hover:bg-white/[0.06] hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Frosted panel surface. */
export function GlassPanel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('glass rounded-2xl', className)} {...rest}>
      {children}
    </div>
  );
}
