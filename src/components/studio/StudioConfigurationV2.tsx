import { StudioWorkspaceV2 } from './StudioWorkspaceV2';
import { StudioConfigFormV2 } from './StudioConfigFormV2';
import { Card } from '@/components/ui/card';
import { useStudioConfig } from './hooks/useStudioConfig';
import type { StudioConfigV2 } from './types/studioConfig';

export { type StudioConfigV2 };

export const StudioConfigurationV2 = () => {
  const { config, saveConfiguration } = useStudioConfig();

  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Studio Configuration v2</h2>
          <StudioConfigFormV2 
            onUpdate={saveConfiguration}
            initialConfig={config}
          />
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Workspace Preview v2</h2>
          <StudioWorkspaceV2 
            config={config}
          />
        </Card>
      </div>
    </div>
  );
};