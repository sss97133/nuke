/**
 * Daily public grading table. Numbers come from /evidence.md when it loads;
 * this page does not carry a count of its own.
 */
import React, { useEffect, useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { parseEvidence, type Evidence } from './aboutEvidence';
import { gradesFace } from '../lib/trustFaces';

const loadEvidence = () =>
  fetch('/evidence.md', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then(parseEvidence);

const Grades: React.FC = () => {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  useEffect(() => {
    let live = true;
    loadEvidence().then((e) => { if (live) setEvidence(e); }, () => { if (live) setEvidence(null); });
    return () => { live = false; };
  }, []);
  const page = gradesFace(evidence);
  usePageTitle('Graded predictions');
  return <div dangerouslySetInnerHTML={{ __html: page.body }} />;
};

export default Grades;
