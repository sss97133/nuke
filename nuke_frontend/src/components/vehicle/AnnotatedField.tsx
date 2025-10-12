import React, { useState } from 'react';
import type { DataSource, FieldAnnotation } from '../../types/dataSource';
import DataSourcePopover from './DataSourcePopover';
import './AnnotatedField.css';

interface AnnotatedFieldProps {
  fieldName: string;
  value: string | number | null;
  vehicleId: string;
  annotation?: FieldAnnotation;
  className?: string;
  displayFormat?: 'text' | 'number' | 'date';
  unit?: string;
  placeholder?: string;
}

const AnnotatedField: React.FC<AnnotatedFieldProps> = ({
  fieldName,
  value,
  vehicleId,
  annotation,
  className = '',
  displayFormat = 'text',
  unit,
  placeholder = 'Not specified'
}) => {
  const [showPopover, setShowPopover] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });

  const formatValue = (val: string | number | null): string => {
    if (val === null || val === undefined || val === '') {
      return placeholder;
    }

    switch (displayFormat) {
      case 'number':
        return typeof val === 'number' ? val.toLocaleString() : String(val);
      case 'date':
        return new Date(String(val)).toLocaleDateString();
      default:
        return String(val);
    }
  };

  const getVerificationIndicator = (): string => {
    if (!annotation) return '';
    
    switch (annotation.verificationLevel) {
      case 'multi_verified':
        return '✓✓';
      case 'professional':
        return '✓';
      case 'basic':
        return '○';
      default:
        return '';
    }
  };

  const getFieldClassName = (): string => {
    let baseClass = 'annotated-field';
    
    if (annotation) {
      baseClass += ' has-annotation';
      
      if (annotation.conflictingSources && annotation.conflictingSources.length > 0) {
        baseClass += ' has-conflicts';
      }
      
      switch (annotation.verificationLevel) {
        case 'multi_verified':
          baseClass += ' verified-multi';
          break;
        case 'professional':
          baseClass += ' verified-professional';
          break;
        case 'basic':
          baseClass += ' verified-basic';
          break;
        default:
          baseClass += ' unverified';
      }
    }
    
    return `${baseClass} ${className}`;
  };

  const handleClick = (event: React.MouseEvent) => {
    if (!annotation) return;
    
    const rect = event.currentTarget.getBoundingClientRect();
    setPopoverPosition({
      x: rect.left + rect.width / 2,
      y: rect.bottom + 8
    });
    setShowPopover(true);
  };

  const displayValue = formatValue(value);
  const verificationIndicator = getVerificationIndicator();

  return (
    <>
      <span
        className={getFieldClassName()}
        onClick={handleClick}
        style={{ cursor: annotation ? 'pointer' : 'default' }}
        title={annotation ? 'Click to view data sources' : undefined}
      >
        {displayValue}
        {unit && value !== null && ` ${unit}`}
        {verificationIndicator && (
          <span className="verification-indicator">{verificationIndicator}</span>
        )}
        {annotation?.conflictingSources && annotation.conflictingSources.length > 0 && (
          <span className="conflict-indicator">⚠</span>
        )}
      </span>

      {showPopover && annotation && (
        <DataSourcePopover
          annotation={annotation}
          position={popoverPosition}
          onClose={() => setShowPopover(false)}
        />
      )}
    </>
  );
};

export default AnnotatedField;
