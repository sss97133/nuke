import React, { useState } from 'react';
import type { EditableField } from './EditableField';
import type { EditableFieldProps } from './EditableField';

export interface EditableSectionProps {
  title: string;
  description?: string;
  fields: EditableFieldProps[];
  disabled?: boolean;
}

const EditableSection: React.FC<EditableSectionProps> = ({ title, description, fields, disabled }) => {
  return (
    <section className="card mb-3">
      <div className="card-body p-3">
        <div className="mb-2">
          <h3 className="text-sm font-semibold mb-1">{title}</h3>
          {description && <p className="text-xs text-gray-600">{description}</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {fields.map((f) => (
            <EditableField key={f.name} {...f} disabled={disabled || f.disabled} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default EditableSection;
