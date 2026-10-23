import './ui/fonts.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import './ui/oss/oss.css';
import './ui/fx3d/footer.css';
import './ui/home/home.css';
import './ui/home/home2.css';
import './ui/home/cine.css';
import './ui/app.css';
import './ui/brief.css';

// Keep the untouched page so "Download replay" can clone the viewer with a run baked in.
window.__IR_PRISTINE__ = `<!doctype html>\n${document.documentElement.outerHTML}`;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
