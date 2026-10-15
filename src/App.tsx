import { MotionConfig, motion } from 'motion/react';
import { useGlyphStore } from './state/store';
import StageCanvas from './components/StageCanvas';
import Atmosphere from './components/Atmosphere';
import TopBar from './components/TopBar';
import HeroTitle from './components/HeroTitle';
import EquationCard from './components/EquationCard';
import ParameterPanel from './components/ParameterPanel';
import InteractionHint from './components/InteractionHint';
import Dock from './components/Dock';
import StatsReadout from './components/StatsReadout';
import MathDrawer from './components/MathDrawer';
import ShortcutsOverlay from './components/ShortcutsOverlay';
import CustomCursor from './components/CustomCursor';
import KeyboardShortcuts from './components/KeyboardShortcuts';
import AutoTour from './components/AutoTour';

/**
 * Layer stack (docs/SPEC.md §7):
 *   0  StageCanvas  — the living ASCII field (+ glow layer)
 *   2  Atmosphere   — vignette, legibility gradients, grain
 *   10 overlay      — chrome; pointer-events-none, widgets opt back in
 *   30 MathDrawer · 40 ShortcutsOverlay · 50 CustomCursor
 */
export default function App() {
  const uiHidden = useGlyphStore((s) => s.uiHidden);

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative h-dvh w-full overflow-hidden bg-bg text-ink">
        <StageCanvas />
        <Atmosphere />

        <motion.div
          className="pointer-events-none absolute inset-0 z-10"
          initial={false}
          animate={{ opacity: uiHidden ? 0 : 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          inert={uiHidden}
          aria-hidden={uiHidden || undefined}
        >
          <TopBar />
          <HeroTitle />
          <EquationCard />
          <ParameterPanel />
          <InteractionHint />
          <Dock />
          <StatsReadout />
        </motion.div>

        <MathDrawer />
        <ShortcutsOverlay />
        <CustomCursor />
        <KeyboardShortcuts />
        <AutoTour />
      </main>
    </MotionConfig>
  );
}
