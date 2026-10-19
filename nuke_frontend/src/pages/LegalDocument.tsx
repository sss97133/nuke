import React, { useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Masthead, Text } from '../kit';
import { usePageTitle } from '../hooks/usePageTitle';
import './LegalDocument.css';

/**
 * One of the documents in public/ (privacy policy, terms, EULA, data deletion), fetched and rendered as a page.
 * Before this the pages printed the markdown source in a <pre>: literal "#" and "**" on every heading.
 * The document's own first heading is the page's entity; the words are the document's, untouched.
 */
type Props = { path: string; title: string; contact: string };

const components: Components = {
  h1: ({ children }) => <Text role="entity" as="h1">{children}</Text>,
  h2: ({ children }) => <Text role="entity" as="h2" dense>{children}</Text>,
  h3: ({ children }) => <Text role="label" as="h3">{children}</Text>,
  h4: ({ children }) => <Text role="label" as="h4">{children}</Text>,
  p: ({ children }) => <Text role="body" as="p">{children}</Text>,
  li: ({ children }) => <li><Text role="body">{children}</Text></li>,
  code: ({ children }) => <Text role="caption" as="code">{children}</Text>,
  table: ({ children }) => <div className="legal-page__table-wrap"><table>{children}</table></div>,
  th: ({ children }) => <th scope="col"><Text role="label">{children}</Text></th>,
  td: ({ children }) => <td><Text role="body">{children}</Text></td>,
};

export function LegalDocument({ path, title, contact }: Props) {
  usePageTitle(title);
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; markdown: string } | { status: 'failed' }>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    fetch(path)
      .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(markdown => { if (live) setState({ status: 'ready', markdown }); }, () => { if (live) setState({ status: 'failed' }); });
    return () => { live = false; };
  }, [path]);

  return (
    <main className="legal-page" aria-label={title}>
      {state.status === 'ready' ? (
        <section className="k-section legal-page__body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{state.markdown}</ReactMarkdown>
        </section>
      ) : (
        <Masthead result={state.status === 'failed' ? <Text role="caption">Could not load this document. Write to <a href={`mailto:${contact}`}>{contact}</a>.</Text> : undefined}>
          <Text role="entity" as="h1">{title}</Text>
        </Masthead>
      )}
    </main>
  );
}
