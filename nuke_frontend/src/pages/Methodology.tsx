/**
 * Human and crawler methodology page. Numbers live on /about when /evidence.md loads;
 * this page states the citation, confidence, and recorded-sale rules already in the repo.
 */
import React from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { methodologyFace } from '../lib/trustFaces';

const Methodology: React.FC = () => {
  const page = methodologyFace();
  usePageTitle('Methodology');
  return <div dangerouslySetInnerHTML={{ __html: page.body }} />;
};

export default Methodology;
