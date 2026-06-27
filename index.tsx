import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Suppress benign MediaPipe / TFLite Wasm informative logs that surface as error alerts
const origError = console.error;
console.error = (...args: any[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : (args[0]?.message || '');
  if (
    msg.includes('XNNPACK') ||
    msg.includes('TensorFlow Lite') ||
    msg.includes('Script error') ||
    msg.includes('websocket')
  ) {
    return;
  }
  origError.apply(console, args as any);
};

window.addEventListener('error', (e) => {
  if (e.message && (e.message.includes('XNNPACK') || e.message.includes('TensorFlow Lite') || e.message.includes('Script error'))) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}, true);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);