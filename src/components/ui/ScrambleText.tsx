import type { ElementType } from 'react';
import { useScrambleText, type ScrambleOptions } from '../../hooks/useScrambleText';

/* OWNER: ui-shell agent. CONTRACT: keep these props — others import it. */
export interface ScrambleTextProps extends ScrambleOptions {
  text: string;
  className?: string;
  as?: ElementType;
}

const CELL = 'col-start-1 row-start-1';
const CELL_RESERVED = 'invisible col-start-1 row-start-1';

/**
 * Text that decodes from random glyphs whenever it changes (and when it first appears).
 * Screen readers get the final text only.
 *
 * Layout: while decoding, the final text is laid out invisibly in the same grid cell as the
 * flickering text, so the box is never smaller than the final text — growing labels take
 * their final size at once instead of crawling, and nothing overflows or wraps mid-decode.
 */
export default function ScrambleText({ text, className, as: Tag = 'span', ...options }: Readonly<ScrambleTextProps>) {
  const shown = useScrambleText(text, options);
  const decoding = shown !== text;
  return (
    <Tag className={className}>
      <span aria-hidden="true" className="inline-grid">
        <span className={decoding ? CELL_RESERVED : CELL}>{text}</span>
        {decoding ? <span className={CELL}>{shown}</span> : null}
      </span>
      <span className="sr-only">{text}</span>
    </Tag>
  );
}
