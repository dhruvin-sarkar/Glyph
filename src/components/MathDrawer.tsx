import { memo, useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { ArrowUpRight, Check, ChevronDown, X } from 'lucide-react';
import { RAMPS, type ExperimentId, type ParamValues } from '../engine/types';
import {
  ASCII_PIPELINE,
  CENTRAL_IDEA,
  COVERAGE_NOTE,
  EXPLANATIONS,
  type EffectSpec,
  type Explanation,
} from '../content/explanations';
import { PRESETS, type Preset } from '../content/presets';
import { META_BY_ID } from '../experiments/registry';
import { useLiveStore } from '../state/live';
import { useGlyphStore } from '../state/store';
import { useParamFlash } from './equations/Eq';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { MATH_DRAWER_ID } from './equations/ids';
import { LiveEquation } from './equations/LiveEquation';
import { PipelineStrip, useProbeFor } from './equations/live';
import { DisplayMath, InlineMath, MathText } from './equations/MathText';
import { RampCalibration } from './equations/RampCalibration';
import { useExperimentValues } from './equations/values';
import { Kbd, cx } from './ui/primitives';
import ScrambleText from './ui/ScrambleText';
import '../styles/math-drawer.css';

/* ═══════════════════════════════════════════════════════════════════════════
 *  THE MATH — the full exhibit label of the active experiment (SPEC §7, §10).
 *  A left drawer (min(520px, 100vw)) over a 30 % scrim; the field stays visible.
 *  Esc, M, the scrim and the close button close it. Focus moves to the close
 *  button on open, is trapped inside, and returns to the opener on close.
 *
 *    01 THE EQUATION · 02 THE VARIABLES · 03 WHAT CHANGES WHAT
 *    04 TRY THIS · 05 FROM NUMBER TO GLYPH · 06 IN THE REAL WORLD
 * ═══════════════════════════════════════════════════════════════════════════ */

const EASE = [0.16, 1, 0.3, 1] as const;
const TITLE_ID = 'glyph-math-title';
const DESCRIPTION_ID = 'glyph-math-description';
const CHAPTERS = ['Equation', 'Variables', 'Controls', 'Try this', 'Glyphs', 'Real world'] as const;
const FOCUSABLE =
  'a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function MathDrawer() {
  const open = useGlyphStore((s) => s.mathOpen && !s.uiHidden);
  const setMathOpen = useGlyphStore((s) => s.setMathOpen);
  const close = useCallback(() => setMathOpen(false), [setMathOpen]);

  return <AnimatePresence>{open && <DrawerLayer key="math" onClose={close} />}</AnimatePresence>;
}

function DrawerLayer({ onClose }: { onClose: () => void }) {
  const reducedMotion = useReducedMotion();
  const mode = useGlyphStore((s) => s.mode);
  const meta = META_BY_ID[mode];
  const exp: Explanation = EXPLANATIONS[mode];
  const isPresent = useIsPresent();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // whatever had focus when the drawer opened (read during the first render, before any effect moves it)
  const returnTo = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  const restored = useRef(false);

  const restoreFocus = useCallback(() => {
    if (restored.current) return;
    restored.current = true;
    const el = returnTo.current;
    if (el instanceof HTMLElement && el.isConnected && el !== document.body) el.focus({ preventScroll: true });
  }, []);

  // focus in on open; out again on unmount (StrictMode-safe: the flag is re-armed on every mount)
  useEffect(() => {
    restored.current = false;
    closeRef.current?.focus({ preventScroll: true });
    return restoreFocus;
  }, [restoreFocus]);

  // …and immediately when closing starts, not after the exit animation
  useEffect(() => {
    if (!isPresent) restoreFocus();
  }, [isPresent, restoreFocus]);

  // Esc closes — unless the shortcuts overlay is open on top of the drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (useGlyphStore.getState().shortcutsOpen) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // a new experiment starts at the top of its label
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [mode]);

  // keep Tab inside the dialog
  const trapFocus = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    // Closed disclosures keep their contents in the DOM, but out of the tab order.
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => element.getClientRects().length > 0,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const goToChapter = (index: number): void => {
    const scroller = scrollRef.current;
    const heading = scroller?.querySelector<HTMLElement>(`#glyph-math-${String(index + 1).padStart(2, '0')}`);
    if (!scroller || !heading) return;
    const top = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 22;
    heading.focus({ preventScroll: true });
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  };

  return (
    <div className="fixed inset-0 z-30">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-bg/30"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reducedMotion ? 0.15 : 0.4, ease: EASE }}
      />

      <motion.aside
        ref={panelRef}
        id={MATH_DRAWER_ID}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={DESCRIPTION_ID}
        onKeyDown={trapFocus}
        className="glass math-drawer absolute top-0 left-0 flex h-dvh w-[min(520px,100vw)] flex-col overflow-hidden"
        initial={{ x: reducedMotion ? 0 : '-100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1, transition: { x: { duration: reducedMotion ? 0 : 0.55, ease: EASE }, opacity: { duration: reducedMotion ? 0.15 : 0.25 } } }}
        exit={{ x: reducedMotion ? 0 : '-100%', opacity: 0, transition: { duration: reducedMotion ? 0.15 : 0.35, ease: EASE } }}
      >
        <header className="math-drawer__header">
          <div className="math-drawer__topline">
            <p className="micro math-drawer__eyebrow">The math <span aria-hidden="true">/</span> <span className="text-mint">{meta.index}</span></p>
            <div className="flex shrink-0 items-center gap-2.5">
              <Kbd className="max-sm:hidden">Esc</Kbd>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close the math"
                title="Close (Esc)"
                className="math-drawer__close"
              >
                <X size={17} strokeWidth={1.5} />
              </button>
            </div>
          </div>
          <h2 id={TITLE_ID} className="math-drawer__title"><ScrambleText text={meta.name} /></h2>
          <p id={DESCRIPTION_ID} className="math-drawer__subtitle">{meta.subtitle}</p>
          <nav aria-label="Math chapters" className="math-drawer__chapters">
            {CHAPTERS.map((chapter, index) => (
              <button key={chapter} type="button" onClick={() => goToChapter(index)}>
                <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{chapter}
              </button>
            ))}
          </nav>
        </header>

        <div
          ref={scrollRef}
          tabIndex={0}
          aria-label={`The mathematics of ${meta.name}`}
          className="math-drawer__scroll relative flex-1 overflow-y-auto overscroll-contain"
        >
          {/* no initial={false} here: it would also suppress the staggered entrance of the sections on open */}
          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reducedMotion ? 0.15 : 0.22 }}
            >
              <DrawerSections mode={mode} exp={exp} />
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.aside>
    </div>
  );
}

/* ─── Sections ───────────────────────────────────────────────────────────── */

function Section({ n, title, order, children }: { n: string; title: string; order: number; children: ReactNode }) {
  const id = `glyph-math-${n}`;
  const reducedMotion = useReducedMotion();
  return (
    <motion.section
      aria-labelledby={id}
      className="math-chapter"
      initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0.15 : 0.45, ease: EASE, delay: reducedMotion ? 0 : 0.1 + order * 0.04 }}
    >
      <h3 id={id} tabIndex={-1} className="math-chapter__heading">
        <span className="math-chapter__number">{n}</span>
        <span>{title}</span>
      </h3>
      {children}
    </motion.section>
  );
}

function SubLabel({ children }: { children: ReactNode }) {
  return <p className="micro math-drawer__label">{children}</p>;
}

function Disclosure({ title, description, children }: { title: ReactNode; description?: string; children: ReactNode }) {
  return (
    <details className="math-disclosure">
      <summary>
        <span>
          <span className="math-disclosure__title">{title}</span>
          {description && <span className="math-disclosure__description">{description}</span>}
        </span>
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.5} />
      </summary>
      <div className="math-disclosure__body">{children}</div>
    </details>
  );
}

function DrawerSections({ mode, exp }: { mode: ExperimentId; exp: Explanation }) {
  const values = useExperimentValues(mode);

  return (
    <>
      <Section n="01" title="The equation" order={0}>
        <p className="math-drawer__reading">{exp.reading}</p>
        <div className="math-formula">
          <div className="math-formula__caption">
            <SubLabel><span className="math-formula__dot" aria-hidden="true" />Live equation</SubLabel>
            <span>With your values</span>
          </div>
          <LiveEquation mode={mode} className="math-formula__equation" />
        </div>

        <Disclosure title="Read the symbolic equation" description="The same relationship, with letters.">
          <div className="math-drawer__formulas">
            {exp.general.map((src) => <DisplayMath key={src} src={src} />)}
          </div>
          <p className="math-drawer__body"><MathText text={exp.where} values={values} /></p>
        </Disclosure>

        <div className="math-drawer__ideas">
          <SubLabel>The ideas behind it</SubLabel>
          {exp.ideas.map((idea) => (
            <Disclosure key={idea.title} title={<MathText text={idea.title} />}>
              <p className="math-drawer__body"><MathText text={idea.body} values={values} /></p>
            </Disclosure>
          ))}
        </div>
      </Section>

      <Section n="02" title="The variables" order={1}>
        <p className="math-drawer__intro">Match a symbol to its meaning. Mint values follow the field.</p>
        <dl className="math-variables">
          {exp.variables.map((v) => (
            <div key={v.symbol} className="math-variable">
              <dt className="math-variable__symbol">
                <InlineMath src={v.symbol} />
              </dt>
              <dd className="math-variable__definition">
                <span className="math-variable__name">{v.name}</span>
                <span className="math-variable__meaning">
                  <MathText text={v.meaning} />
                </span>
              </dd>
              <dd className="math-variable__value">
                {v.value ? (
                  values[v.value]
                ) : (
                  <span className="math-variable__note">
                    <MathText text={v.note ?? ''} />
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p className="math-drawer__footnote">
          One world unit (u) is half the screen height, at any resolution.
        </p>
      </Section>

      <Section n="03" title="What changes what" order={2}>
        <p className="math-drawer__intro">A small change to a control can reshape the whole picture.</p>
        <ul className="math-effects">
          {exp.effects.map((effect) => (
            <EffectRow key={effect.param} mode={mode} effect={effect} />
          ))}
        </ul>
      </Section>

      <Section n="04" title="Try this" order={3}>
        <p className="math-drawer__intro">Choose a starting point, then watch what changes in the field.</p>
        <PresetGrid mode={mode} />
      </Section>

      <Section n="05" title="From number to glyph" order={4}>
        <p className="math-drawer__intro">A calculation becomes a character. Here is one sample from the field.</p>
        <div className="math-drawer__sample">
          <SubLabel>At the probe, right now</SubLabel>
          <DrawerPipeline mode={mode} intensitySymbol={exp.intensitySymbol} />
        </div>
        <ol className="math-pipeline">
          {exp.pipeline.map((st, i) => (
            <li key={st.step} className="math-pipeline__step">
              <span className="math-pipeline__number" aria-hidden="true">{i + 1}</span>
              <div className="min-w-0">
                <h4 className="math-pipeline__title">{st.step.toLowerCase()}</h4>
                {st.math && <DisplayMath src={st.math} className="math-pipeline__formula" />}
                {st.glyphs && <GlyphTiles glyphs={st.glyphs} />}
                <p className="math-drawer__body">
                  <MathText text={st.note} values={values} />
                </p>
              </div>
            </li>
          ))}
        </ol>

        <Disclosure title="Why some characters look brighter" description="From a light dot to a dense block of ink.">
          <RampCalibration ramp={RAMPS[exp.ramp]} name={`The calibrated ramp · ${exp.ramp}`} />
          <p className="math-drawer__body">
            <MathText text={COVERAGE_NOTE} />
          </p>
          <p className="math-drawer__body">
            <MathText text={ASCII_PIPELINE} values={{ cells: <CellCount /> }} />
          </p>
        </Disclosure>
      </Section>

      <Section n="06" title="In the real world" order={5}>
        <p className="math-drawer__connection">{exp.realWorld}</p>
        {exp.realWorldMore && <p className="math-drawer__body">{exp.realWorldMore}</p>}
      </Section>

      <footer className="math-drawer__footer">
        <SubLabel>The central idea</SubLabel>
        <p className="mt-4 font-sans text-[21px] leading-[1.2] font-[560] tracking-[-0.03em] sm:text-[23px]">
          {CENTRAL_IDEA.map((line) => {
            const cut = line.lastIndexOf(' ');
            return (
              <span key={line} className="block">
                <span className="text-muted">{line.slice(0, cut + 1)}</span>
                <span className="text-ink">{line.slice(cut + 1)}</span>
              </span>
            );
          })}
        </p>
        <p className="math-drawer__footnote">Glyphfield · Math Odyssey 2026 · Math in Design</p>
      </footer>
    </>
  );
}

/** One "what changes what" line; its symbol flashes when that parameter changes. */
function EffectRow({ mode, effect }: { mode: ExperimentId; effect: EffectSpec }) {
  const ref = useParamFlash<HTMLSpanElement>([effect.param], mode);
  return (
    <li className="math-effect">
      <span ref={ref} className="math-effect__symbol">
        {effect.symbol ? <InlineMath src={effect.symbol} /> : <span className="font-mono text-faint">·</span>}
      </span>
      <p className="math-effect__description">
        <span className="math-effect__cause">
          <MathText text={effect.cause} />
        </span>
        <span className="math-effect__result"><MathText text={effect.effect} /></span>
      </p>
    </li>
  );
}

function presetMatches(preset: Preset, params: Readonly<ParamValues>): boolean {
  return Object.entries(preset.values).every(([key, value]) => {
    const current = params[key];
    return typeof value === 'number' && typeof current === 'number' ? Math.abs(current - value) < 1e-9 : current === value;
  });
}

function PresetGrid({ mode }: { mode: ExperimentId }) {
  const params = useGlyphStore((s) => s.params[mode]);
  const applyPreset = useGlyphStore((s) => s.applyPreset);
  return (
    <div className="math-presets">
      {PRESETS[mode].map((preset) => {
        const active = presetMatches(preset, params);
        return (
          <button
            key={preset.id}
            type="button"
            aria-pressed={active}
            onClick={() => applyPreset(mode, preset.values)}
            className={cx(
              'math-preset',
              active && 'math-preset--active',
            )}
          >
            <span className="math-preset__text">
              <span className="math-preset__label">{preset.label}{active && <span className="math-preset__active-label">Active</span>}</span>
              <span className="math-preset__description">{preset.description}</span>
            </span>
            {active ? <Check aria-hidden="true" size={17} strokeWidth={1.5} /> : <ArrowUpRight aria-hidden="true" size={17} strokeWidth={1.5} />}
          </button>
        );
      })}
    </div>
  );
}

/** The strokes a step can print, as glyph tiles. */
function GlyphTiles({ glyphs }: { glyphs: string }) {
  return (
    <span className="mt-2.5 flex gap-1.5" aria-label={`Glyphs: ${Array.from(glyphs).join(' ')}`}>
      {Array.from(glyphs, (g) => (
        <span
          key={g}
          aria-hidden="true"
          className="grid h-8 w-8 place-items-center rounded-[8px] border border-line bg-white/[0.025] font-mono text-[16px] text-ink"
        >
          {g}
        </span>
      ))}
    </span>
  );
}

/** One sample's value, level and glyph (its own 8 Hz subscription). */
const DrawerPipeline = memo(function DrawerPipeline({ mode, intensitySymbol }: { mode: ExperimentId; intensitySymbol: string }) {
  const { probe, stale } = useProbeFor(mode);
  return <PipelineStrip probe={probe} stale={stale} intensitySymbol={intensitySymbol} mode={mode} className="mt-3" />;
});

/** The live number of cells in the field (from the engine stats). */
const CellCount = memo(function CellCount() {
  const cells = useLiveStore((s) => s.stats.cols * s.stats.rows);
  return cells > 0 ? <span className="tabular font-mono text-[0.93em] text-mint">{cells.toLocaleString('en-US')}</span> : <>thousands of</>;
});
