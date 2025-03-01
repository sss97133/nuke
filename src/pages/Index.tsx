
import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./Login";
import PluginDownload from "./PluginDownload";
import NotFound from "./NotFound";
import Crypto from "./Crypto";

const Index = () => {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/plugin" />} />
      <Route path="/login" element={<Login />} />
      <Route path="/plugin" element={<PluginDownload />} />
      <Route path="/crypto" element={<Crypto />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default Index;
