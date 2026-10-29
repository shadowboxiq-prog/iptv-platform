import React, { useState } from 'react';
import { 
  LayoutDashboard, Radio, Tv, Shield, Settings, 
  LogOut, ExternalLink, User
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';

import DashboardTab from './DashboardTab.jsx';
import SourcesTab from './SourcesTab.jsx';
import ChannelsTab from './ChannelsTab.jsx';
import AuditLogsTab from './AuditLogsTab.jsx';
import SettingsTab from './SettingsTab.jsx';

export function AdminLayout({ onExitToViewer }) {
  const { admin, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'sources' | 'channels' | 'logs' | 'settings'

  const navItems = [
    { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
    { id: 'sources', label: 'مصادر البث', icon: Radio },
    { id: 'channels', label: 'مكتبة القنوات', icon: Tv },
    { id: 'logs', label: 'سجل الأمان والنشاط', icon: Shield },
    { id: 'settings', label: 'الإعدادات والأمان', icon: Settings },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-dark)' }}>
      {/* Admin Top Header */}
      <header className="glass-header" style={{ padding: '0.85rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'var(--grad-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.15rem', fontWeight: 800 }}>لوحة الإدارة والتحكم</h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan-light)' }}>
              بوابة المدير المحمية
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(255,255,255,0.06)', padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-full)', fontSize: '0.85rem' }}>
            <User size={14} color="var(--accent-cyan)" />
            <span>{admin?.username || 'المدير'}</span>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem' }}
            onClick={onExitToViewer}
          >
            <ExternalLink size={15} />
            عرض واجهة المشاهد
          </button>

          <button
            type="button"
            className="btn btn-danger"
            style={{ fontSize: '0.85rem', padding: '0.45rem 0.85rem' }}
            onClick={logout}
          >
            <LogOut size={15} />
            خروج
          </button>
        </div>
      </header>

      {/* Tabs Navigation Bar */}
      <div style={{ background: 'rgba(13, 18, 31, 0.95)', borderBottom: '1px solid var(--border-subtle)', padding: '0.5rem 1.5rem', display: 'flex', gap: '0.5rem', overflowX: 'auto' }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`btn ${isActive ? 'btn-primary' : 'btn-secondary'}`}
              style={{
                fontSize: '0.88rem',
                padding: '0.55rem 1.1rem',
                borderRadius: 'var(--radius-full)',
                whiteSpace: 'nowrap'
              }}
              onClick={() => setActiveTab(item.id)}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Main Tab Content */}
      <main className="main-content" style={{ padding: '2rem 1.5rem', maxWidth: '1440px', width: '100%', margin: '0 auto' }}>
        {activeTab === 'dashboard' && <DashboardTab />}
        {activeTab === 'sources' && <SourcesTab />}
        {activeTab === 'channels' && <ChannelsTab />}
        {activeTab === 'logs' && <AuditLogsTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </main>
    </div>
  );
}

export default AdminLayout;
