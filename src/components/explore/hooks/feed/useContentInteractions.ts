import { useMutation, useQueryClient, QueryKey } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { invokeFunction } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface InteractionInput {
  contentId: string;
  contentType: string;
  interactionType: 'view' | 'like' | 'share' | 'save' | 'comment';
  details?: Record<string, any>;
}

type InteractionResponse = void | { message?: string };

export const useContentInteractions = () => {
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const mutation = useMutation<InteractionResponse, Error, InteractionInput>(
    {
      mutationFn: async (interactionData: InteractionInput) => {
        if (!user) {
          console.log('User not authenticated, skipping interaction tracking inside mutation.');
          throw new Error("User not authenticated");
        }
        
        console.log('Tracking interaction via Edge Function for user:', user.id, interactionData);
        
        const { error } = await invokeFunction(
          'track-content-interaction',
          { ...interactionData }
        );

        if (error) {
          throw error;
        }
        return;
      },
      onSuccess: () => {
        console.log('Interaction tracked successfully, invalidating queries...');
        const feedQueryKey: QueryKey = ['exploreFeed'];
        const detailsQueryKey: QueryKey = ['contentDetails'];
        queryClient.invalidateQueries({ queryKey: feedQueryKey });
        queryClient.invalidateQueries({ queryKey: detailsQueryKey });
      },
      onError: (error) => {
        console.error('Failed to track content interaction via Edge Function:', error);
        toast({
          title: "Interaction Error",
          description: error.message || "Could not record interaction.",
          variant: "destructive",
        });
      },
    }
  );

  const trackInteraction = (interactionData: InteractionInput) => {
    if (authLoading) {
        console.log("Auth state still loading, cannot track interaction yet.");
        toast({ description: "Please wait, session loading...", variant: "default"});
        return;
    }
    if (!user) {
        console.log("User not logged in, cannot track interaction.");
        toast({ description: "Please log in to record interaction.", variant: "default"});
        return;
    }
    mutation.mutate(interactionData);
  };

  return { 
    trackInteraction, 
    isPending: mutation.isPending, 
    error: mutation.error 
  };
};
