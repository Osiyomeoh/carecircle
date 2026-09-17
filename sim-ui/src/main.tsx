import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import Hero from './pages/Hero';
import Console from './pages/Console';
import TVBoard from './pages/TVBoard';
import AmbientTV from './pages/AmbientTV';

const router = createBrowserRouter([
  { path: '/', element: <Hero /> },
  { path: '/console', element: <Console /> },
  // /tv is the Fire TV surface: an ambient TV screen with notifications.
  // /board keeps the full dashboard for close-up (browser/judge) viewing.
  { path: '/tv', element: <AmbientTV /> },
  { path: '/board', element: <TVBoard /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
