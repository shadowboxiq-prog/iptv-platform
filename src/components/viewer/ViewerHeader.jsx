import React from 'react';
import { Search, Shield, Tv, Sparkles, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';

export function ViewerHeader({ 
  searchQuery, 
  onSearchChange, 
  onOpenAdminModal,
  onNavigateToAdmin,
  totalChannels = 0,
  onRefresh,
  appTitle = 'منصة البث المباشر'
}) {
  const { isAuthenticated, admin, requiresSetup } = useAuth();

  return (
    <header className="glass-header">
      <div style={{
        maxWidth: '1440px',
        margin: '0 auto',
        padding: '0.85rem 1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap'
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'var(--grad-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-glow)'
          }}>
            <Tv size={24} color="#fff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 900, lineHeight: 1.2 }}>
                {appTitle}
              </h1>
              {totalChannels > 0 && (
                <span className="badge badge-cyan" style={{ fontSize: '0.7rem', padding: '0.1rem 0.45rem' }}>
                  {totalChannels} قناة
                </span>
              )}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              مشاهدة البث الفضائي والرقمي HLS
            </span>
          </div>
        </div>

        {/* Search Bar */}
        <div style={{ flex: '1', maxWidth: '420px', minWidth: '240px', position: 'relative' }}>
          <input
            type="text"
            className="form-input"
            placeholder="ابحث عن اسم القناة أو التصنيف..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{ paddingRight: '2.5rem', borderRadius: 'var(--radius-full)' }}
          />
          <Search 
            size={18} 
            color="var(--text-muted)" 
            style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} 
          />
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {/* Refresh channels */}
          {onRefresh && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onRefresh}
              title="تحديث قائمة القنوات"
              style={{ padding: '0.55rem' }}
            >
              <RefreshCw size={16} />
            </button>
          )}

          {/* Admin Action Button */}
          {isAuthenticated ? (
            <button 
              type="button" 
              className="btn btn-primary"
              onClick={onNavigateToAdmin}
              style={{ fontSize: '0.88rem', padding: '0.55rem 1rem' }}
            >
              <Shield size={16} />
              لوحة الإدارة ({admin?.username})
            </button>
          ) : requiresSetup ? (
            <button 
              type="button" 
              className="btn btn-primary"
              onClick={onOpenAdminModal}
              style={{ fontSize: '0.88rem', padding: '0.55rem 1rem', background: 'var(--grad-accent)' }}
            >
              <Sparkles size={16} />
              إعداد أول مدير
            </button>
          ) : (
            <button 
              type="button" 
              className="btn btn-secondary"
              onClick={onOpenAdminModal}
              style={{ fontSize: '0.88rem', padding: '0.55rem 1rem' }}
            >
              <Shield size={16} />
              دخول الإدارة
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export default ViewerHeader;
