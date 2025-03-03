
import React from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Comment } from './types';
import { VerificationBadge, InfluencerBadge, PrivateBadge } from './CommentBadges';
import CommentReply from './CommentReply';

interface CommentItemProps {
  comment: Comment;
}

const CommentItem: React.FC<CommentItemProps> = ({ comment }) => {
  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex justify-between">
        <div className="flex items-center">
          <Avatar className="h-8 w-8 mr-2">
            <AvatarImage src={comment.user.avatar || undefined} />
            <AvatarFallback>{comment.user.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center">
              <span className="font-medium">{comment.user.name}</span>
              <VerificationBadge level={comment.user.verificationLevel} />
              {comment.user.isInfluencer && <InfluencerBadge />}
              {comment.isPrivate && <PrivateBadge />}
            </div>
            <span className="text-xs text-muted-foreground">{comment.timestamp}</span>
          </div>
        </div>
        <div>
          <Button size="sm" variant="ghost">
            {comment.likes} ❤️
          </Button>
        </div>
      </div>
      
      <p className="text-sm">{comment.text}</p>
      
      {comment.replies.length > 0 && (
        <div className="pl-4 border-l-2 border-gray-200 space-y-4 mt-4">
          {comment.replies.map((reply) => (
            <CommentReply key={reply.id} reply={reply} />
          ))}
        </div>
      )}
      
      <div className="pt-2">
        <Button variant="ghost" size="sm">Reply</Button>
      </div>
    </div>
  );
};

export default CommentItem;
