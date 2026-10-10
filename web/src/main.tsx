import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../fonts/fonts.css';
import './styles/tokens.css';
import './styles/app.css';
import { AssistantApp } from './app/AssistantApp';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root to draw into.');
createRoot(root).render(<StrictMode><AssistantApp /></StrictMode>);
