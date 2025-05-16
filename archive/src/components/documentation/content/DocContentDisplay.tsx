
import React from 'react';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DocContentDisplayProps {
  content: string;
  title: string;
  onBack: () => void;
  section?: string;
}

export const DocContentDisplay = ({ content, title, onBack, section }: DocContentDisplayProps) => {
  // If a specific section is requested, extract just that section from the content
  const displayContent = React.useMemo(() => {
    if (!section) return content;
    
    // Parse the markdown to find the requested section
    const lines = content.split('\n');
    const sectionStartPattern = new RegExp(`^###\\s+.*${section}.*$`, 'i');
    
    let sectionStart = -1;
    let sectionEnd = lines.length;
    
    // Find the start of the requested section
    for (let i = 0; i < lines.length; i++) {
      if (sectionStartPattern.test(lines[i])) {
        sectionStart = i;
        break;
      }
    }
    
    // If section is found, find where it ends (next ### or end of content)
    if (sectionStart !== -1) {
      for (let i = sectionStart + 1; i < lines.length; i++) {
        if (lines[i].startsWith('### ')) {
          sectionEnd = i;
          break;
        }
      }
      
      return lines.slice(sectionStart, sectionEnd).join('\n');
    }
    
    // If section not found, return full content
    return content;
  }, [content, section]);

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-blue-500" />
          <CardTitle>{title}</CardTitle>
        </div>
        <button 
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </button>
      </CardHeader>
      <CardContent>
        <div className="prose dark:prose-invert max-w-none">
          {displayContent.split('\n').map((paragraph, index) => {
            // Handle headers
            if (paragraph.startsWith('# ')) {
              return <h1 key={index} className="text-2xl font-bold mt-6 mb-4">{paragraph.replace('# ', '')}</h1>;
            }
            if (paragraph.startsWith('## ')) {
              return <h2 key={index} className="text-xl font-bold mt-5 mb-3">{paragraph.replace('## ', '')}</h2>;
            }
            if (paragraph.startsWith('### ')) {
              return <h3 key={index} className="text-lg font-bold mt-4 mb-2">{paragraph.replace('### ', '')}</h3>;
            }
            // Handle lists
            if (paragraph.startsWith('- ')) {
              return <li key={index} className="ml-6 mb-1">{paragraph.replace('- ', '')}</li>;
            }
            // Handle code blocks (simple version)
            if (paragraph.startsWith('```')) {
              return null; // Skip the code block delimiters
            }
            if (paragraph.trim() === '') {
              return <br key={index} />;
            }
            // Regular paragraphs
            return <p key={index} className="mb-4">{paragraph}</p>;
          })}
        </div>
      </CardContent>
    </Card>
  );
};
