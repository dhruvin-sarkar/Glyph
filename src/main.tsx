import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Fonts are bundled locally (no CDN) so the exhibit works fully offline.
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import '@fontsource-variable/geist';

import './styles/index.css';
import App from './App';
import { installDebugHandle } from './debug';

installDebugHandle();

const root = document.getElementById('root');
if (!root) throw new Error('GLYPHFIELD: #root element missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
