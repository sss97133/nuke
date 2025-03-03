
import React from 'react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Comment } from './types';
import { VerificationBadge, InfluencerBadge } from './CommentBadges';

interface CommentReplyProps {
  reply: Comment;
}

const CommentReply: React.FC<CommentReplyProps> = ({ reply }) => {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <div className="flex items-center">
          <Avatar className="h-6 w-6 mr-2">
            <AvatarImage src={reply.user.avatar || undefined} />
            <AvatarFallback>{reply.user.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center">
              <span className="font-medium text-sm">{reply.user.name}</span>
              <VerificationBadge level={reply.user.verificationLevel} />
              {reply.user.isInfluencer && <InfluencerBadge />}
            </div>
            <span className="text-xs text-muted-foreground">{reply.timestamp}</span>
          </div>
        </div>
        <div>
          <Button size="sm" variant="ghost" className="h-6 px-2">
            {reply.likes} ❤️
          </Button>
        </div>
      </div>
      <p className="text-sm">{reply.text}</p>
    </div>
  );
};

export default CommentReply;
