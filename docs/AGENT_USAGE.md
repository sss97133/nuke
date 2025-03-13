# Using Agents in Nuke

## Introduction

Nuke's agent system provides intelligent automation for document processing, data validation, and vehicle insights. This guide explains how to use agents in your application.

## Available Agents

Currently, Nuke includes the following agents:

1. **Document Processing Agent**: Automatically extracts structured information from vehicle-related documents like receipts, maintenance records, registrations, and more.

## Setting Up Agents

### Prerequisites

Agents require API keys for their reasoning systems. Set up the following environment variables:

```
OPENAI_API_KEY=your_openai_api_key
```

You can add these to your `.env` file or set them in your deployment environment.

### Importing Agent Services

```typescript
import { agentService } from '@/services/agentService';
```

## Using the Document Processing Agent

### Processing Documents

The Document Processing Agent can extract data from various vehicle-related documents. Here's how to use it:

```typescript
// Process a document asynchronously (fire and forget)
await agentService.processDocumentAsync(documentId, vehicleId);

// Or process and wait for results
const result = await agentService.processDocument(documentId, vehicleId);
console.log(result.extractedData);
```

### Document Upload Flow

1. **Frontend Upload Component**

```typescript
import { useState } from 'react';
import { documentService } from '@/services/documentService';

function DocumentUpload({ vehicleId }) {
  const [uploading, setUploading] = useState(false);
  
  const handleFileUpload = async (file) => {
    setUploading(true);
    
    try {
      // Upload the document
      const documentId = await documentService.uploadDocument(file, vehicleId);
      
      // Start processing with agent
      await agentService.processDocumentAsync(documentId, vehicleId);
      
      // Show success message
      console.log('Document uploaded and processing started');
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };
  
  return (
    <div>
      <input type="file" onChange={(e) => handleFileUpload(e.target.files[0])} />
      {uploading && <p>Uploading...</p>}
    </div>
  );
}
```

2. **Backend API Route**

Expand your existing document upload endpoint to include agent processing:

```typescript
// Document upload endpoint
export const documentRoutes = {
  upload: async (req, res) => {
    try {
      const { vehicleId } = req.body;
      const file = req.file;
      
      // Existing document upload logic...
      const document = await documentService.createDocument(file, vehicleId);
      
      // Start asynchronous processing with the agent
      agentService.processDocumentAsync(document.id, vehicleId);
      
      return res.status(200).json({
        success: true,
        documentId: document.id,
        status: 'uploaded'
      });
    } catch (error) {
      console.error('Document upload failed:', error);
      return res.status(500).json({ error: error.message });
    }
  }
};
```

### Displaying Processed Results

Create a component to display the extraction results:

```typescript
import { useState, useEffect } from 'react';
import { documentService } from '@/services/documentService';

function DocumentResults({ documentId }) {
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const fetchDocument = async () => {
      try {
        const data = await documentService.getDocumentById(documentId);
        setDocument(data);
      } catch (error) {
        console.error('Failed to fetch document:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchDocument();
    
    // Poll for updates if still processing
    const interval = setInterval(async () => {
      const data = await documentService.getDocumentById(documentId);
      setDocument(data);
      
      if (data.status !== 'processing') {
        clearInterval(interval);
      }
    }, 3000);
    
    return () => clearInterval(interval);
  }, [documentId]);
  
  if (loading) return <p>Loading...</p>;
  if (!document) return <p>Document not found</p>;
  
  return (
    <div>
      <h2>Document Processing Results</h2>
      
      <div>
        <p>Status: {document.status}</p>
        <p>Document Type: {document.document_type}</p>
        <p>Confidence: {Math.round(document.confidence_score * 100)}%</p>
      </div>
      
      {document.extracted_data && (
        <div>
          <h3>Extracted Data</h3>
          <pre>{JSON.stringify(document.extracted_data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
```

## Best Practices

1. **Error Handling**: Always implement proper error handling when working with agents

2. **Processing Status**: Show processing status to users when agents are working

3. **Confidence Scores**: Pay attention to the confidence scores returned by agents

4. **Human Verification**: For critical data, implement a human verification step

5. **API Keys**: Keep your API keys secure and never expose them in client-side code

## Troubleshooting

### Common Issues

1. **Agent Processing Fails**
   - Check that your API keys are valid and properly set
   - Ensure the document file is accessible
   - Check server logs for detailed error messages

2. **Low Confidence Scores**
   - The document might be low quality or have unusual formatting
   - The document type might not be well-supported
   - Consider manual data entry for critical information

### Logging

Enable detailed logging for agent operations to troubleshoot issues:

```typescript
// In your .env file
AGENT_DEBUG_LOGGING=true
```

## Future Agent Capabilities

The agent system is designed to be extensible. Future versions of Nuke will include:

1. **Maintenance Prediction Agent**: Forecasts maintenance needs based on vehicle history

2. **Valuation Agent**: Provides dynamic vehicle valuations based on condition and market

3. **History Detective Agent**: Reconstructs comprehensive vehicle histories from fragmented records
