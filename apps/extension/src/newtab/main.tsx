import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerBuiltins } from '@panodash/providers';
import { App } from './App';
import '../styles/global.css';

registerBuiltins();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
