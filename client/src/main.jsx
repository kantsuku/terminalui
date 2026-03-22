import { StrictMode, Component } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

function reportError(msg) {
  fetch('/api/error-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: msg }),
  }).catch(() => {});
}

window.onerror = (msg, src, line, col, err) => {
  reportError(`${msg} @ ${src}:${line}:${col}\n${err?.stack || ''}`);
};

window.onunhandledrejection = (e) => {
  reportError(`Unhandled: ${e.reason?.stack || e.reason}`);
};

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error: error.message + '\n' + error.stack };
  }
  componentDidCatch(error) {
    reportError(error.message + '\n' + error.stack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ color: '#f85149', padding: 20, fontSize: 14, whiteSpace: 'pre-wrap', background: '#0d1117', height: '100vh', overflow: 'auto' }}>
          {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
