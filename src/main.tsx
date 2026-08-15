import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { reportError } from './utils/reportError';
import './index.css';

window.addEventListener('error', (event) => {
  void reportError('renderer:window.onerror', event.error ?? event.message, {
    diagnostics: {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    },
  });
});

window.addEventListener('unhandledrejection', (event) => {
  void reportError('renderer:unhandledrejection', event.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
