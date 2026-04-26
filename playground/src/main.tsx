import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TerminalProvider } from './contexts/TerminalContext';
import App from './App';
import './index.css';
import { Analytics } from "@vercel/analytics/react";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TerminalProvider>
      <App />
      <Analytics />
    </TerminalProvider>
  </StrictMode>
);
