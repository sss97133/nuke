import React from 'react';

interface VehicleScoresWidgetProps {
  vehicle: any;
}

interface ScoreConfig {
  label: string;
  field: string;
  getValue: (v: any) => number | null;
  format: (v: number) => string;
  maxValue: number;
}

const SCORES: ScoreConfig[] = [
  {
    label: 'Condition',
    field: 'vehicles.condition_rating',
    getValue: (v) => v?.condition_rating ?? null,
    format: (v) => `${v}/10`,
    maxValue: 10,
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

const VehicleScoresWidget: React.FC<VehicleScoresWidgetProps> = ({ vehicle }) => {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <div className={`widget ${collapsed ? 'widget--collapsed' : ''}`} id="widgetScores">
      <div className="widget__header">
        <div className="widget__header-left">
          <span className="widget__label">Vehicle Scores</span>
          <span className="widget__db">
            DB
            <span className="widget__db-tooltip">
              vehicles.condition_rating · vehicles.value_score · vehicles.investment_quality_score · vehicles.provenance_score · vehicles.overall_desirability_score
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
          const val = score.getValue(vehicle);
          const pct = val != null ? (val / score.maxValue) * 100 : 0;
          return (
            <div className="score-row" key={score.field}>
              <div className="score-row__label">{score.label}</div>
              <div className="score-row__bar">
                <div className="score-row__bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <div
                className={`score-row__value ${val == null ? 'score-row__value--null' : ''}`}
                data-field={score.field}
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
