import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, ArrowLeft, Search, Copy, Check } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { codeToHtml } from 'shiki';
import { useEffect, useCallback } from 'react';

// Import technical documentation as a string
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

interface TableOfContentsItem {
  title: string;
  level: number;
  id: string;
}

export const TechTab = () => {
  const [showTechDocs, setShowTechDocs] = useState(false);
  const [showIntegrationDocs, setShowIntegrationDocs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [highlightedCode, setHighlightedCode] = useState<{ [key: string]: string }>({});

  const highlightCode = useCallback(async (code: string) => {
    try {
      // Only highlight if not already cached
      if (!highlightedCode[code]) {
        const html = await codeToHtml(code, {
          lang: 'typescript',
          theme: 'dark-plus'
        });
        setHighlightedCode(prev => ({ ...prev, [code]: html }));
      }
    } catch (error) {
      console.error('Failed to highlight code:', error);
    }
  }, [highlightedCode]);

  useEffect(() => {
    // Find all code blocks and highlight them
    TECHNICAL_DOC.split('\n').forEach((line) => {
      if (line.startsWith('```')) {
        const code = line.replace('```', '').trim();
        if (code) {
          highlightCode(code);
        }
      }
    });
  }, [highlightCode]);

  const tableOfContents = useMemo(() => {
    const items: TableOfContentsItem[] = [];
    TECHNICAL_DOC.split('\n').forEach((line, index) => {
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

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const filteredContent = useMemo(() => {
    if (!searchQuery) return TECHNICAL_DOC;
    const lines = TECHNICAL_DOC.split('\n');
    return lines
      .filter(line => 
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
                onChange={(e) => setSearchQuery(e.target.value)}
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
                {filteredContent.split('\n').map((paragraph, index) => {
                  // Handle headers
                  if (paragraph.startsWith('# ')) {
                    return (
                      <h1 
                        key={index} 
                        id={`section-${index}`}
                        className="text-2xl font-bold mt-6 mb-4 scroll-mt-16"
                      >
                        {paragraph.replace('# ', '')}
                      </h1>
                    );
                  }
                  if (paragraph.startsWith('## ')) {
                    return (
                      <h2 
                        key={index} 
                        id={`section-${index}`}
                        className="text-xl font-bold mt-5 mb-3 scroll-mt-16"
                      >
                        {paragraph.replace('## ', '')}
                      </h2>
                    );
                  }
                  if (paragraph.startsWith('### ')) {
                    return (
                      <h3 
                        key={index} 
                        id={`section-${index}`}
                        className="text-lg font-bold mt-4 mb-2 scroll-mt-16"
                      >
                        {paragraph.replace('### ', '')}
                      </h3>
                    );
                  }
                  // Handle code blocks
                  if (paragraph.startsWith('```')) {
                    const code = paragraph.replace('```', '').trim();
                    return (
                      <div key={index} className="relative group">
                        <div className="relative rounded-md bg-[#1E1E1E] p-4 overflow-x-auto">
                          <div 
                            dangerouslySetInnerHTML={{ 
                              __html: highlightedCode[code] || `<pre class="text-white">${code}</pre>`
                            }} 
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleCopyCode(code)}
                        >
                          {copiedCode === code ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    );
                  }
                  // Handle lists
                  if (paragraph.startsWith('- ')) {
                    return <li key={index} className="ml-6 mb-1">{paragraph.replace('- ', '')}</li>;
                  }
                  if (paragraph.trim() === '') {
                    return <br key={index} />;
                  }
                  // Regular paragraphs
                  return <p key={index} className="mb-4">{paragraph}</p>;
                })}
              </div>
            </div>
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