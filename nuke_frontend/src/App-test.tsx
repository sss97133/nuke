import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { supabase } from './lib/supabase';

// Simple test pages
function HomePage() {
  return <div>Home Page</div>;
}

function AboutPage() {
  return <div>About Page</div>;
}

function App() {
  return (
    <Router>
      <div>
        <nav>
          <a href="/">Home</a> | <a href="/about">About</a>
        </nav>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;