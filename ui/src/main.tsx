import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getRenderer, placeReference } from './app/actions';
import { compareWithReference, fitToReference, tunables } from './app/compare';
import { App } from './app/App';
import { engine } from './engine/client';
import { store } from './state/store';
import { clock } from './state/clock';
import { TEMPLATES } from './state/templates';
import './styles.css';

// Handles for automation and debugging (e2e tests drive the app through these).
(window as unknown as { morphotype: unknown }).morphotype = {
  store,
  engine,
  templates: TEMPLATES,
  clock,
  tools: { placeReference, compareWithReference, fitToReference, tunables },
  get renderer() {
    return getRenderer();
  },
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
