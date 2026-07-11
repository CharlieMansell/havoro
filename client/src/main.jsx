import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ConfirmProvider } from './components/ConfirmDialog';
import './index.css';

// When a new service worker takes control, reload so the new version is used
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });

  // Each time the app comes to the foreground, check for updates and
  // apply them immediately in one cycle — no second reopen needed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return;

      const activate = (sw) => sw.postMessage({ type: 'SKIP_WAITING' });

      // Case 1: new SW already installed and waiting
      if (reg.waiting) { activate(reg.waiting); return; }

      // Case 2: no waiting SW — fetch update; if one is found, install
      // then activate immediately (all in this single foreground event)
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            activate(sw);
          }
        });
      }, { once: true });

      reg.update().catch(() => {});
    }).catch(() => {});
  });
}

async function bootstrap() {
  // On-device mode (iOS proof-of-concept): answer /api/* from a local SQLite
  // database instead of a server. See client/src/local/localBackend.js.
  if (import.meta.env.VITE_LOCAL_BACKEND === '1') {
    const { installLocalBackend } = await import('./local/localBackend.js');
    await installLocalBackend();
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}

bootstrap();
