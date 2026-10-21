import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getRenderer, placeReference } from './app/actions';
import { compareWithReference, fitToReference, tunables } from './app/compare';
import { App } from './app/App';
import { holdLiveGeometry, liveStats } from './app/geoMotion';
import { engine } from './engine/client';
import { store } from './state/store';
import { clock } from './state/clock';
import { loadedTemplates, loadTemplates } from './state/templateCatalog';
import './styles.css';

// Handles for automation and debugging (e2e tests drive the app through these).
(window as unknown as { morphotype: unknown }).morphotype = {
  store,
  engine,
  // The template list loads in its own chunk: null until then, or await loadTemplates().
  get templates() {
    return loadedTemplates();
  },
  loadTemplates,
  clock,
  liveGeometry: { stats: liveStats, hold: holdLiveGeometry },
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
