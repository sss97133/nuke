import React from 'react';

interface FilterPillsProps {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
}

const FilterPills: React.FC<FilterPillsProps> = ({ activeFilter, onFilterChange }) => {
  const filters = [
    { id: 'recent', label: 'Recent' },
    { id: 'for_sale', label: 'For Sale' },
    { id: 'projects', label: 'Projects' },
    { id: 'near_me', label: 'Near Me' },
  ];

  return (
    <nav
      style={{
        display: 'flex',
        gap: '8px',
        padding: '12px 0',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
      className="no-scrollbar"
    >
      {filters.map((filter) => (
        <button
          key={filter.id}
          onClick={() => onFilterChange(filter.id)}
          className="btn-utility"
          style={{
            background: activeFilter === filter.id ? 'var(--accent-dim)' : 'var(--surface)',
            color: activeFilter === filter.id ? 'var(--accent)' : 'var(--text)',
            fontWeight: activeFilter === filter.id ? 500 : 400,
          }}
        >
          {filter.label}
        </button>
      ))}
    </nav>
  );
};

export default FilterPills;

