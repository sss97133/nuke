import React from 'react';

interface YearSwitcherProps {
  years: number[];
  year: number;
  onChange: (y: number) => void;
}

const YearSwitcher: React.FC<YearSwitcherProps> = ({ years, year, onChange }) => {
  if (!years || years.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      {years.map(y => (
        <button
          key={y}
          className={`button button-small ${y === year ? 'button-primary' : ''}`}
          onClick={() => onChange(y)}
          title={`Show ${y}`}
        >
          {y}
        </button>
      ))}
    </div>
  );
};

export default YearSwitcher;
