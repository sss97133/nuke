/**
 * Human how-to for the read-only Asset Advisor MCP.
 * The protocol endpoint remains https://nuke.ag/mcp/advisor; this page does not handle MCP traffic.
 */
import React from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { mcpAdvisorFace } from '../lib/productFaces';

const McpAdvisor: React.FC = () => {
  const page = mcpAdvisorFace();
  usePageTitle('Nuke Asset Advisor MCP');
  return <div dangerouslySetInnerHTML={{ __html: page.body }} />;
};

export default McpAdvisor;
