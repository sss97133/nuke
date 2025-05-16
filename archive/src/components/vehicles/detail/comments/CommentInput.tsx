
import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EyeOff, Send } from "lucide-react";
import { VerificationBadge } from './CommentBadges';

interface CommentInputProps {
  commentText: string;
  setCommentText: (text: string) => void;
  handleSubmitComment: () => void;
}

const CommentInput: React.FC<CommentInputProps> = ({ 
  commentText, 
  setCommentText, 
  handleSubmitComment 
}) => {
  return (
    <div className="w-full space-y-2">
      <div className="border rounded-md p-2">
        <div className="flex justify-between mb-2">
          <div className="flex items-center">
            <Avatar className="h-6 w-6 mr-2">
              <AvatarFallback>U</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium">Posting as Current User</span>
            <VerificationBadge level="basic" />
          </div>
          <Button size="sm" variant="ghost">
            <EyeOff className="h-4 w-4 mr-1" />
            Make Private
          </Button>
        </div>
        <Textarea
          placeholder="Add your comment about this vehicle..."
          className="resize-none"
          rows={3}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <Button onClick={handleSubmitComment} disabled={!commentText.trim()}>
          <Send className="h-4 w-4 mr-2" />
          Post Comment
        </Button>
      </div>
    </div>
  );
};

export default CommentInput;
