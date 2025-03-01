
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LineChart, CheckSquare } from "lucide-react";
import { SkillsSummary } from "@/components/skills/SkillsSummary";

export const DashboardOverviewTab = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Performance Overview</CardTitle>
          <CardDescription>Your professional performance metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[200px] flex items-center justify-center border rounded-md bg-muted/20">
            <div className="text-muted-foreground flex items-center">
              <LineChart className="h-5 w-5 mr-2" />
              <span>Performance metrics chart will appear here</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <h4 className="text-sm font-medium mb-1">Completed Tasks</h4>
              <div className="text-2xl font-bold">24</div>
              <div className="text-xs text-muted-foreground">Last 30 days</div>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-1">Training Hours</h4>
              <div className="text-2xl font-bold">18.5</div>
              <div className="text-xs text-muted-foreground">This quarter</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <SkillsSummary />

        <Card>
          <CardHeader>
            <CardTitle>Upcoming Tasks</CardTitle>
            <CardDescription>Your next priorities</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start">
                <Checkbox id="task-1" className="mt-1" />
                <div className="ml-3">
                  <label htmlFor="task-1" className="text-sm font-medium">Complete ASE Certification Module 3</label>
                  <p className="text-xs text-muted-foreground">Due in 3 days</p>
                </div>
              </div>
              <div className="flex items-start">
                <Checkbox id="task-2" className="mt-1" />
                <div className="ml-3">
                  <label htmlFor="task-2" className="text-sm font-medium">Submit quarterly skill assessment</label>
                  <p className="text-xs text-muted-foreground">Due in 1 week</p>
                </div>
              </div>
              <div className="flex items-start">
                <Checkbox id="task-3" className="mt-1" />
                <div className="ml-3">
                  <label htmlFor="task-3" className="text-sm font-medium">Review diagnostic techniques update</label>
                  <p className="text-xs text-muted-foreground">Due in 2 weeks</p>
                </div>
              </div>
              <Button variant="outline" className="w-full mt-2">
                <CheckSquare className="h-4 w-4 mr-2" />
                View All Tasks
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
