import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'framer-motion';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* iOS-like default spring for every motion.* element; honors prefers-reduced-motion. */}
    <MotionConfig transition={{type: 'spring', duration: 0.5, bounce: 0.22}} reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
