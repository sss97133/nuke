
import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardHeader } from "@/components/dashboard/header/DashboardHeader";
import Home from "./Home";
import Login from "./Login";
import PluginDownload from "./PluginDownload";
import NotFound from "./NotFound";
import Crypto from "./Crypto";
import Discover from "./Discover";

const Index = () => {
  const handleMenuAction = (action: string) => {
    console.log('Menu action:', action);
    // Menu actions can be implemented here
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <DashboardHeader handleMenuAction={handleMenuAction} />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/plugin" element={<PluginDownload />} />
          <Route path="/crypto" element={<Crypto />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
};

export default Index;
