import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import { DashboardApp } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('DownFlow dashboard root element is missing.');

createRoot(root).render(
  <StrictMode>
    <DashboardApp />
  </StrictMode>,
);
