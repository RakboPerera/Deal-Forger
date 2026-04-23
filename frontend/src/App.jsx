import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TopNav from './components/TopNav';
import Overview from './pages/Overview';
import Pipeline from './pages/Pipeline';
import DealDetail from './pages/DealDetail';
import DataWorkspace from './pages/DataWorkspace';
import Comparables from './pages/Comparables';
import Chat from './pages/Chat';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Reviews from './pages/Reviews';
import WelcomeModal from './components/WelcomeModal';
import ErrorBoundary from './components/ErrorBoundary';
import ToastProvider from './components/ToastContext';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <div className="app-layout">
          <Sidebar />
          <div className="main-content">
            <TopNav />
            <div className="page-content">
              <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<div style={{ margin: '-24px' }}><Overview /></div>} />
                  <Route path="/pipeline" element={<Pipeline />} />
                  <Route path="/deals/:id" element={<DealDetail />} />
                  <Route path="/data" element={<DataWorkspace />} />
                  <Route path="/comparables" element={<Comparables />} />
                  <Route path="/chat" element={<Chat />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/reviews" element={<Reviews />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </ErrorBoundary>
            </div>
          </div>
          <WelcomeModal />
        </div>
      </ToastProvider>
    </BrowserRouter>
  );
}
