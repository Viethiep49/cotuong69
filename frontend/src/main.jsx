import './envBootstrap.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import Root from './Root';
import '../css/style.css';
import '../js/auth.js';
import '../js/api.js';
import '../js/chat.js';
import '../js/rooms.js';
import '../js/pve.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
