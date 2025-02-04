import React, { useState } from 'react';
import { StudioWorkspace } from './StudioWorkspace';
import { StudioConfigForm } from './StudioConfigForm';
import { Card } from '@/components/ui/card';

export const StudioConfiguration = () => {
  const [dimensions] = useState({
    length: 30,
    width: 20,
    height: 16,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Studio Configuration</h2>
          <StudioConfigForm />
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Workspace Preview</h2>
          <StudioWorkspace dimensions={dimensions} />
        </Card>
      </div>
    </div>
  );
};