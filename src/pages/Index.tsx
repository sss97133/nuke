
import { useEffect } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useToast } from "@/hooks/use-toast";
import { NotFound } from "./NotFound";
import { Settings } from "./Settings";
import Login from "./Login";
import { Import } from "@/components/import/Import";
import { Glossary } from "@/components/glossary/Glossary";
import { Sitemap } from "@/components/sitemap/Sitemap";
import { Home } from "./Home";

export const Index = () => {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (!loading) {
      console.info("[Index] Current route:", location.pathname);
      if (!session && location.pathname !== "/login") {
        navigate("/login");
      }
    }
  }, [session, loading, navigate, location.pathname]);

  useEffect(() => {
    // Initial session check
    if (session) {
      console.info("[Index] Initial session check: Found");
    }
  }, [session]);

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/import" element={<Import />} />
        <Route path="/glossary" element={<Glossary />} />
        <Route path="/sitemap" element={<Sitemap />} />
      </Route>
      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default Index;
