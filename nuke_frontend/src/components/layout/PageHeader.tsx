import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

interface PageHeaderProps {
  title?: string;
  showBackButton?: boolean;
  primaryAction?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  };
  breadcrumbs?: Array<{
    label: string;
    path?: string;
  }>;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, showBackButton, primaryAction, breadcrumbs }) => {
  const navigate = useNavigate();

  if (!title && !breadcrumbs && !showBackButton && !primaryAction) return null;

  return (
    <div className="page-header">
      <div className="page-header-content">
        <div className="page-header-left">
          {showBackButton && (
            <button
              onClick={() => {
                if (window.history.length > 1) {
                  try { navigate(-1); } catch { navigate('/'); }
                } else {
                  navigate('/');
                }
              }}
              className="button button-secondary back-button"
            >
              ← Back
            </button>
          )}

          <div className="page-title-section">
            {breadcrumbs && (
              <nav className="breadcrumbs" aria-label="Breadcrumb">
                {breadcrumbs.map((crumb, index) => (
                  <span key={index} className="breadcrumb">
                    {crumb.path ? (
                      <Link to={crumb.path}>{crumb.label}</Link>
                    ) : (
                      <span>{crumb.label}</span>
                    )}
                    {index < breadcrumbs.length - 1 && <span className="breadcrumb-separator">→</span>}
                  </span>
                ))}
              </nav>
            )}
            {title && <h1 className="page-title">{title}</h1>}
          </div>
        </div>

        {primaryAction && (
          <div className="page-header-right">
            <button
              onClick={primaryAction.onClick}
              className={`button ${primaryAction.variant === 'secondary' ? 'button-secondary' : 'button-primary'}`}
            >
              {primaryAction.label}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
