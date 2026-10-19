import React from 'react';
import { LegalDocument } from './LegalDocument';

const EULA: React.FC = () => <LegalDocument path="/EULA.md" title="End-User License Agreement" contact="legal@nuke.ag" />;

export default EULA;
