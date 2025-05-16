
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, Lightbulb, Map, Compass } from 'lucide-react';

export const NotesSection = () => {
  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-yellow-500" />
          <CardTitle>Important Notes</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="border-l-2 border-primary pl-4">
            <h3 className="font-medium flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              User Interest Driven Content
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Content is dynamically organized based on user interests, behaviors, and preferences.
              The system analyzes your interactions to provide more relevant recommendations over time.
            </p>
          </div>
          
          <div className="border-l-2 border-primary pl-4">
            <h3 className="font-medium flex items-center gap-2">
              <Compass className="h-4 w-4" />
              Algorithmic Recommendations
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Advanced algorithms optimize content discovery based on engagement patterns, 
              relevance scoring, and collaborative filtering from similar users.
            </p>
          </div>
          
          <div className="border-l-2 border-primary pl-4">
            <h3 className="font-medium flex items-center gap-2">
              <Map className="h-4 w-4" />
              Geo-Fencing Capabilities
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Use location-based filtering to discover what's happening in your area.
              Set a custom radius (5-100 miles) to find nearby vehicles, garages, auctions, and events.
            </p>
          </div>
          
          <div className="border-l-2 border-primary pl-4">
            <h3 className="font-medium flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              Personalized Exploration
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              The feed continuously learns from your interactions, introducing both relevant content
              and occasional novel discoveries to expand your interests while preventing filter bubbles.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
