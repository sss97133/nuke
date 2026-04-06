import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface Comment {
  id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
  target_type: string;
  target_label: string;
  user_email?: string;
  user_name?: string;
  avatar_url?: string;
  image_thumbnail?: string;
  [key: string]: any;
}

export function useVehicleAllComments(vehicleId: string) {
  return useQuery({
    queryKey: ['vehicle-all-comments', vehicleId],
    queryFn: async () => {
      const [vehicleComments, imageComments, eventComments, dataPointComments] = await Promise.all([
        supabase
          .from('vehicle_comments')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false }),
        supabase
          .from('vehicle_image_comments')
          .select('*, image:vehicle_images(thumbnail_url)')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false }),
        supabase
          .from('timeline_event_comments')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false }),
        supabase
          .from('data_point_comments')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false })
      ]);

      const allComments: Comment[] = [];

      if (vehicleComments.data) {
        allComments.push(...vehicleComments.data.map(c => ({
          ...c,
          target_type: 'vehicle',
          target_label: 'General Comment',
          user_email: undefined,
          user_name: undefined,
          avatar_url: undefined
        })));
      }

      if (imageComments.data) {
        allComments.push(...imageComments.data.map((c: any) => ({
          ...c,
          target_type: 'image',
          target_label: 'Vehicle Image',
          image_thumbnail: c.image?.thumbnail_url,
          user_email: undefined,
          user_name: undefined,
          avatar_url: undefined
        })));
      }

      if (eventComments.data) {
        allComments.push(...eventComments.data.map(c => ({
          ...c,
          target_type: 'event',
          target_label: 'Timeline Event',
          user_email: undefined,
          user_name: undefined,
          avatar_url: undefined
        })));
      }

      if (dataPointComments.data) {
        allComments.push(...dataPointComments.data.map(c => ({
          ...c,
          target_type: 'data_point',
          target_label: `${c.data_point_type ? c.data_point_type.charAt(0).toUpperCase() + c.data_point_type.slice(1) : 'Data Point'}: ${c.data_point_value || 'N/A'}`,
          user_email: undefined,
          user_name: undefined,
          avatar_url: undefined
        })));
      }

      // Enrich with profiles
      const uniqueUserIds = Array.from(new Set(allComments.map(c => c.user_id).filter(Boolean)));
      if (uniqueUserIds.length > 0) {
        try {
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', uniqueUserIds as string[]);
          const byId: Record<string, { username?: string; avatar_url?: string }> = {};
          (profilesData || []).forEach((p: any) => { byId[p.id] = { username: p.username, avatar_url: p.avatar_url }; });
          allComments.forEach(c => {
            const p = c.user_id ? byId[c.user_id] : undefined;
            if (p) {
              c.user_name = p.username || undefined;
              c.avatar_url = p.avatar_url || c.avatar_url;
            }
          });
        } catch {
          // Ignore enrichment failure
        }
      }

      allComments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return allComments;
    },
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
  });
}

export type { Comment as VehicleComment };
