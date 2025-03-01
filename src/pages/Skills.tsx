
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProfessionalSkillsTab } from "@/components/skills/ProfessionalSkillsTab";
import { Award, BookOpen, GraduationCap, Activity, User } from "lucide-react";
import { useNavigate } from "react-router-dom";

export const Skills = () => {
  const navigate = useNavigate();
  
  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="container max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-1">Skills & Development</h1>
            <p className="text-muted-foreground">
              Track your professional growth and skill development
            </p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => navigate("/professional-dashboard?tab=skills")}
          >
            <Activity className="mr-2 h-4 w-4" />
            View in Dashboard
          </Button>
        </div>
        
        <ProfessionalSkillsTab />
      </div>
    </ScrollArea>
  );
};

export default Skills;
