/**
 * Compare / alternatives landings. Competitor claims are sourced in compareFaces.ts.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';
import { buildCompareFace } from '../lib/compareFaces';

const Compare: React.FC = () => {
  const { pathname } = useLocation();
  const page = buildCompareFace(pathname);
  usePageTitle(page?.title.replace(/ \| Nuke$/, '') ?? 'Compare');
  if (!page) return null;
  return <div dangerouslySetInnerHTML={{ __html: page.body }} />;
};

export default Compare;
