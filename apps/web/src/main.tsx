import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './index.css';

// 1. Viewport & Gesture Engineering
// Disable vertical pull-to-close in mobile webviews so lottery scrolling doesn't dismiss the Mini App
if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
  window.Telegram.WebApp.ready();
  window.Telegram.WebApp.expand();
  // Prevent accidental pull-to-close gesture in Telegram v7.7+:
  if ('isVerticalSwipesEnabled' in window.Telegram.WebApp) {
    (window.Telegram.WebApp as any).isVerticalSwipesEnabled = false;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
