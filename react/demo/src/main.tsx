// SPDX-License-Identifier: MIT
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
// #1140 — Tailwind's three directives plus the `--bc-*` design-token custom
// properties. Importing this file is what makes the demo's styles compile; the
// matching PostCSS pipeline is configured in `react/demo/postcss.config.js`.
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('bc-forge demo: #root is missing from index.html');
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);