
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlanStep } from './theorem-explain/types';
import TheoremCard from './theorem-explain/TheoremCard';
import PlannerTab from './theorem-explain/PlannerTab';
import CodeTab from './theorem-explain/CodeTab';
import OutputTab from './theorem-explain/OutputTab';
import DocumentationSection from './theorem-explain/DocumentationSection';

const TheoremExplainAgent = () => {
  const [activeTab, setActiveTab] = useState("planner");
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [planCompleted, setPlanCompleted] = useState(false);
  const [codeGenerated, setCodeGenerated] = useState(false);
  const [codeError, setCodeError] = useState(false);
  const [codeFixed, setCodeFixed] = useState(false);
  
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([
    { title: "Scene Outline", description: "Initial context and scope", completed: false },
    { title: "Vision Storyboard Plan", description: "Visual representation flow", completed: false },
    { title: "Technical Implementation Plan", description: "Code structure and algorithms", completed: false },
    { title: "Animation & Narration Plan", description: "User experience details", completed: false }
  ]);
  
  // Simulates the planning process
  const startPlanning = () => {
    setLoading(true);
    setPlanning(true);
    
    // Simulate API calls with timeouts
    let stepIndex = 0;
    const interval = setInterval(() => {
      if (stepIndex < planSteps.length) {
        setPlanSteps(prev => {
          const updated = [...prev];
          updated[stepIndex].completed = true;
          return updated;
        });
        stepIndex++;
      } else {
        clearInterval(interval);
        setPlanCompleted(true);
        setPlanning(false);
      }
    }, 1000);
    
    // Simulate completion
    setTimeout(() => {
      setLoading(false);
    }, 5000);
  };
  
  const generateCode = () => {
    setLoading(true);
    
    // Simulate code generation
    setTimeout(() => {
      setCodeGenerated(true);
      setCodeError(true);
      setLoading(false);
    }, 2000);
  };
  
  const fixCode = () => {
    setLoading(true);
    
    // Simulate code fixing
    setTimeout(() => {
      setCodeError(false);
      setCodeFixed(true);
      setLoading(false);
    }, 2000);
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Theorem Explain Agent</h2>
        <p className="text-muted-foreground">
          Uses AI planning and code generation to create educational visualizations
        </p>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <TheoremCard 
          onStartPlanning={startPlanning}
          planning={planning}
          planCompleted={planCompleted}
        />
        
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle>Agent Pipeline</CardTitle>
            <CardDescription>Visualization creation process</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="planner" value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="planner">Planner Agent</TabsTrigger>
                <TabsTrigger value="code">Code Agent</TabsTrigger>
                <TabsTrigger value="output">Rendered Output</TabsTrigger>
              </TabsList>
              
              <TabsContent value="planner">
                <PlannerTab 
                  planSteps={planSteps}
                  planCompleted={planCompleted}
                  onProceedToCode={() => setActiveTab("code")}
                />
              </TabsContent>
              
              <TabsContent value="code">
                <CodeTab 
                  codeGenerated={codeGenerated}
                  codeError={codeError}
                  codeFixed={codeFixed}
                  loading={loading}
                  planCompleted={planCompleted}
                  onGenerateCode={generateCode}
                  onFixCode={fixCode}
                  onViewOutput={() => setActiveTab("output")}
                />
              </TabsContent>
              
              <TabsContent value="output">
                <OutputTab />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      
      <DocumentationSection />
    </div>
  );
};

export default TheoremExplainAgent;
