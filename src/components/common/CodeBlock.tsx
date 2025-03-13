import { useEffect, useState } from 'react';
import { getHighlighter } from 'shiki';
import { transformerTwoslash } from '@shikijs/transformers';

interface CodeBlockProps {
  code: string;
  language?: string;
  theme?: 'dark' | 'light';
  showLineNumbers?: boolean;
}

export const CodeBlock = ({
  code,
  language = 'typescript',
  theme = 'dark',
  showLineNumbers = true,
}: CodeBlockProps) => {
  const [html, setHtml] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const highlightCode = async () => {
      try {
        const highlighter = await getHighlighter({
          themes: [theme === 'dark' ? 'github-dark' : 'github-light'],
          langs: [language],
          transformers: [transformerTwoslash()]
        });

        const highlighted = await highlighter.codeToHtml(code, {
          lang: language,
          theme: theme === 'dark' ? 'github-dark' : 'github-light',
        });

        setHtml(highlighted);
      } catch (error) {
        console.error('Error highlighting code:', error);
        // Fallback to plain text if highlighting fails
        setHtml(`<pre><code>${code}</code></pre>`);
      } finally {
        setIsLoading(false);
      }
    };

    highlightCode();
  }, [code, language, theme]);

  if (isLoading) {
    return <div className="animate-pulse bg-gray-200 dark:bg-gray-700 rounded p-4">Loading...</div>;
  }

  return (
    <div className="relative">
      <div 
        className="font-mono text-sm overflow-x-auto rounded-lg"
        dangerouslySetInnerHTML={{ __html: html }} 
      />
      {showLineNumbers && (
        <div className="absolute left-0 top-0 bottom-0 w-12 bg-gray-100 dark:bg-gray-800 opacity-75" />
      )}
    </div>
  );
};
