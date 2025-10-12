import React, { useState, useEffect } from 'react';
import type { CommentService } from '../services/CommentService';
import type { Comment, AccessLevel } from '../services/CommentService';

interface TimelineEventCommentsProps {
  eventId: string;
  currentUser: { id: string; username?: string } | null;
  eventCreatorId: string;
  vehicleOwnerId: string;
  isExpanded: boolean;
  onToggle: () => void;
}

const TimelineEventComments: React.FC<TimelineEventCommentsProps> = ({
  eventId,
  currentUser,
  eventCreatorId,
  vehicleOwnerId,
  isExpanded,
  onToggle
}) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const accessLevel: AccessLevel = currentUser 
    ? CommentService.getAccessLevel(currentUser.id, eventCreatorId, vehicleOwnerId)
    : { canComment: false, canEdit: false, canDelete: false, canModerate: false };

  const loadComments = async () => {
    if (!isExpanded) return;
    
    setLoading(true);
    const result = await CommentService.getEventComments(eventId);
    if (result.success && result.data) {
      setComments(result.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadComments();
  }, [eventId, isExpanded]);

  const handleAddComment = async () => {
    if (!currentUser || !newComment.trim() || submitting) return;

    setSubmitting(true);
    const result = await CommentService.addComment(eventId, newComment, currentUser.id);
    
    if (result.success) {
      setNewComment('');
      await loadComments();
    } else {
      alert(result.error || 'Failed to add comment');
    }
    setSubmitting(false);
  };

  const handleEditComment = async (commentId: string) => {
    if (!currentUser || !editingText.trim() || submitting) return;

    setSubmitting(true);
    const result = await CommentService.updateComment(commentId, editingText, currentUser.id);
    
    if (result.success) {
      setEditingCommentId(null);
      setEditingText('');
      await loadComments();
    } else {
      alert(result.error || 'Failed to update comment');
    }
    setSubmitting(false);
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!currentUser || submitting) return;
    if (!confirm('Delete this comment?')) return;

    setSubmitting(true);
    const isOwner = currentUser.id === vehicleOwnerId;
    const result = await CommentService.deleteComment(commentId, currentUser.id, isOwner);
    
    if (result.success) {
      await loadComments();
    } else {
      alert(result.error || 'Failed to delete comment');
    }
    setSubmitting(false);
  };

  const startEdit = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setEditingText(comment.comment_text);
  };

  const cancelEdit = () => {
    setEditingCommentId(null);
    setEditingText('');
  };

  const getAccessLevelForComment = (commentAuthorId: string): AccessLevel => {
    return currentUser 
      ? CommentService.getAccessLevel(currentUser.id, eventCreatorId, vehicleOwnerId, commentAuthorId)
      : { canComment: false, canEdit: false, canDelete: false, canModerate: false };
  };

  const commentCount = comments.length;

  return (
    <div className="mt-2">
      {/* Comments are now shown by clicking the whole event card */}
      {isExpanded && (
        <div className="mt-2 pl-4 border-l-2 border-gray-100">
          {/* Loading state */}
          {loading && (
            <div className="text-xs text-gray-500 py-2">Loading comments...</div>
          )}

          {/* Comments list */}
          {!loading && comments.length > 0 && (
            <div className="space-y-2 mb-3">
              {comments.map((comment) => {
                const commentAccess = getAccessLevelForComment(comment.user_id);
                const isEditing = editingCommentId === comment.id;

                return (
                  <div key={comment.id} className="bg-gray-50 rounded p-2 text-xs">
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-700">
                          @{comment.user_profile?.username || 'user'}
                        </span>
                        {comment.user_id === vehicleOwnerId && (
                          <span className="bg-blue-100 text-blue-700 px-1 rounded text-xs">Owner</span>
                        )}
                        {comment.user_id === eventCreatorId && comment.user_id !== vehicleOwnerId && (
                          <span className="bg-green-100 text-green-700 px-1 rounded text-xs">Creator</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500">
                          {new Date(comment.created_at).toLocaleDateString()}
                        </span>
                        {commentAccess.canEdit && !isEditing && (
                          <button
                            onClick={() => startEdit(comment)}
                            className="text-gray-400 hover:text-gray-600 ml-1"
                            title="Edit comment"
                          >
                            Edit
                          </button>
                        )}
                        {commentAccess.canDelete && (
                          <button
                            onClick={() => handleDeleteComment(comment.id)}
                            className="text-gray-400 hover:text-red-600 ml-1"
                            title="Delete comment"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>

                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          className="w-full text-xs border rounded p-1 resize-none"
                          rows={2}
                          placeholder="Edit your comment..."
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleEditComment(comment.id)}
                            disabled={submitting || !editingText.trim()}
                            className="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="bg-gray-300 text-gray-700 px-2 py-1 rounded text-xs hover:bg-gray-400"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-700 whitespace-pre-wrap">
                        {comment.comment_text}
                      </div>
                    )}

                    {comment.updated_at !== comment.created_at && !isEditing && (
                      <div className="text-gray-400 text-xs mt-1">
                        (edited {new Date(comment.updated_at).toLocaleDateString()})
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* No comments message */}
          {!loading && comments.length === 0 && (
            <div className="text-xs text-gray-500 py-2">No comments yet</div>
          )}

          {/* Add comment form */}
          {accessLevel.canComment && currentUser && (
            <div className="space-y-2">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                className="w-full text-xs border rounded p-2 resize-none"
                rows={2}
                placeholder="Add a comment..."
                disabled={submitting}
              />
              <button
                onClick={handleAddComment}
                disabled={submitting || !newComment.trim()}
                className="bg-primary text-white px-3 py-1 rounded text-xs hover:bg-primary-dark disabled:opacity-50"
              >
                {submitting ? 'Adding...' : 'Comment'}
              </button>
            </div>
          )}

          {/* Login prompt for non-authenticated users */}
          {!currentUser && (
            <div className="text-xs text-gray-500 py-2">
              Sign in to add comments
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TimelineEventComments;
