import { useCallback, useSyncExternalStore } from 'react';

/** Below the SPEC §7 tablet breakpoint the panel becomes a bottom sheet. */
export const MOBILE_QUERY = '(max-width: 767px)';

function mediaList(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
}

/** Live `matchMedia` flag; re-renders only when the match flips. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = mediaList(query);
      if (!mq) return () => {};
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
      }
      // Safari < 14 only knows the legacy listener API.
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => mediaList(query)?.matches ?? false, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
