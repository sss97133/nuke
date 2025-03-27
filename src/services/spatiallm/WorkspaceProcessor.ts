import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { getConfig } from '@/config/spatiallm';

interface ProcessedWorkspace {
  pointCloud: Float32Array;
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  objects: Array<{
    type: string;
    position: { x: number; y: number; z: number };
    dimensions: { length: number; width: number; height: number };
  }>;
}

interface WorkspaceAnalysis {
  coverageScore: number;
  blindSpots: Array<{
    position: { x: number; y: number; z: number };
    radius: number;
  }>;
  cameras: Array<{
    position: { x: number; y: number; z: number };
    fov: number;
    range: number;
    rotation: { x: number; y: number; z: number };
  }>;
}

export class WorkspaceProcessor {
  private config = getConfig();
  private modelPath: string;
  private pythonPath: string;
  private isInitialized: boolean = false;

  constructor() {
    this.modelPath = process.env.SPATIALLM_MODEL_PATH || path.join(process.cwd(), 'public/models/spatiallm');
    this.pythonPath = process.env.SPATIALLM_PYTHON_PATH || 'python';
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Verify model file exists
      await fs.access(path.join(this.modelPath, 'model.pt'));
      
      // Initialize Python environment
      await this.runPythonScript('init_model.py', []);
      
      this.isInitialized = true;
      console.log('WorkspaceProcessor initialized successfully');
    } catch (error) {
      console.error('Failed to initialize WorkspaceProcessor:', error);
      throw error;
    }
  }

  async analyzeWorkspace(workspaceData: any): Promise<WorkspaceAnalysis> {
    if (!this.isInitialized) {
      throw new Error('WorkspaceProcessor not initialized');
    }

    try {
      const result = await this.runPythonScript('analyze_workspace.py', [
        '--workspace-data', JSON.stringify(workspaceData),
        '--config', JSON.stringify(this.config)
      ]);

      return this.parseAnalysisResult(result);
    } catch (error) {
      console.error('Failed to analyze workspace:', error);
      throw error;
    }
  }

  async optimizePositions(
    workspaceData: any,
    targetCoverage: number
  ): Promise<WorkspaceAnalysis> {
    if (!this.isInitialized) {
      throw new Error('WorkspaceProcessor not initialized');
    }

    try {
      const result = await this.runPythonScript('optimize_positions.py', [
        '--workspace-data', JSON.stringify(workspaceData),
        '--target-coverage', targetCoverage.toString(),
        '--config', JSON.stringify(this.config)
      ]);

      return this.parseAnalysisResult(result);
    } catch (error) {
      console.error('Failed to optimize positions:', error);
      throw error;
    }
  }

  private async runPythonScript(scriptName: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(process.cwd(), 'scripts', scriptName);
      const pythonProcess: ChildProcess = spawn(this.pythonPath, [scriptPath, ...args]);

      let output = '';
      let error = '';

      if (!pythonProcess.stdout || !pythonProcess.stderr) {
        reject(new Error(`Failed to spawn Python process for ${scriptName}`));
        return;
      }

      pythonProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        error += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python script ${scriptName} failed: ${error}`));
          return;
        }

        try {
          resolve(output);
        } catch (err) {
          reject(new Error(`Failed to parse output from ${scriptName}`));
        }
      });
    });
  }

  private parseAnalysisResult(output: string): WorkspaceAnalysis {
    try {
      const result = JSON.parse(output);
      return {
        coverageScore: result.coverageScore,
        blindSpots: result.blindSpots,
        cameras: result.cameras
      };
    } catch (error) {
      throw new Error('Failed to parse analysis result');
    }
  }
} 