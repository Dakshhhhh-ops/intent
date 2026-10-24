import './ui/fonts.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import './ui/oss/oss.css';
import './ui/app.css';
import './ui/brief.css';

// Entry for exported replays: the run views only, no home page styles or 3D code.
window.__IR_PRISTINE__ = `<!doctype html>\n${document.documentElement.outerHTML}`;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
