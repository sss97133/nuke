
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TheoremCard from './theorem-explain/TheoremCard';
import PlannerTab from './theorem-explain/PlannerTab';
import CodeTab from './theorem-explain/CodeTab';
import OutputTab from './theorem-explain/OutputTab';
import DocumentationSection from './theorem-explain/DocumentationSection';
import { useTheoremData } from './theorem-explain/hooks/useTheoremData';
import { usePlanner } from './theorem-explain/hooks/usePlanner';
import { useCodeGenerator } from './theorem-explain/hooks/useCodeGenerator';
import { useTabState } from './theorem-explain/hooks/useTabState';

const TheoremExplainAgent = () => {
  // Use our custom hooks to manage state
  const { theoremData, selectedTheorem, fetchingData } = useTheoremData();
  const { activeTab, setActiveTab } = useTabState();
  const { loading: plannerLoading, planning, planCompleted, planSteps, startPlanning } = usePlanner(selectedTheorem);
  const { 
    loading: codeLoading, 
    codeGenerated, 
    codeError, 
    codeFixed, 
    generateCode, 
    fixCode 
  } = useCodeGenerator(selectedTheorem);
  
  // Combine loading states
  const loading = plannerLoading || codeLoading;
  
  // Add console log to track component rendering
  console.log("TheoremExplainAgent rendering", { 
    activeTab, 
    selectedTheorem, 
    planCompleted, 
    codeGenerated 
  });
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Theorem Explain Agent</h2>
        <p className="text-muted-foreground">
          Uses AI planning and code generation to create educational visualizations from the TIGER-Lab/TheoremExplainBench dataset
        </p>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <TheoremCard 
          onStartPlanning={startPlanning}
          planning={planning}
          planCompleted={planCompleted}
          selectedTheorem={selectedTheorem}
          isLoading={fetchingData}
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
                <OutputTab theoremData={selectedTheorem} />
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
