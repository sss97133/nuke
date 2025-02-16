
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isWorkspaceDimensions, isPTZConfigurations } from '@/types/studio';
import type { WorkspaceDimensions, PTZConfigurations } from '@/types/studio';

export const useStudioConfig = (defaultDimensions: WorkspaceDimensions) => {
  return useQuery({
    queryKey: ['studioConfig'],
    queryFn: async () => {
      console.log('Fetching studio config...');
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('No user found');
        throw new Error('No user found');
      }
      
      const { data, error } = await supabase
        .from('studio_configurations')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching studio config:', error);
        throw error;
      }

      console.log('Studio config data:', data);

      let workspaceDims = defaultDimensions;
      if (data?.workspace_dimensions && isWorkspaceDimensions(data.workspace_dimensions)) {
        workspaceDims = data.workspace_dimensions;
      }

      let ptzConfig: PTZConfigurations = {
        tracks: [],
        planes: { walls: [], ceiling: {} },
        roboticArms: []
      };
      
      if (data?.ptz_configurations && isPTZConfigurations(data.ptz_configurations)) {
        ptzConfig = data.ptz_configurations;
      }

      return {
        id: data?.id || '',
        user_id: user.id,
        name: data?.name || '',
        workspace_dimensions: workspaceDims,
        ptz_configurations: ptzConfig,
        camera_config: data?.camera_config || {},
        audio_config: data?.audio_config || {},
        lighting_config: data?.lighting_config || {},
        fixed_cameras: data?.fixed_cameras || { positions: [] },
        created_at: data?.created_at || new Date().toISOString(),
        updated_at: data?.updated_at || new Date().toISOString()
      };
    }
  });
};
