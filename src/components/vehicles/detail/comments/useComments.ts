
import { useState } from 'react';
import { Comment } from './types';
import { useToast } from "@/components/ui/use-toast";

export const useComments = () => {
  const { toast } = useToast();
  const [commentText, setCommentText] = useState('');
  
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
  
  return {
    comments,
    commentText,
    setCommentText,
    handleSubmitComment,
  };
};
