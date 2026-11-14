import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import { PopupApp } from './Popup';

const root = document.getElementById('root');
if (!root) throw new Error('DownFlow popup root element is missing.');

createRoot(root).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
);
