import React from 'react';

interface SidebarCategory {
  id: string;
  label: string;
  count: number;
  icon: string;
  expanded?: boolean;
  children?: SidebarCategory[];
}

interface SidebarProps {
  categories: SidebarCategory[];
  selectedCategory?: string;
  onSelectCategory: (categoryId: string) => void;
  onToggleExpand: (categoryId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  categories,
  selectedCategory,
  onSelectCategory,
  onToggleExpand
}) => {
  const renderCategory = (category: SidebarCategory, level: number = 0) => {
    const isExpanded = category.expanded === true;
    const isSelected = selectedCategory === category.id;
    const hasChildren = category.children && category.children.length > 0;

    return (
      <div key={category.id}>
        <div
          style={{
            fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
            fontSize: '8pt',
            padding: '4px 8px',
            cursor: 'pointer',
            userSelect: 'none',
            background: isSelected ? '#f5f5f5' : 'transparent',
            paddingLeft: `${8 + level * 8}px`,
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          onClick={() => {
            if (hasChildren) {
              onToggleExpand(category.id);
            } else {
              onSelectCategory(category.id);
            }
          }}
          onMouseEnter={(e) => {
            if (!isSelected) {
              e.currentTarget.style.background = '#f8fafc';
            }
          }}
          onMouseLeave={(e) => {
            if (!isSelected) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          {hasChildren && (
            <span style={{ color: '#757575', minWidth: '8px' }}>
              {isExpanded ? '▼' : '▶'}
            </span>
          )}
          <span style={{ color: '#757575' }}>{category.icon}</span>
          <span style={{ flex: 1, color: isSelected ? '#000000' : '#424242' }}>
            {category.label}
          </span>
          {category.count > 0 && (
            <span style={{ color: '#9e9e9e', fontSize: '7pt' }}>
              ({category.count})
            </span>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div>
            {category.children!.map((child) => renderCategory(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        width: '200px',
        borderRight: '1px solid #bdbdbd',
        background: 'var(--surface)',
        height: '100%',
        overflowY: 'auto',
        fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
        fontSize: '8pt'
      }}
    >
      {categories.map((category) => renderCategory(category))}
    </div>
  );
};

