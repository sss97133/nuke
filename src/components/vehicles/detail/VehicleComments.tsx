
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Vehicle } from '@/components/vehicles/discovery/types';
import { Button } from '@/components/ui/button';
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { MessageSquare, Send, UserCheck, Star, Lock, EyeOff } from "lucide-react";

interface VehicleCommentsProps {
  vehicle: Vehicle;
}

interface Comment {
  id: number;
  user: {
    name: string;
    avatar: string | null;
    verificationLevel: 'none' | 'basic' | 'expert' | 'owner';
    isInfluencer: boolean;
  };
  text: string;
  timestamp: string;
  likes: number;
  isPrivate: boolean;
  replies: Comment[];
}

const VerificationBadge = ({ level }: { level: 'none' | 'basic' | 'expert' | 'owner' }) => {
  if (level === 'none') return null;
  
  const colors: Record<string, string> = {
    basic: 'bg-blue-500',
    expert: 'bg-purple-500',
    owner: 'bg-green-500'
  };
  
  const titles: Record<string, string> = {
    basic: 'Verified User',
    expert: 'Verified Expert',
    owner: 'Vehicle Owner'
  };
  
  return (
    <Badge variant="outline" className={`ml-2 ${colors[level]} text-white`}>
      <UserCheck className="h-3 w-3 mr-1" />
      {titles[level]}
    </Badge>
  );
};

const InfluencerBadge = () => (
  <Badge variant="outline" className="ml-2 bg-yellow-500 text-white">
    <Star className="h-3 w-3 mr-1" />
    Influencer
  </Badge>
);

const VehicleComments: React.FC<VehicleCommentsProps> = ({ vehicle }) => {
  const [commentText, setCommentText] = useState('');
  const { toast } = useToast();
  
  // In a real app, these would come from an API
  const [comments, setComments] = useState<Comment[]>([
    {
      id: 1,
      user: {
        name: 'Alex Turner',
        avatar: null,
        verificationLevel: 'expert',
        isInfluencer: true
      },
      text: 'This is a rare find! I inspected a similar model last year, but this one seems to be in better condition based on the photos.',
      timestamp: '2 days ago',
      likes: 12,
      isPrivate: false,
      replies: []
    },
    {
      id: 2,
      user: {
        name: 'Mark Johnson',
        avatar: null,
        verificationLevel: 'owner',
        isInfluencer: false
      },
      text: 'I purchased this vehicle in 2018 for $32,000. Have done regular maintenance at PTZ Garage in Los Angeles.',
      timestamp: '1 day ago',
      likes: 8,
      isPrivate: false,
      replies: [
        {
          id: 3,
          user: {
            name: 'Sarah Williams',
            avatar: null,
            verificationLevel: 'basic',
            isInfluencer: false
          },
          text: 'Any issues with the transmission? I had similar problems with my 2016 model.',
          timestamp: '1 day ago',
          likes: 2,
          isPrivate: false,
          replies: []
        }
      ]
    },
    {
      id: 4,
      user: {
        name: 'Tom Rivera',
        avatar: null,
        verificationLevel: 'none',
        isInfluencer: false
      },
      text: 'I saw this exact vehicle at Cars & Coffee last month! The paint looks even better in person.',
      timestamp: '12 hours ago',
      likes: 5,
      isPrivate: false,
      replies: []
    }
  ]);
  
  const handleSubmitComment = () => {
    if (!commentText.trim()) return;
    
    const newComment: Comment = {
      id: comments.length + 1,
      user: {
        name: 'Current User',
        avatar: null,
        verificationLevel: 'basic', // Assuming the current user has basic verification
        isInfluencer: false
      },
      text: commentText,
      timestamp: 'Just now',
      likes: 0,
      isPrivate: false,
      replies: []
    };
    
    setComments([...comments, newComment]);
    setCommentText('');
    
    toast({
      title: "Comment posted",
      description: "Your comment has been added to the discussion.",
    });
  };
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center">
          <MessageSquare className="h-5 w-5 mr-2" />
          Vehicle Discussion
        </CardTitle>
        <div className="flex items-center space-x-2">
          <Badge variant="outline" className="ml-2 bg-gray-500 text-white">
            {comments.length} comments
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {comments.length > 0 ? (
          comments.map((comment) => (
            <div key={comment.id} className="border rounded-lg p-4 space-y-4">
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
                      {comment.isPrivate && (
                        <Badge variant="outline" className="ml-2 bg-gray-700 text-white">
                          <Lock className="h-3 w-3 mr-1" />
                          Private
                        </Badge>
                      )}
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
                    <div key={reply.id} className="space-y-2">
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
                  ))}
                </div>
              )}
              
              <div className="pt-2">
                <Button variant="ghost" size="sm">Reply</Button>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-10">
            <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Comments Yet</h3>
            <p className="text-muted-foreground mb-4">
              Be the first to comment on this vehicle.
            </p>
          </div>
        )}
      </CardContent>
      
      <CardFooter>
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
      </CardFooter>
    </Card>
  );
};

export default VehicleComments;
