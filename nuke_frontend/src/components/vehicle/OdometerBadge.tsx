import React, { useMemo } from 'react';

type OdometerBadgeProps = {
  mileage: number;
  year?: number | null;
  isExact?: boolean;
  className?: string;
};

function clampDigitsCount(mileage: number, year?: number | null) {
  const abs = Math.max(0, Math.floor(Math.abs(mileage || 0)));
  // Most classic mechanical odometers are 5 digits; modern are often 6+.
  if (abs >= 100000) return 6;
  // Heuristic: by ~1990 most vehicles are 6-digit odometers (or at least display 6 places).
  if (typeof year === 'number' && year >= 1990) return 6;
  return 5;
}

function formatCompactK(mileage: number) {
  const abs = Math.max(0, Math.floor(Math.abs(mileage || 0)));
  if (abs < 1000) return `${abs}`;
  const k = abs / 1000;
  if (k < 100) return `${Math.round(k)}k`;
  return `${Math.round(abs / 1000)}k`;
}

export const OdometerBadge: React.FC<OdometerBadgeProps> = ({
  mileage,
  year,
  isExact = true,
  className = '',
}) => {
  const digitsCount = useMemo(() => clampDigitsCount(mileage, year), [mileage, year]);
  const absMileageInt = useMemo(() => Math.max(0, Math.floor(Math.abs(mileage || 0))), [mileage]);
  const digits = useMemo(() => {
    return String(absMileageInt).padStart(digitsCount, '0').slice(-digitsCount);
  }, [absMileageInt, digitsCount]);

  const variant: 'digital' | 'mechanical' = typeof year === 'number' && year >= 2004 ? 'digital' : 'mechanical';
  const exactText = `${absMileageInt.toLocaleString()} miles`;
  const approxText = `${formatCompactK(mileage)} miles (approx)`;

  return (
    <span
      className={`odometer-badge odometer-badge--${variant} ${className}`.trim()}
      title={isExact ? exactText : approxText}
      aria-label={isExact ? `Mileage: ${exactText}` : `Mileage: ${approxText}`}
      data-mileage={absMileageInt}
      data-mileage-exact={isExact ? 'true' : 'false'}
    >
      <span className="odometer-badge__digits" aria-hidden="true">
        {digits.split('').map((d, idx) => (
          <span key={`${idx}-${d}`} className="odometer-badge__digit">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
};


