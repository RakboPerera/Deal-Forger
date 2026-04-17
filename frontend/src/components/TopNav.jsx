import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Settings } from 'lucide-react';
import axios from 'axios';

const routeNames = {
  '/':            'Pipeline',
  '/comparables': 'Comparables',
  '/chat':        'Chat',
  '/dashboard':   'Dashboard',
};

export default function TopNav() {
  const location = useLocation();
  const [healthy, setHealthy] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('anthropic_api_key') || '');
  const dropdownRef = useRef(null);

  // Derive breadcrumb from current path
  const pageName =
    routeNames[location.pathname] ||
    (location.pathname.startsWith('/deals/') ? 'Deal Detail' : 'Page');

  // Health check on mount
  useEffect(() => {
    axios
      .get('/api/meta/health')
      .then(() => setHealthy(true))
      .catch(() => setHealthy(false));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const saveKey = () => {
    localStorage.setItem('anthropic_api_key', apiKey);
    setShowSettings(false);
  };

  return (
    <header className="top-nav">
      <div className="top-nav-left">
        <span className="breadcrumb">{pageName}</span>
      </div>

      <div className="top-nav-right">
        <div className="health-indicator">
          <span className={`health-dot ${healthy === false ? 'offline' : ''}`} />
          {healthy === null ? 'Checking...' : healthy ? 'API Online' : 'API Offline'}
        </div>

        <div className="settings-wrapper" ref={dropdownRef}>
          <button
            className="settings-btn"
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            <Settings size={18} />
          </button>

          {showSettings && (
            <div className="settings-dropdown">
              <label>Anthropic API Key</label>
              <div className="input-group">
                <input
                  type="password"
                  placeholder="sk-ant-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                />
                <button className="btn btn-primary btn-sm" onClick={saveKey}>
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
