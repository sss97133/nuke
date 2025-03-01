
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { BarChart, LineChart, Clock, Award, BookOpen, Calendar, CheckSquare, BriefcaseBusiness, GraduationCap, Users } from "lucide-react";
import { ProfessionalSkillsTab } from "@/components/skills/ProfessionalSkillsTab";
import { SkillsSummary } from "@/components/skills/SkillsSummary";

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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Quick stats */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Skills Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">73%</div>
              <Progress value={73} className="h-2 mt-2" />
              <p className="text-xs text-muted-foreground mt-1">12 of 16 skills completed</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Certifications</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">3</div>
              <div className="flex items-center text-xs text-muted-foreground mt-1">
                <span className="text-green-500 mr-1">+1</span> 
                <span>since last month</span>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Upcoming Deadlines</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">4</div>
              <div className="flex items-center text-xs text-muted-foreground mt-1">
                <span className="text-orange-500 mr-1">2 due soon</span>
              </div>
            </CardContent>
          </Card>
        </div>

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
          </TabsContent>

          <TabsContent value="skills">
            <ProfessionalSkillsTab />
          </TabsContent>

          <TabsContent value="certifications">
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
            <Button variant="outline" className="mt-6">
              <Award className="h-4 w-4 mr-2" />
              Explore New Certifications
            </Button>
          </TabsContent>

          <TabsContent value="schedule">
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
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default ProfessionalDashboard;
