import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Figma API configuration
const FIGMA_API_TOKEN = process.env.FIGMA_API_TOKEN;
const FIGMA_FILE_KEY = process.env.FIGMA_FILE_KEY || ''; // Will be set when a new file is created

// Figma API endpoints
const FIGMA_API_BASE_URL = 'https://api.figma.com/v1';

// Axios instance with auth header
const figmaApi = axios.create({
  baseURL: FIGMA_API_BASE_URL,
  headers: {
    'X-Figma-Token': FIGMA_API_TOKEN
  }
});

// Create a new Figma file
async function createFigmaFile(fileName: string) {
  try {
    const response = await figmaApi.post('/files', {
      name: fileName
    });
    
    console.log(`Created new Figma file: ${fileName}`);
    console.log(`File key: ${response.data.key}`);
    
    // Save file key to .env for future use
    fs.appendFileSync('.env', `\nFIGMA_FILE_KEY=${response.data.key}`);
    
    return response.data.key;
  } catch (error) {
    console.error('Error creating Figma file:', error);
    throw error;
  }
}

// Create a frame in the Figma file
async function createFrame(fileKey: string, frameName: string, x: number, y: number, width: number, height: number) {
  try {
    const response = await figmaApi.post(`/files/${fileKey}/nodes`, {
      insertions: [
        {
          componentType: 'FRAME',
          name: frameName,
          position: { x, y },
          size: { width, height }
        }
      ]
    });
    
    console.log(`Created frame: ${frameName}`);
    return response.data.nodes;
  } catch (error) {
    console.error('Error creating frame:', error);
    throw error;
  }
}

// Main function to generate the Vehicle Timeline layout
async function generateVehicleTimelineLayout() {
  try {
    // Create a new Figma file
    const fileKey = await createFigmaFile('Nuke - Vehicle Digital Lifecycle');
    
    // Create main layout frames
    const mainFrameId = await createFrame(fileKey, 'Main Layout', 0, 0, 1440, 900);
    
    // Create vehicle timeline section
    const timelineFrameId = await createFrame(fileKey, 'Vehicle Timeline', 120, 180, 1200, 400);
    
    // Create multi-source connector section
    const connectorFrameId = await createFrame(fileKey, 'Connector Framework', 120, 600, 580, 240);
    
    // Create verification center section
    const verificationFrameId = await createFrame(fileKey, 'Physical Verification', 720, 600, 600, 240);
    
    // Create investment platform section
    const investmentFrameId = await createFrame(fileKey, 'Investment Platform', 120, 860, 1200, 300);
    
    console.log('Layout generated successfully');
    console.log(`Figma file URL: https://www.figma.com/file/${fileKey}`);
    
    return {
      fileKey,
      frameIds: {
        main: mainFrameId,
        timeline: timelineFrameId,
        connector: connectorFrameId,
        verification: verificationFrameId,
        investment: investmentFrameId
      }
    };
  } catch (error) {
    console.error('Error generating layout:', error);
    throw error;
  }
}

// Function to generate UI components for the Figma file
async function generateUIComponents(fileKey: string) {
  try {
    // Create component frames
    const buttonFrameId = await createFrame(fileKey, 'Button Components', 1500, 0, 320, 400);
    const cardFrameId = await createFrame(fileKey, 'Card Components', 1500, 420, 320, 400);
    const timelineEventFrameId = await createFrame(fileKey, 'Timeline Event Components', 1500, 840, 320, 400);
    
    console.log('UI Components generated successfully');
    
    return {
      buttonFrameId,
      cardFrameId,
      timelineEventFrameId
    };
  } catch (error) {
    console.error('Error generating UI components:', error);
    throw error;
  }
}

// Execute the layout generation
(async () => {
  try {
    const layoutInfo = await generateVehicleTimelineLayout();
    await generateUIComponents(layoutInfo.fileKey);
    
    console.log('Figma layout generation completed successfully');
    console.log('You can now open and modify this file in Figma');
  } catch (error) {
    console.error('Failed to generate Figma layout:', error);
  }
})();
