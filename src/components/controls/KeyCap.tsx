import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Kbd } from '../ui/primitives';
import type { KeyToken } from './shortcuts';

/** A key cap for a shortcut token. Arrows are drawn as SVG (the bundled fonts have no arrow glyphs). */
export default function KeyCap({ token, className }: { token: KeyToken; className?: string }) {
  if (token === 'ArrowLeft' || token === 'ArrowRight') {
    const Icon = token === 'ArrowLeft' ? ArrowLeft : ArrowRight;
    return (
      <Kbd className={className}>
        <Icon size={10} strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only">{token === 'ArrowLeft' ? 'Left arrow' : 'Right arrow'}</span>
      </Kbd>
    );
  }
  const text = token === 'Space' ? 'SPACE' : token === 'Esc' ? 'ESC' : token.toUpperCase();
  return <Kbd className={className}>{text}</Kbd>;
}
