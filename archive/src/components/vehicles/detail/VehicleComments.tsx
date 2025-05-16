
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare } from "lucide-react";
import { VehicleCommentsProps } from './comments/types';
import CommentItem from './comments/CommentItem';
import CommentInput from './comments/CommentInput';
import EmptyComments from './comments/EmptyComments';
import { useComments } from './comments/useComments';

const VehicleComments: React.FC<VehicleCommentsProps> = ({ vehicle }) => {
  const { comments, commentText, setCommentText, handleSubmitComment } = useComments();
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center">
          <MessageSquare className="h-5 w-5 mr-2" />
          {/* Removed "Vehicle Discussion" text */}
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
            <CommentItem key={comment.id} comment={comment} />
          ))
        ) : (
          <EmptyComments />
        )}
      </CardContent>
      
      <CardFooter>
        <CommentInput 
          commentText={commentText} 
          setCommentText={setCommentText} 
          handleSubmitComment={handleSubmitComment} 
        />
      </CardFooter>
    </Card>
  );
};

export default VehicleComments;
