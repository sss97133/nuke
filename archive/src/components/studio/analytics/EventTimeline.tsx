
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, Video, Radio, AlertCircle } from "lucide-react";
import type { EventTimelineProps, TimelineEventProps } from "../types/analyticsTypes";

const getEventIcon = (type: TimelineEventProps['type']) => {
  switch (type) {
    case 'recording':
      return <Video className="h-4 w-4" />;
    case 'streaming':
      return <Radio className="h-4 w-4" />;
    case 'error':
      return <AlertCircle className="h-4 w-4" />;
    default:
      return <CalendarDays className="h-4 w-4" />;
  }
};

const getEventColor = (type: TimelineEventProps['type']) => {
  switch (type) {
    case 'recording':
      return 'bg-blue-500';
    case 'streaming':
      return 'bg-green-500';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
};

export const EventTimeline = ({ events }: EventTimelineProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div className="absolute left-3 top-0 bottom-0 w-px bg-muted-foreground/20" />
          <div className="space-y-6 relative">
            {events.map((event) => (
              <div key={event.id} className="flex gap-4 relative">
                <div className={`flex-none w-6 h-6 rounded-full ${getEventColor(event.type)} flex items-center justify-center text-white z-10`}>
                  {getEventIcon(event.type)}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-baseline justify-between">
                    <h4 className="font-medium">{event.title}</h4>
                    <time className="text-xs text-muted-foreground">
                      {event.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                  {event.description && (
                    <p className="text-sm text-muted-foreground">{event.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
