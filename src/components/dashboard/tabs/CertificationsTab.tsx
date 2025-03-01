
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Award, Clock, GraduationCap, BriefcaseBusiness } from "lucide-react";

export const CertificationsTab = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">ASE Master Technician</CardTitle>
            <Award className="h-5 w-5 text-green-500" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Completed</div>
          <div className="flex items-center mt-2 text-xs">
            <Clock className="h-3.5 w-3.5 mr-1" />
            <span>Renewed: Mar 15, 2023</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Electric Vehicle Specialist</CardTitle>
            <Award className="h-5 w-5 text-green-500" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Completed</div>
          <div className="flex items-center mt-2 text-xs">
            <Clock className="h-3.5 w-3.5 mr-1" />
            <span>Earned: Nov 10, 2023</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Advanced Diagnostics</CardTitle>
            <Award className="h-5 w-5 text-green-500" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Completed</div>
          <div className="flex items-center mt-2 text-xs">
            <Clock className="h-3.5 w-3.5 mr-1" />
            <span>Earned: Jan 20, 2024</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Hybrid Systems Expert</CardTitle>
            <GraduationCap className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">In Progress - 65%</div>
          <Progress value={65} className="h-2 mt-2" />
          <div className="flex items-center mt-2 text-xs">
            <Clock className="h-3.5 w-3.5 mr-1" />
            <span>Due: Aug 15, 2024</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Service Management</CardTitle>
            <GraduationCap className="h-5 w-5 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Not Started</div>
          <Progress value={0} className="h-2 mt-2" />
          <div className="flex items-center mt-2 text-xs">
            <BriefcaseBusiness className="h-3.5 w-3.5 mr-1" />
            <span>Required for advancement</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
