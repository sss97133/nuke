import { WorkspaceProcessor } from '../WorkspaceProcessor';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

describe('WorkspaceProcessor', () => {
  let processor: WorkspaceProcessor;
  let tempDir: string;

  beforeEach(() => {
    processor = new WorkspaceProcessor();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('processImageData', () => {
    it('should process image data and return workspace information', async () => {
      // Create mock image data
      const imageData = new ImageData(100, 100);
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = 255;     // R
        imageData.data[i + 1] = 0;   // G
        imageData.data[i + 2] = 0;   // B
        imageData.data[i + 3] = 255; // A
      }

      // Mock SpatialLM processing output
      const mockOutput = {
        pointCloud: new Float32Array(3000), // 1000 points * 3 coordinates
        dimensions: {
          length: 10,
          width: 8,
          height: 6
        },
        objects: [
          {
            type: 'camera',
            position: { x: 1, y: 2, z: 3 },
            dimensions: { length: 0.5, width: 0.5, height: 0.5 }
          }
        ]
      };

      // Mock the spawn function
      const { spawn } = require('child_process');
      const mockProcess = {
        stdout: {
          on: jest.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from(JSON.stringify(mockOutput)));
            }
          })
        },
        stderr: {
          on: jest.fn()
        },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            callback(0);
          }
        })
      };
      (spawn as jest.Mock).mockReturnValue(mockProcess);

      // Process the image data
      const result = await processor.processImageData(imageData);

      // Verify the result
      expect(result).toEqual(mockOutput);
      expect(spawn).toHaveBeenCalled();
    });

    it('should handle processing errors', async () => {
      // Create mock image data
      const imageData = new ImageData(100, 100);

      // Mock the spawn function to simulate an error
      const { spawn } = require('child_process');
      const mockProcess = {
        stdout: {
          on: jest.fn()
        },
        stderr: {
          on: jest.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('Processing error'));
            }
          })
        },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            callback(1);
          }
        })
      };
      (spawn as jest.Mock).mockReturnValue(mockProcess);

      // Attempt to process the image data
      await expect(processor.processImageData(imageData)).rejects.toThrow('SpatialLM processing failed');
    });
  });

  describe('saveImageDataToPNG', () => {
    it('should save image data as PNG', async () => {
      // Create a temporary directory
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spatiallm-test-'));
      const outputPath = path.join(tempDir, 'test.png');

      // Create mock image data
      const imageData = new ImageData(100, 100);
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = 255;     // R
        imageData.data[i + 1] = 0;   // G
        imageData.data[i + 2] = 0;   // B
        imageData.data[i + 3] = 255; // A
      }

      // Save the image data
      await (processor as any).saveImageDataToPNG(imageData, outputPath);

      // Verify the file exists
      const stats = await fs.stat(outputPath);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(0);
    });
  });
}); 