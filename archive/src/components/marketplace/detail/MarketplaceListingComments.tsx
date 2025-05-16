import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, ThumbsUp, Flag, Reply, Lock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { useAtom } from 'jotai';
import { authRequiredModalAtom } from '@/components/auth/AuthRequiredModal';

interface Comment {
  id: string;
  user: {
    id: string;
    name: string;
    avatar?: string;
    isSeller: boolean;
  };
  text: string;
  timestamp: string;
  likes: number;
  liked: boolean;
  replies: Comment[];
}

const mockComments: Comment[] = [
  {
    id: '1',
    user: {
      id: 'user1',
      name: 'Jane Smith',
      avatar: 'https://i.pravatar.cc/150?u=jane',
      isSeller: true,
    },
    text: 'Thank you for your interest in my car! It has been meticulously maintained and is in excellent mechanical condition. All maintenance has been done as scheduled and I have all service records available.',
    timestamp: '2025-02-20T10:30:00.000Z',
    likes: 3,
    liked: false,
    replies: []
  },
  {
    id: '2',
    user: {
      id: 'user2',
      name: 'John Doe',
      avatar: 'https://i.pravatar.cc/150?u=john',
      isSeller: false,
    },
    text: 'Has this car ever been in an accident or had any bodywork done?',
    timestamp: '2025-02-19T14:15:00.000Z',
    likes: 1,
    liked: false,
    replies: [
      {
        id: '2-1',
        user: {
          id: 'user1',
          name: 'Jane Smith',
          avatar: 'https://i.pravatar.cc/150?u=jane',
          isSeller: true,
        },
        text: 'No accidents or bodywork. I have a clean CarFax report that I can share with you.',
        timestamp: '2025-02-19T15:20:00.000Z',
        likes: 2,
        liked: false,
        replies: []
      }
    ]
  },
  {
    id: '3',
    user: {
      id: 'user3',
      name: 'Michael Chen',
      avatar: 'https://i.pravatar.cc/150?u=michael',
      isSeller: false,
    },
    text: 'What is the lowest price you would accept?',
    timestamp: '2025-02-18T09:45:00.000Z',
    likes: 0,
    liked: false,
    replies: [
      {
        id: '3-1',
        user: {
          id: 'user1',
          name: 'Jane Smith',
          avatar: 'https://i.pravatar.cc/150?u=jane',
          isSeller: true,
        },
        text: 'I believe the price is fair for the condition and mileage. I could consider reasonable offers, but I\'m not in a rush to sell.',
        timestamp: '2025-02-18T10:10:00.000Z',
        likes: 1,
        liked: false,
        replies: []
      }
    ]
  }
];

const CommentItem: React.FC<{ 
  comment: Comment; 
  onReply: (commentId: string) => void;
  onLike: (commentId: string) => void;
  isAuthenticated: boolean;
  onAuthRequired: (action: string) => void;
}> = ({ comment, onReply, onLike, isAuthenticated, onAuthRequired }) => {
  const handleReply = () => {
    if (!isAuthenticated) {
      onAuthRequired('comment');
      return;
    }
    onReply(comment.id);
  };
  
  const handleLike = () => {
    if (!isAuthenticated) {
      onAuthRequired('interact');
      return;
    }
    onLike(comment.id);
  };
  
  return (
    <div className="py-4">
      <div className="flex gap-3">
        <Avatar className="h-8 w-8">
          <AvatarImage src={comment.user.avatar} />
          <AvatarFallback>{comment.user.name.charAt(0)}</AvatarFallback>
        </Avatar>
        
        <div className="flex-1 space-y-1">
          <div className="flex items-center">
            <span className="font-medium text-sm">{comment.user.name}</span>
            {comment.user.isSeller && (
              <Badge variant="outline" className="ml-2 text-xs">Seller</Badge>
            )}
            <span className="ml-2 text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(comment.timestamp), { addSuffix: true })}
            </span>
          </div>
          
          <p className="text-sm">{comment.text}</p>
          
          <div className="flex items-center space-x-2 pt-1">
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 px-2 text-xs"
              onClick={handleLike}
            >
              <ThumbsUp 
                className="h-3.5 w-3.5 mr-1" 
                fill={comment.liked ? "currentColor" : "none"} 
              />
              {comment.likes > 0 && comment.likes}
            </Button>
            
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 px-2 text-xs"
              onClick={handleReply}
            >
              <Reply className="h-3.5 w-3.5 mr-1" />
              Reply
            </Button>
            
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 px-2 text-xs"
              onClick={() => isAuthenticated ? null : onAuthRequired('interact')}
            >
              <Flag className="h-3.5 w-3.5" />
            </Button>
          </div>
          
          {/* Replies */}
          {comment.replies.length > 0 && (
            <div className="mt-3 space-y-3 pl-4 border-l-2 border-muted">
              {comment.replies.map((reply) => (
                <CommentItem 
                  key={reply.id} 
                  comment={reply} 
                  onReply={onReply}
                  onLike={onLike}
                  isAuthenticated={isAuthenticated}
                  onAuthRequired={onAuthRequired}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface MarketplaceListingCommentsProps {
  listingId: string;
}

const MarketplaceListingComments: React.FC<MarketplaceListingCommentsProps> = ({ 
  listingId 
}) => {
  const [comments, setComments] = useState<Comment[]>(mockComments);
  const [commentText, setCommentText] = useState('');
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const { toast } = useToast();
  const { session } = useAuth();
  const [, setAuthModal] = useAtom(authRequiredModalAtom);
  
  const isAuthenticated = !!session;
  
  const handleAuthRequired = (actionType: string) => {
    setAuthModal({
      isOpen: true,
      message: actionType === 'comment' 
        ? "Sign in to join the conversation and leave comments."
        : "Sign in to interact with this content.",
      actionType: actionType as any
    });
  };
  
  const handleCommentSubmit = () => {
    if (!isAuthenticated) {
      handleAuthRequired('comment');
      return;
    }
    
    if (!commentText.trim()) return;
    
    const newComment: Comment = {
      id: `new-${Date.now()}`,
      user: {
        id: 'currentUser',
        name: 'Current User',
        isSeller: false
      },
      text: commentText,
      timestamp: new Date().toISOString(),
      likes: 0,
      liked: false,
      replies: []
    };
    
    if (replyToId) {
      // Add as a reply
      const updatedComments = comments.map(comment => {
        if (comment.id === replyToId) {
          return {
            ...comment,
            replies: [...comment.replies, newComment]
          };
        }
        
        // Check nested replies
        if (comment.replies.some(reply => reply.id === replyToId)) {
          return {
            ...comment,
            replies: comment.replies.map(reply => 
              reply.id === replyToId
                ? { ...reply, replies: [...reply.replies, newComment] }
                : reply
            )
          };
        }
        
        return comment;
      });
      
      setComments(updatedComments);
      setReplyToId(null);
      toast({
        title: "Reply posted",
        description: "Your reply has been added to the discussion.",
      });
    } else {
      // Add as a new comment
      setComments([newComment, ...comments]);
      toast({
        title: "Comment posted",
        description: "Your comment has been added to the discussion.",
      });
    }
    
    setCommentText('');
  };
  
  const handleReply = (commentId: string) => {
    setReplyToId(commentId);
    // Focus on the textarea
    document.getElementById('comment-textarea')?.focus();
  };
  
  const handleLike = (commentId: string) => {
    const updateLike = (commentsArray: Comment[]): Comment[] => {
      return commentsArray.map(comment => {
        if (comment.id === commentId) {
          return {
            ...comment,
            likes: comment.liked ? comment.likes - 1 : comment.likes + 1,
            liked: !comment.liked
          };
        }
        
        if (comment.replies.length > 0) {
          return {
            ...comment,
            replies: updateLike(comment.replies)
          };
        }
        
        return comment;
      });
    };
    
    setComments(updateLike(comments));
  };
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-xl flex items-center">
          <MessageSquare className="h-5 w-5 mr-2" />
          Comments
        </CardTitle>
        <Badge variant="outline">{comments.length} comments</Badge>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-1">
          {comments.map((comment) => (
            <CommentItem 
              key={comment.id} 
              comment={comment} 
              onReply={handleReply}
              onLike={handleLike}
              isAuthenticated={isAuthenticated}
              onAuthRequired={handleAuthRequired}
            />
          ))}
          
          {comments.length === 0 && (
            <div className="py-8 text-center">
              <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">Be the first to comment on this listing</p>
            </div>
          )}
        </div>
      </CardContent>
      
      <CardFooter className="flex flex-col pt-0">
        <div className="w-full">
          {!isAuthenticated ? (
            <div className="flex flex-col items-center justify-center p-4 border border-dashed rounded-md bg-muted/50">
              <Lock className="h-8 w-8 text-muted-foreground mb-2" />
              <h3 className="text-sm font-medium mb-1">Join the conversation</h3>
              <p className="text-xs text-muted-foreground text-center mb-3">
                Sign in to post comments and interact with the community
              </p>
              <Button onClick={() => handleAuthRequired('comment')}>
                Sign in to comment
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-2">
                {replyToId && (
                  <div className="flex justify-between items-center text-sm text-muted-foreground bg-muted p-2 rounded mb-2">
                    <span>Replying to comment</span>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 px-2"
                      onClick={() => setReplyToId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
                <Textarea
                  id="comment-textarea"
                  placeholder="Add your comment to the public discussion..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  className="resize-none mb-2"
                  rows={3}
                />
              </div>
              
              <div className="flex justify-between items-center">
                <div className="text-xs text-muted-foreground">
                  All comments are public and visible to everyone
                </div>
                <Button 
                  onClick={handleCommentSubmit}
                  disabled={!commentText.trim()}
                >
                  Post {replyToId ? 'Reply' : 'Comment'}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  );
};

export default MarketplaceListingComments;
