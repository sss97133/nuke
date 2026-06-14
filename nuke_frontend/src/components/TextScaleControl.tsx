import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import type { TextScale } from '../contexts/ThemeContext';

/**
 * TextScaleControl — A− / A / A+ segmented control for the global text scale.
 *
 * Drives ThemeContext.textScale (persisted to localStorage `uiTextScale`),
 * which sets --font-scale on :root; all --fs-* tokens multiply it.
 * Steps: 0.9 / 1.0 / 1.1 / 1.2.
 *
 * variant="full"    — label + A− A A+ + current % (settings drawer)
 * variant="compact" — A− A+ icon buttons only (sub-header right end)
 */

const STEPS: TextScale[] = [0.9, 1, 1.1, 1.2];

interface TextScaleControlProps {
  variant?: 'full' | 'compact';
}

const TextScaleControl: React.FC<TextScaleControlProps> = ({ variant = 'full' }) => {
  const { textScale, setTextScale } = useTheme();

  const idx = STEPS.indexOf(textScale);
  const canDec = idx > 0;
  const canInc = idx >= 0 && idx < STEPS.length - 1;

  const dec = () => {
    if (canDec) setTextScale(STEPS[idx - 1]);
  };
  const inc = () => {
    if (canInc) setTextScale(STEPS[idx + 1]);
  };
  const reset = () => setTextScale(1);

  if (variant === 'compact') {
    return (
      <span className="up-textscale up-textscale--compact" title="TEXT SIZE">
        <span className="up-textscale__seg">
          <button
            type="button"
            className="up-textscale__btn"
            onClick={dec}
            disabled={!canDec}
            aria-label="Decrease text size"
          >
            A&minus;
          </button>
          <button
            type="button"
            className="up-textscale__btn"
            onClick={inc}
            disabled={!canInc}
            aria-label="Increase text size"
          >
            A+
          </button>
        </span>
      </span>
    );
  }

  return (
    <div className="up-textscale">
      <span className="up-textscale__label">TEXT SIZE</span>
      <span className="up-textscale__seg">
        <button
          type="button"
          className="up-textscale__btn"
          onClick={dec}
          disabled={!canDec}
          aria-label="Decrease text size"
        >
          A&minus;
        </button>
        <button
          type="button"
          className={`up-textscale__btn${textScale === 1 ? ' up-textscale__btn--active' : ''}`}
          onClick={reset}
          aria-label="Reset text size"
        >
          A
        </button>
        <button
          type="button"
          className="up-textscale__btn"
          onClick={inc}
          disabled={!canInc}
          aria-label="Increase text size"
        >
          A+
        </button>
      </span>
      <span className="up-textscale__value">{Math.round(textScale * 100)}%</span>
    </div>
  );
};

export default TextScaleControl;
