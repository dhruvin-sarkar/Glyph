import type { ExperimentId } from '../../engine/types';
import { AttractorEquation } from './AttractorEquation';
import { TopologyEquation } from './TopologyEquation';
import { WaveEquation, type LiveEquationProps } from './WaveEquation';
import '../../styles/math-panels.css';

/** The live, substituted equation of an experiment. */
export function LiveEquation({ mode, ...props }: LiveEquationProps & { mode: ExperimentId }) {
  switch (mode) {
    case 'waves':
      return <WaveEquation {...props} />;
    case 'attractor':
      return <AttractorEquation {...props} />;
    case 'topology':
      return <TopologyEquation {...props} />;
  }
}
