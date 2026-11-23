/**
 * Human view of /use and the dealer, shop, and auction-house pages.
 * Copy comes from buildUseCaseFace so it stays in lockstep with the crawler face.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';
import { buildUseCaseFace } from '../lib/useCases';

const UseCase: React.FC = () => {
  const { pathname } = useLocation();
  const page = buildUseCaseFace(pathname);
  usePageTitle(page ? page.title.replace(/ \| Nuke$/, '') : 'Use cases');
  if (!page) return <main><p>That use-case page is not in the catalog.</p></main>;
  return <div dangerouslySetInnerHTML={{ __html: page.body }} />;
};

export default UseCase;
