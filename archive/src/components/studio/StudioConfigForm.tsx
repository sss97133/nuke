
import React from 'react';
import { DimensionsForm } from './form/DimensionsForm';
import { TracksForm } from './form/TracksForm';
import { FormSubmitButton } from './form/FormSubmitButton';
import { useStudioConfigForm } from './form/useStudioConfigForm';
import type { StudioConfigFormProps } from './types/componentTypes';

export const StudioConfigForm: React.FC<StudioConfigFormProps> = ({ 
  initialData,
  onUpdate
}) => {
  const {
    formData,
    handleSubmit,
    handleDimensionChange,
    handleTrackChange,
    addTrack,
    removeTrack
  } = useStudioConfigForm(initialData, onUpdate);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <DimensionsForm
        length={formData.length}
        width={formData.width}
        height={formData.height}
        handleDimensionChange={handleDimensionChange}
      />
      
      <TracksForm
        tracks={formData.ptzTracks}
        handleTrackChange={handleTrackChange}
        addTrack={addTrack}
        removeTrack={removeTrack}
      />
      
      <FormSubmitButton />
    </form>
  );
};
