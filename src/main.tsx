import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import './ui/oss/oss.css';

// Keep the untouched page so "Download replay" can clone the viewer with a run baked in.
window.__IR_PRISTINE__ = `<!doctype html>\n${document.documentElement.outerHTML}`;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
