
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { BarChart, Award, BookOpen, Calendar } from "lucide-react";
import { ProfessionalSkillsTab } from "@/components/skills/ProfessionalSkillsTab";
import { DashboardTabHeader } from "@/components/dashboard/tabs/DashboardTabHeader";
import { DashboardOverviewTab } from "@/components/dashboard/tabs/DashboardOverviewTab";
import { CertificationsTab } from "@/components/dashboard/tabs/CertificationsTab";
import { ScheduleTab } from "@/components/dashboard/tabs/ScheduleTab";

export const ProfessionalDashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");

  // Parse and handle tab from URL query parameters
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get("tab");
    if (tabParam && ["overview", "skills", "certifications", "schedule"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [location]);

  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    navigate(`/professional-dashboard?tab=${value}`);
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="container max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col space-y-2">
          <h1 className="text-3xl font-bold">Professional Dashboard</h1>
          <p className="text-muted-foreground">
            Track your professional growth, certifications, and performance metrics
          </p>
        </div>

        <DashboardTabHeader />

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid grid-cols-4 mb-4">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <BarChart className="h-4 w-4" />
              <span>Overview</span>
            </TabsTrigger>
            <TabsTrigger value="skills" className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              <span>Skills</span>
            </TabsTrigger>
            <TabsTrigger value="certifications" className="flex items-center gap-2">
              <Award className="h-4 w-4" />
              <span>Certifications</span>
            </TabsTrigger>
            <TabsTrigger value="schedule" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>Schedule</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <DashboardOverviewTab />
          </TabsContent>

          <TabsContent value="skills">
            <ProfessionalSkillsTab />
          </TabsContent>

          <TabsContent value="certifications">
            <CertificationsTab />
            <Button variant="outline" className="mt-6">
              <Award className="h-4 w-4 mr-2" />
              Explore New Certifications
            </Button>
          </TabsContent>

          <TabsContent value="schedule">
            <ScheduleTab />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default ProfessionalDashboard;
