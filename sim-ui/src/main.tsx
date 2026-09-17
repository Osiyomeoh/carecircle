import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import Hero from './pages/Hero';
import Console from './pages/Console';
import TVBoard from './pages/TVBoard';

const router = createBrowserRouter([
  { path: '/', element: <Hero /> },
  { path: '/console', element: <Console /> },
  { path: '/tv', element: <TVBoard /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
