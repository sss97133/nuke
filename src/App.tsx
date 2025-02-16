import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "@/components/ui/toaster";
import { BloombergTerminal } from "@/components/terminal/BloombergTerminal";
import { TokensPage } from "./pages/Tokens";
import { ImportPage } from "./pages/ImportPage";
import { Sitemap } from "./pages/Sitemap";
import { Glossary } from "./pages/Glossary";
import { Algorithms } from "./pages/Algorithms";
import { NewProject } from "./pages/NewProject";
import { ProfessionalDashboard } from "./pages/ProfessionalDashboard";
import { Skills } from "./pages/Skills";
import { Achievements } from "./pages/Achievements";
import { Settings } from "./pages/Settings";
import { Inventory } from "./pages/Inventory";
import { Service } from "./pages/Service";
import { VinScanner } from "./pages/VinScanner";
import { MarketAnalysis } from "./pages/MarketAnalysis";
import { Studio } from "./pages/Studio";
import { Streaming } from "./pages/Streaming";
import { AIExplanations } from "./pages/AIExplanations";
import { TokenAnalytics } from "./pages/TokenAnalytics";

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Router>
        <Routes>
          <Route path="/" element={<BloombergTerminal />} />
          <Route path="/tokens" element={<TokensPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/sitemap" element={<Sitemap />} />
          <Route path="/glossary" element={<Glossary />} />
          <Route path="/algorithms" element={<Algorithms />} />
          <Route path="/projects/new" element={<NewProject />} />
          <Route path="/professional" element={<ProfessionalDashboard />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/service" element={<Service />} />
          <Route path="/vin-scanner" element={<VinScanner />} />
          <Route path="/market-analysis" element={<MarketAnalysis />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/streaming" element={<Streaming />} />
          <Route path="/ai-explanations" element={<AIExplanations />} />
          <Route path="/token-analytics" element={<TokenAnalytics />} />
        </Routes>
      </Router>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
