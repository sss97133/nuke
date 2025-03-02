
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Code, FileText, CheckCircle, XCircle, ChevronDown, Volume2 } from "lucide-react";

interface PlanStep {
  title: string;
  description: string;
  completed: boolean;
}

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
        <Card className="lg:col-span-1 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="bg-green-100 dark:bg-green-900 p-1 rounded">
                <FileText className="h-5 w-5 text-green-600 dark:text-green-500" />
              </div>
              Theorem
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <h3 className="font-medium">IEEE Conversion</h3>
              <p className="text-sm text-muted-foreground">
                The IEEE-754 standard describes floating-point formats, a way to represent real numbers in hardware.
              </p>
              
              <Button 
                onClick={startPlanning} 
                disabled={planning || planCompleted}
                className="w-full mt-4"
              >
                {planning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Planning...
                  </>
                ) : planCompleted ? "Plan Generated" : "Generate Plan"}
              </Button>
            </div>
          </CardContent>
        </Card>
        
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
              
              <TabsContent value="planner" className="space-y-4">
                <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-md">
                  <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 font-medium mb-2">
                    <div className="bg-blue-100 dark:bg-blue-900 p-1 rounded">
                      <FileText className="h-4 w-4" />
                    </div>
                    Planner Agent
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Creates a multi-step plan for visualizing the theorem
                  </p>
                  
                  <div className="space-y-3">
                    {planSteps.map((step, index) => (
                      <div 
                        key={index}
                        className={`border p-3 rounded-md ${
                          step.completed 
                            ? "bg-blue-100/50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800" 
                            : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            {step.completed ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <div className="h-4 w-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                            )}
                            <span className={step.completed ? "font-medium" : "text-muted-foreground"}>
                              {step.title}
                            </span>
                          </div>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </div>
                        {step.completed && (
                          <p className="text-xs text-muted-foreground mt-2 ml-6">
                            {step.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  
                  {planCompleted && (
                    <Button 
                      className="mt-4" 
                      onClick={() => setActiveTab("code")}
                    >
                      Proceed to Code Generation
                    </Button>
                  )}
                </div>
              </TabsContent>
              
              <TabsContent value="code" className="space-y-4">
                <div className="border rounded-md overflow-hidden">
                  <div className="flex items-center justify-between bg-slate-800 text-white p-2">
                    <div className="flex items-center gap-2">
                      <Code className="h-4 w-4" />
                      <span className="text-sm">Code Generator</span>
                    </div>
                    {codeGenerated && (
                      <div className="flex items-center">
                        <span className="text-xs bg-blue-600 rounded px-2 py-0.5 mr-2">Version {codeFixed ? "1" : "0"}</span>
                        {codeError ? (
                          <XCircle className="h-5 w-5 text-red-500" />
                        ) : (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="bg-slate-900 text-slate-300 p-4 font-mono text-sm overflow-auto" style={{minHeight: "200px"}}>
                    {!codeGenerated ? (
                      <div className="flex items-center justify-center h-full">
                        <p className="text-slate-500">Code will be generated based on the plan</p>
                      </div>
                    ) : codeError ? (
                      <>
                        <div className="text-pink-400">from</div> <div className="text-blue-400">scipy.special</div> <div className="text-pink-400">import</div> <div className="text-blue-400">*</div>
                        <br />
                        <div className="text-pink-400">class</div> <div className="text-yellow-400">IEEEConversion(</div><div className="text-blue-400">object</div><div className="text-yellow-400">):</div>
                        <div className="ml-4 text-pink-400">def</div> <div className="text-yellow-400">__init__(</div><div className="text-blue-400">self</div><div className="text-yellow-400">):</div>
                        <div className="ml-8 text-slate-300">self.precision = 32</div>
                        <br />
                        <div className="ml-4 text-pink-400">def</div> <div className="text-yellow-400">animate(</div><div className="text-blue-400">self</div><div className="text-yellow-400">):</div>
                        <div className="ml-8 text-slate-300">arrow = Arrow(<div className="text-red-400">float</div>(mantissa[0][0].<div className="text-yellow-400">get_center()</div>), <div className="text-blue-400">up</div> * 0.5,</div>
                        <div className="ml-8 text-slate-300">axis=mantissa[0].<div className="text-yellow-400">get_right()</div>, color=<div className="text-green-400">"#FF5555"</div>, buff=0.1)</div>
                        <br />
                        <div className="bg-red-900/40 p-2 rounded mt-4 border border-red-700">
                          <div className="text-red-400 font-bold">&lt;!ERROR!&gt;</div>
                          <div className="text-sm text-red-300">Error Type: TypeError: Bool Error: get_center() requires only one argument which is the direction (LEFT, RIGHT, UP, DOWN etc). Solution: Modify the arrow's start point to reference the direction.</div>
                          <div className="text-red-400 font-bold">&lt;/ERROR!&gt;</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-pink-400">from</div> <div className="text-blue-400">scipy.special</div> <div className="text-pink-400">import</div> <div className="text-blue-400">*</div>
                        <br />
                        <div className="text-pink-400">class</div> <div className="text-yellow-400">IEEEConversion(</div><div className="text-blue-400">object</div><div className="text-yellow-400">):</div>
                        <div className="ml-4 text-pink-400">def</div> <div className="text-yellow-400">__init__(</div><div className="text-blue-400">self</div><div className="text-yellow-400">):</div>
                        <div className="ml-8 text-slate-300">self.precision = 32</div>
                        <br />
                        <div className="ml-4 text-pink-400">def</div> <div className="text-yellow-400">animate(</div><div className="text-blue-400">self</div><div className="text-yellow-400">):</div>
                        <div className="ml-8 text-slate-300">arrow = Arrow(<div className="text-yellow-400">LEFT</div>, <div className="text-blue-400">UP</div> * 0.5,</div>
                        <div className="ml-8 text-slate-300">axis=mantissa[0].<div className="text-yellow-400">get_right()</div>, color=<div className="text-green-400">"#FF5555"</div>, buff=0.1)</div>
                      </>
                    )}
                  </div>
                  
                  <div className="bg-slate-800 p-2 flex justify-end">
                    {codeGenerated && codeError ? (
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        onClick={fixCode}
                        disabled={loading}
                      >
                        {loading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Code className="mr-2 h-4 w-4" />
                        )}
                        Code Fix
                      </Button>
                    ) : !codeGenerated ? (
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        onClick={generateCode}
                        disabled={!planCompleted || loading}
                      >
                        {loading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Code className="mr-2 h-4 w-4" />
                        )}
                        Generate Code
                      </Button>
                    ) : (
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        onClick={() => setActiveTab("output")}
                      >
                        <Play className="mr-2 h-4 w-4" />
                        View Output
                      </Button>
                    )}
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="output">
                <Card className="border overflow-hidden">
                  <div className="aspect-video relative bg-black rounded-md overflow-hidden">
                    <img 
                      src="/lovable-uploads/4b9269d1-9638-4eb3-8139-c63f53e73d75.png" 
                      alt="IEEE Floating Point Visualization" 
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute bottom-4 right-4 flex gap-2">
                      <Button size="icon" variant="secondary" className="rounded-full h-10 w-10 bg-black/70 backdrop-blur">
                        <Volume2 className="h-5 w-5" />
                      </Button>
                      <Button size="icon" variant="secondary" className="rounded-full h-10 w-10 bg-black/70 backdrop-blur">
                        <Play className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Query Generator</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Processes natural language queries to extract theorem details</p>
          </CardContent>
        </Card>
        
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Core Documentation</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Maintains structured knowledge base of fundamental theorems</p>
          </CardContent>
        </Card>
        
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Plugin Documentation</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Extends core functionality with specialized visualizations</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default TheoremExplainAgent;
