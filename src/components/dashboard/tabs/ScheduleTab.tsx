
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, Users, Calendar } from "lucide-react";

export const ScheduleTab = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Professional Schedule</CardTitle>
        <CardDescription>Upcoming training and events</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="border rounded-md p-3">
            <div className="flex justify-between">
              <div className="font-medium">Electric Vehicle Diagnostics Workshop</div>
              <div className="text-sm text-muted-foreground">May 15</div>
            </div>
            <div className="flex items-center mt-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 mr-2" />
              <span>9:00 AM - 4:00 PM</span>
            </div>
            <div className="flex items-center mt-1 text-sm text-muted-foreground">
              <Users className="h-4 w-4 mr-2" />
              <span>Regional Training Center</span>
            </div>
          </div>

          <div className="border rounded-md p-3">
            <div className="flex justify-between">
              <div className="font-medium">Quarterly Skills Assessment</div>
              <div className="text-sm text-muted-foreground">May 22</div>
            </div>
            <div className="flex items-center mt-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 mr-2" />
              <span>10:00 AM - 12:00 PM</span>
            </div>
            <div className="flex items-center mt-1 text-sm text-muted-foreground">
              <Users className="h-4 w-4 mr-2" />
              <span>Online</span>
            </div>
          </div>

          <div className="border rounded-md p-3">
            <div className="flex justify-between">
              <div className="font-medium">Industry Conference</div>
              <div className="text-sm text-muted-foreground">Jun 10-12</div>
            </div>
            <div className="flex items-center mt-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 mr-2" />
              <span>All Day</span>
            </div>
            <div className="flex items-center mt-1 text-sm text-muted-foreground">
              <Users className="h-4 w-4 mr-2" />
              <span>Convention Center</span>
            </div>
          </div>

          <div className="border rounded-md p-3">
            <div className="flex justify-between">
              <div className="font-medium">Certification Exam: Hybrid Systems</div>
              <div className="text-sm text-muted-foreground">Jul 18</div>
            </div>
            <div className="flex items-center mt-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 mr-2" />
              <span>1:00 PM - 4:00 PM</span>
            </div>
            <div className="flex items-center mt-1 text-sm text-muted-foreground">
              <Users className="h-4 w-4 mr-2" />
              <span>Testing Center</span>
            </div>
          </div>
        </div>
        <Button variant="outline" className="w-full mt-4">
          <Calendar className="h-4 w-4 mr-2" />
          View Full Calendar
        </Button>
      </CardContent>
    </Card>
  );
};
