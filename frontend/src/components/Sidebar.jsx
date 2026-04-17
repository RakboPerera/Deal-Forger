import { Link, useLocation } from 'react-router-dom';
import { Home, LayoutDashboard, BarChart3, MessageSquare, PieChart, Database, Settings, ShieldCheck } from 'lucide-react';

const navItems = [
  { to: '/',            label: 'Overview',        icon: Home },
  { to: '/pipeline',    label: 'Pipeline',        icon: LayoutDashboard },
  { to: '/data',        label: 'Data Workspace',  icon: Database },
  { to: '/comparables', label: 'Comparables',     icon: BarChart3 },
  { to: '/reviews',     label: 'Reviews',         icon: ShieldCheck },
  { to: '/chat',        label: 'Chat',            icon: MessageSquare },
  { to: '/dashboard',   label: 'Dashboard',       icon: PieChart },
  { to: '/settings',    label: 'Settings',        icon: Settings },
];

export default function Sidebar() {
  const location = useLocation();

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <h1>DealForge</h1>
        <span>Deal Analysis</span>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={isActive(item.to) ? 'active' : ''}
          >
            <item.icon size={18} />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">v1.0.0</div>
    </aside>
  );
}
