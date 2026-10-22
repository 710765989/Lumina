import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppM1 as App } from './AppM1';
import './styles.css';
import './styles-m1.css';
import './styles-m2.css';
import './styles-interactions.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
