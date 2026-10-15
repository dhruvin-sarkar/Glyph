import { cx } from '../ui/primitives';
import '../../styles/controls.css';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  /** accessible name when no <label htmlFor> points at this switch */
  label?: string;
  describedBy?: string;
  className?: string;
}

/**
 * A 34 × 20 switch (role="switch"). Associate a <label htmlFor={id}> to name it
 * and make the label clickable; the invisible ::before extends the hit area to 44 × 40.
 */
export default function Toggle({ checked, onChange, id, label, describedBy, className }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      className={cx('gf-switch', className)}
      onClick={() => onChange(!checked)}
    >
      <span className="gf-switch-dot" aria-hidden="true" />
    </button>
  );
}
