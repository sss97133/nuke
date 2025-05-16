
import React from 'react';
import { Button } from "@/components/ui/button";
import { Loader2, Code, XCircle, CheckCircle, Play } from "lucide-react";

interface CodeTabProps {
  codeGenerated: boolean;
  codeError: boolean;
  codeFixed: boolean;
  loading: boolean;
  onGenerateCode: () => void;
  onFixCode: () => void;
  onViewOutput: () => void;
  planCompleted: boolean;
}

const CodeTab = ({ 
  codeGenerated, 
  codeError, 
  codeFixed, 
  loading, 
  onGenerateCode, 
  onFixCode, 
  onViewOutput,
  planCompleted 
}: CodeTabProps) => {
  return (
    <div className="space-y-4">
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
              onClick={onFixCode}
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
              onClick={onGenerateCode}
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
              onClick={onViewOutput}
            >
              <Play className="mr-2 h-4 w-4" />
              View Output
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CodeTab;
