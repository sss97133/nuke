
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BookOpen, Award, Certificate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export const SkillsSummary = () => {
  const navigate = useNavigate();

  // Most important skills with their progress
  const keySkills = [
    { name: "Engine Diagnostics", progress: 80 },
    { name: "Electrical Systems", progress: 85 },
    { name: "OBD-II Scanning", progress: 82 },
    { name: "Customer Communication", progress: 90 },
  ];

  // Certification statuses
  const certifications = [
    { name: "ASE Master Technician", status: "Completed", date: "Mar 2023" },
    { name: "Electric Vehicle Specialist", status: "Completed", date: "Nov 2023" },
    { name: "Hybrid Systems Expert", status: "In Progress", completion: "65%" },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center">
          <BookOpen className="h-4 w-4 mr-2" />
          Skills & Certifications
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Key Skills</h4>
            <div className="space-y-3">
              {keySkills.map((skill, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>{skill.name}</span>
                    <span>{skill.progress}%</span>
                  </div>
                  <Progress value={skill.progress} className="h-1.5" />
                </div>
              ))}
            </div>
          </div>
          
          <div>
            <h4 className="text-sm font-medium mb-2">Recent Certifications</h4>
            <div className="space-y-2">
              {certifications.map((cert, index) => (
                <div key={index} className="flex justify-between items-center text-xs">
                  <div className="flex items-center">
                    {cert.status === "Completed" ? (
                      <Award className="h-3.5 w-3.5 mr-1.5 text-green-500" />
                    ) : (
                      <Certificate className="h-3.5 w-3.5 mr-1.5 text-blue-500" />
                    )}
                    <span>{cert.name}</span>
                  </div>
                  <span className={cert.status === "Completed" ? "text-green-500" : "text-blue-500"}>
                    {cert.status === "Completed" ? cert.date : cert.completion}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <Button 
          variant="outline" 
          size="sm" 
          className="w-full mt-4"
          onClick={() => navigate("/professional-dashboard?tab=skills")}
        >
          View All Skills
        </Button>
      </CardContent>
    </Card>
  );
};
