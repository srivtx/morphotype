import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { engine } from './engine/client';
import { store } from './state/store';
import './styles.css';

// Handles for automation and debugging (e2e tests drive the app through these).
(window as unknown as { morphotype: unknown }).morphotype = { store, engine };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
