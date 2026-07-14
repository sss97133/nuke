import React from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import { supabase } from '../../lib/supabase';

interface ScoreConfig {
  label: string;
  field: string;
  getValue: (v: any) => number | null;
  format: (v: number) => string;
  maxValue: number;
}

const SCORES: ScoreConfig[] = [
  {
    // Reads the Eye's rollup (vehicle_condition_scores), not the dead
    // vehicles.condition_rating column — injected in the component below.
    label: 'Condition',
    field: 'vehicle_condition_scores.condition_score',
    getValue: (v) => v?.condition_rating != null ? v.condition_rating * 10 : null,
    format: (v) => `${Math.round(v)}/100`,
    maxValue: 100,
  },
  {
    label: 'Value Score',
    field: 'vehicles.value_score',
    getValue: (v) => v?.value_score ?? null,
    format: (v) => String(v),
    maxValue: 100,
  },
  {
    label: 'Investment Quality',
    field: 'vehicles.investment_quality_score',
    getValue: (v) => v?.investment_quality_score ?? null,
    format: (v) => String(v),
    maxValue: 100,
  },
  {
    label: 'Provenance',
    field: 'vehicles.provenance_score',
    getValue: (v) => v?.provenance_score ?? null,
    format: (v) => String(v),
    maxValue: 100,
  },
  {
    label: 'Desirability',
    field: 'vehicles.overall_desirability_score',
    getValue: (v) => v?.overall_desirability_score ?? null,
    format: (v) => String(v),
    maxValue: 100,
  },
];

const VehicleScoresWidget: React.FC = () => {
  const { vehicle } = useVehicleProfile();
  const [collapsed, setCollapsed] = React.useState(false);
  const [eyeCondition, setEyeCondition] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!vehicle?.id) return;
    let alive = true;
    supabase
      .from('vehicle_condition_scores')
      .select('condition_score')
      .eq('vehicle_id', vehicle.id)
      .maybeSingle()
      .then(({ data }) => {
        if (alive && data?.condition_score != null) setEyeCondition(Number(data.condition_score));
      });
    return () => { alive = false; };
  }, [vehicle?.id]);

  const valueFor = (score: ScoreConfig) =>
    score.field === 'vehicle_condition_scores.condition_score' && eyeCondition != null
      ? eyeCondition
      : score.getValue(vehicle);

  // Don't render if all scores are null
  const hasAnyScore = SCORES.some((score) => valueFor(score) != null);
  if (!hasAnyScore) return null;

  return (
    <div className={`widget ${collapsed ? 'widget--collapsed' : ''}`} id="widgetScores">
      <div className="widget__header">
        <div className="widget__header-left">
          <span className="widget__label">Vehicle Scores</span>
          <span className="widget__db">
            DB
            <span className="widget__db-tooltip">
              Condition · Value · Investment Quality · Provenance · Desirability
            </span>
          </span>
        </div>
        <div className="widget__controls">
          <button
            className="widget__toggle"
            onClick={() => setCollapsed(!collapsed)}
            title="Toggle"
          >
            {collapsed ? '▶' : '▼'}
          </button>
        </div>
      </div>
      <div className="widget__body">
        {SCORES.map((score) => {
          const val = valueFor(score);
          const pct = val != null ? (val / score.maxValue) * 100 : 0;
          return (
            <div className="score-row" key={score.field}>
              <div className="score-row__label">{score.label}</div>
              <div className="score-row__bar">
                <div className="score-row__bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <div
                className={`score-row__value ${val == null ? 'score-row__value--null' : ''}`}
              >
                {val != null ? score.format(val) : '--'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VehicleScoresWidget;
