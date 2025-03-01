
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Award, BookOpen, GraduationCap } from "lucide-react";

export const ProfessionalSkillsTab = () => {
  return (
    <Tabs defaultValue="skills" className="w-full">
      <TabsList className="grid grid-cols-3 mb-4">
        <TabsTrigger value="skills" className="flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          <span>Skills</span>
        </TabsTrigger>
        <TabsTrigger value="certifications" className="flex items-center gap-2">
          <Award className="h-4 w-4" />
          <span>Certifications</span>
        </TabsTrigger>
        <TabsTrigger value="education" className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4" />
          <span>Education</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="skills">
        <div className="grid gap-4">
          <div className="p-6 bg-white rounded-lg shadow">
            <h3 className="text-lg font-medium mb-2">Technical Skills</h3>
            <p className="text-muted-foreground mb-4">Track your development in various technical domains</p>
            <div className="space-y-2">
              {/* Skill items would go here */}
              <div className="flex justify-between items-center">
                <span>React Development</span>
                <span className="text-sm font-medium">Advanced</span>
              </div>
              <div className="flex justify-between items-center">
                <span>TypeScript</span>
                <span className="text-sm font-medium">Intermediate</span>
              </div>
              <div className="flex justify-between items-center">
                <span>UI/UX Design</span>
                <span className="text-sm font-medium">Beginner</span>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="certifications">
        <div className="grid gap-4">
          <div className="p-6 bg-white rounded-lg shadow">
            <h3 className="text-lg font-medium mb-2">Certifications</h3>
            <p className="text-muted-foreground mb-4">Track your professional certifications</p>
            <div className="space-y-4">
              {/* Certification items would go here */}
              <div className="border p-4 rounded-md">
                <div className="flex justify-between">
                  <h4 className="font-medium">AWS Certified Solutions Architect</h4>
                  <span className="text-sm text-green-600">Active</span>
                </div>
                <p className="text-sm text-muted-foreground">Issued: Jan 2023 • Expires: Jan 2026</p>
              </div>
              <div className="border p-4 rounded-md">
                <div className="flex justify-between">
                  <h4 className="font-medium">Professional Scrum Master I</h4>
                  <span className="text-sm text-green-600">Active</span>
                </div>
                <p className="text-sm text-muted-foreground">Issued: Mar 2022 • No Expiration</p>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="education">
        <div className="grid gap-4">
          <div className="p-6 bg-white rounded-lg shadow">
            <h3 className="text-lg font-medium mb-2">Education</h3>
            <p className="text-muted-foreground mb-4">Track your educational achievements</p>
            <div className="space-y-4">
              {/* Education items would go here */}
              <div className="border p-4 rounded-md">
                <h4 className="font-medium">Bachelor of Science in Computer Science</h4>
                <p className="text-sm text-muted-foreground">University of Technology • 2018-2022</p>
              </div>
              <div className="border p-4 rounded-md">
                <h4 className="font-medium">Machine Learning Specialization</h4>
                <p className="text-sm text-muted-foreground">Online Course • Completed 2023</p>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
};
