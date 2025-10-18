import { supabase } from '../lib/supabase';

export interface Comment {
  id: string;
  event_id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
  updated_at: string;
  user_profile?: {
    username: string;
    avatar_url?: string;
  };
}

export interface AccessLevel {
  canComment: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canModerate: boolean;
}

export class CommentService {
  // Determine user access level for a timeline event
  static getAccessLevel(
    currentUserId: string,
    eventCreatorId: string,
    vehicleOwnerId: string,
    commentAuthorId?: string
  ): AccessLevel {
    const isOwner = currentUserId === vehicleOwnerId;
    const isCreator = currentUserId === eventCreatorId;
    const isCommentAuthor = commentAuthorId ? currentUserId === commentAuthorId : false;

    return {
      canComment: true, // Everyone can comment
      canEdit: isCommentAuthor, // Only comment author can edit their comments
      canDelete: isCommentAuthor || isOwner, // Comment author or vehicle owner can delete
      canModerate: isOwner, // Only vehicle owner can moderate (hide/pin comments)
    };
  }

  // Get comments for a timeline event
  static async getEventComments(eventId: string): Promise<{ success: boolean; data?: Comment[]; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('timeline_event_comments')
        .select(`
          id,
          event_id,
          user_id,
          comment_text,
          created_at,
          updated_at,
          user_profile:auth.users(id, raw_user_meta_data)
        `)
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const comments = data?.map((comment: any) => ({
        ...comment,
        user_profile: {
          username: comment.user_profile?.raw_user_meta_data?.username || 'Anonymous',
          avatar_url: comment.user_profile?.raw_user_meta_data?.avatar_url,
        }
      })) || [];

      return { success: true, data: comments };
    } catch (error) {
      console.error('Error fetching comments:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch comments' };
    }
  }

  // Add a comment to a timeline event
  static async addComment(
    eventId: string,
    commentText: string,
    userId: string
  ): Promise<{ success: boolean; data?: Comment; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('timeline_event_comments')
        .insert({
          event_id: eventId,
          user_id: userId,
          comment_text: commentText.trim(),
        })
        .select(`
          id,
          event_id,
          user_id,
          comment_text,
          created_at,
          updated_at
        `)
        .single();

      if (error) throw error;

      return { success: true, data: data as Comment };
    } catch (error) {
      console.error('Error adding comment:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to add comment' };
    }
  }

  // Update a comment
  static async updateComment(
    commentId: string,
    commentText: string,
    userId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('timeline_event_comments')
        .update({
          comment_text: commentText.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', commentId)
        .eq('user_id', userId); // Ensure user can only update their own comments

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error updating comment:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to update comment' };
    }
  }

  // Delete a comment
  static async deleteComment(
    commentId: string,
    userId: string,
    isVehicleOwner: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    try {
      let query = supabase
        .from('timeline_event_comments')
        .delete()
        .eq('id', commentId);

      // Vehicle owners can delete any comment, others can only delete their own
      if (!isVehicleOwner) {
        query = query.eq('user_id', userId);
      }

      const { error } = await query;

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error deleting comment:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete comment' };
    }
  }

  // Add notes/context to a timeline event (enhanced description)
  static async updateEventNotes(
    eventId: string,
    notes: string,
    userId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('vehicle_timeline_events')
        .update({
          description: notes.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', eventId)
        .eq('user_id', userId); // Only event creator can update notes

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error updating event notes:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to update notes' };
    }
  }
}
