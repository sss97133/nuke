import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, ArrowLeft, Search, Copy, Check } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Prism from 'prismjs';
import 'prismjs/themes/prism-tomorrow.css';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';

// Types
interface TableOfContentsItem {
  title: string;
  level: number;
  id: string;
}

// Constants
const TECHNICAL_DOC = `# Technical Documentation

## Tech Stack

- **Frontend Framework:** React with TypeScript
- **Build Tool:** Vite
- **UI Components:** shadcn/ui
- **Styling:** Tailwind CSS
- **State Management:** Tanstack Query
- **Backend:** Supabase
  - PostgreSQL Database
  - Authentication
  - File Storage
  - Edge Functions
  - Real-time Subscriptions

## Project Structure

\`\`\`typescript
src/
├── components/         # Reusable UI components
├── hooks/             # Custom React hooks
├── lib/              # Utility functions
├── pages/            # Page components
└── types/            # TypeScript definitions
\`\`\`

## Key Features Implementation

### Command Terminal
- Built-in command interface
- System status monitoring
- Quick search functionality
- Batch operations support

### VIN Processing
- Automated VIN scanning
- Image-based detection
- Historical data retrieval
- Market value analysis
`;

export const TechTab: React.FC = () => {
  const [showTechDocs, setShowTechDocs] = useState(false);
  const [showIntegrationDocs, setShowIntegrationDocs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Highlight code blocks when content changes
  useEffect(() => {
    if (showTechDocs) {
      Prism.highlightAll();
    }
  }, [showTechDocs, searchQuery]);

  const handleCopyCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }, []);

  const tableOfContents = useMemo(() => {
    const items: TableOfContentsItem[] = [];
    TECHNICAL_DOC.split('\n').forEach((line: string, index: number) => {
      if (line.startsWith('# ')) {
        items.push({
          title: line.replace('# ', ''),
          level: 1,
          id: `section-${index}`,
        });
      } else if (line.startsWith('## ')) {
        items.push({
          title: line.replace('## ', ''),
          level: 2,
          id: `section-${index}`,
        });
      } else if (line.startsWith('### ')) {
        items.push({
          title: line.replace('### ', ''),
          level: 3,
          id: `section-${index}`,
        });
      }
    });
    return items;
  }, []);

  const renderContent = useCallback((content: string): React.ReactElement[] => {
    return content.split('\n').map((line: string, index: number) => {
      if (line.startsWith('# ')) {
        return (
          <h1 key={`h1-${index}`} id={`section-${index}`} className="text-2xl font-bold mt-6 mb-4 scroll-mt-16">
            {line.replace('# ', '')}
          </h1>
        );
      }
      if (line.startsWith('## ')) {
        return (
          <h2 key={`h2-${index}`} id={`section-${index}`} className="text-xl font-bold mt-5 mb-3 scroll-mt-16">
            {line.replace('## ', '')}
          </h2>
        );
      }
      if (line.startsWith('### ')) {
        return (
          <h3 key={`h3-${index}`} id={`section-${index}`} className="text-lg font-bold mt-4 mb-2 scroll-mt-16">
            {line.replace('### ', '')}
          </h3>
        );
      }
      if (line.startsWith('```')) {
        const code = line.replace(/^```(\w+)?\s*|```$/g, '').trim();
        return (
          <div key={`code-${index}`} className="relative group my-4">
            <pre className="rounded-lg overflow-x-auto bg-gray-900">
              <code className="language-typescript block p-4">{code}</code>
            </pre>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => handleCopyCode(code)}
            >
              {copiedCode === code ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        );
      }
      return line ? <p key={`p-${index}`} className="my-2">{line}</p> : null;
    });
  }, [copiedCode, handleCopyCode]);

  const filteredContent = useMemo((): string => {
    if (!searchQuery) return TECHNICAL_DOC;
    const lines = TECHNICAL_DOC.split('\n');
    return lines
      .filter((line: string) => 
        line.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .join('\n');
  }, [searchQuery]);

  if (showTechDocs) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-blue-500" />
            <CardTitle>Technical Documentation</CardTitle>
          </div>
          <button 
            onClick={() => setShowTechDocs(false)}
            className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to overview
          </button>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-500" />
              <Input
                placeholder="Search documentation..."
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="md:col-span-1">
              <div className="sticky top-4">
                <h3 className="font-semibold mb-2">Table of Contents</h3>
                <ul className="space-y-1">
                  {tableOfContents.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className={`block text-sm hover:text-blue-500 ${
                          item.level === 1 ? 'font-medium' : ''
                        } ${item.level === 2 ? 'ml-2' : ''} ${
                          item.level === 3 ? 'ml-4' : ''
                        }`}
                      >
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="md:col-span-3">
              <div className="prose dark:prose-invert max-w-none">
                {filteredContent.split('\n').map((line, lineNumber) => {
                  const trimmedLine = line.trim();

                  // Handle headers
                  if (trimmedLine.startsWith('# ')) {
                    return (
                      <h1
                        key={lineNumber}
                        id={`section-${lineNumber}`}
                        className="text-2xl font-bold mt-6 mb-4 scroll-mt-16"
                      >
                        {trimmedLine.replace('# ', '')}
                      </h1>
                    );
                  }
                  if (trimmedLine.startsWith('## ')) {
                    return (
                      <h2
                        key={lineNumber}
                        id={`section-${lineNumber}`}
                        className="text-xl font-bold mt-5 mb-3 scroll-mt-16"
                      >
                        {trimmedLine.replace('## ', '')}
                      </h2>
                    );
                  }
                  if (trimmedLine.startsWith('### ')) {
                    return (
                      <h3
                        key={lineNumber}
                        id={`section-${lineNumber}`}
                        className="text-lg font-bold mt-4 mb-2 scroll-mt-16"
                      >
                        {trimmedLine.replace('### ', '')}
                      </h3>
                    );
                  }
                  // Handle code blocks
                  if (trimmedLine.startsWith('```')) {
                    const code = trimmedLine.replace(/^```(\w+)?\s*|```$/g, '').trim();
                    return (
                      <div key={`code-${lineNumber}`} className="relative group my-4">
                        <pre className="rounded-lg overflow-x-auto bg-gray-900">
                          <code className="language-typescript block p-4">{code}</code>
                        </pre>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleCopyCode(code)}
                        >
                          {copiedCode === code ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    );
                  }
                  // Handle lists
                  if (trimmedLine.startsWith('- ')) {
                    return <li key={`list-${lineNumber}`} className="ml-6 mb-1">{trimmedLine.replace('- ', '')}</li>;
                  }
                  if (trimmedLine === '') {
                    return <br key={`br-${lineNumber}`} />;
                  }
                  // Regular paragraphs
                  return <p key={`p-${lineNumber}`} className="mb-4">{trimmedLine}</p>;
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (showIntegrationDocs) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-blue-500" />
            <CardTitle>Integration Guides</CardTitle>
          </div>
          <button 
            onClick={() => setShowIntegrationDocs(false)}
            className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to overview
          </button>
        </CardHeader>
        <CardContent>
          <div className="prose dark:prose-invert max-w-none">
            <h2>API Integration</h2>
            <p>Learn how to integrate with our API endpoints:</p>
            <ul>
              <li>Authentication and Authorization</li>
              <li>Vehicle Data Endpoints</li>
              <li>Team Management APIs</li>
              <li>Real-time Updates</li>
            </ul>

            <h2>Webhook Integration</h2>
            <p>Set up webhooks to receive real-time updates:</p>
            <ul>
              <li>Vehicle Status Changes</li>
              <li>Team Member Updates</li>
              <li>Document Processing</li>
            </ul>

            <h2>SDK Integration</h2>
            <p>Use our SDK for easier integration:</p>
            <ul>
              <li>JavaScript/TypeScript SDK</li>
              <li>Python SDK</li>
              <li>Java SDK</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center p-10">
          <Settings className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-medium mb-2">Technical Documentation</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Detailed technical specifications, architecture diagrams, and implementation guides
          </p>
          <div className="flex justify-center gap-4">
            <button 
              className="bg-primary text-primary-foreground px-4 py-2 rounded-md"
              onClick={() => setShowTechDocs(true)}
            >
              System Architecture
            </button>
            <button 
              className="border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 rounded-md"
              onClick={() => setShowIntegrationDocs(true)}
            >
              Integration Guides
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
