import React, { useState, useEffect } from 'react';
import { Tv, Radio, AlertCircle, CheckCircle, Clock, Shield, Layers } from 'lucide-react';
import { apiFetch } from '../../utils/api.js';

export function DashboardTab() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const res = await apiFetch('/api/admin/dashboard/stats');
      setStats(res.stats);
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem' }}>جاري تحميل إحصائيات لوحة التحكم...</div>;
  }

  return (
    <div>
      {/* KPI Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '1.25rem',
        marginBottom: '2rem'
      }}>
        {/* Card 1: Active Channels */}
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: '50px', height: '50px', borderRadius: '12px', background: 'rgba(6, 182, 212, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Tv size={26} color="var(--accent-cyan)" />
          </div>
          <div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block' }}>القنوات المفعلة للمشاهدين</span>
            <strong style={{ fontSize: '1.75rem', fontWeight: 800 }}>{stats?.activeChannels || 0}</strong>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', display: 'block' }}>من إجمالي {stats?.totalChannels || 0} قناة</span>
          </div>
        </div>

        {/* Card 2: Sources */}
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: '50px', height: '50px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Radio size={26} color="var(--accent-emerald)" />
          </div>
          <div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block' }}>مصادر البث المسجلة</span>
            <strong style={{ fontSize: '1.75rem', fontWeight: 800 }}>{stats?.totalSources || 0}</strong>
            <span style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)', display: 'block' }}>{stats?.activeSources || 0} قيد التشغيل</span>
          </div>
        </div>

        {/* Card 3: Sources with Issues */}
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: '50px', height: '50px', borderRadius: '12px', background: stats?.sourcesWithErrors > 0 ? 'rgba(244, 63, 94, 0.15)' : 'rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertCircle size={26} color={stats?.sourcesWithErrors > 0 ? 'var(--accent-rose)' : 'var(--text-faint)'} />
          </div>
          <div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block' }}>تنبيهات الاتصال بالمصادر</span>
            <strong style={{ fontSize: '1.75rem', fontWeight: 800, color: stats?.sourcesWithErrors > 0 ? 'var(--accent-rose)' : 'var(--text-main)' }}>
              {stats?.sourcesWithErrors || 0}
            </strong>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', display: 'block' }}>تحتاج إلى مراجعة الرابط أو المزود</span>
          </div>
        </div>

        {/* Card 4: Categories Count */}
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: '50px', height: '50px', borderRadius: '12px', background: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Layers size={26} color="var(--accent-indigo)" />
          </div>
          <div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block' }}>تصنيفات المحتوى</span>
            <strong style={{ fontSize: '1.75rem', fontWeight: 800 }}>{stats?.topCategories?.length || 0}</strong>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', display: 'block' }}>لتسهيل تصفح المشاهدين</span>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Top Categories & Recent Audit Logs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
        {/* Categories Distribution */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layers size={18} color="var(--accent-cyan)" />
            أبرز التصنيفات في المكتبة
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {stats?.topCategories?.map((c) => (
              <div key={c.category} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                <span style={{ fontWeight: 600 }}>{c.category}</span>
                <span className="badge badge-cyan">{c.count} قناة</span>
              </div>
            ))}
            {(!stats?.topCategories || stats.topCategories.length === 0) && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>لا توجد تصنيفات بعد.</p>
            )}
          </div>
        </div>

        {/* Recent Audit Logs */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Clock size={18} color="var(--accent-cyan)" />
            آخر الأنشطة والعمليات الإدارية
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {stats?.recentLogs?.map((log) => (
              <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.6rem 0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', fontSize: '0.88rem' }}>
                <Shield size={16} color="var(--accent-cyan)" style={{ marginTop: '0.2rem', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong style={{ color: 'var(--text-main)' }}>{log.action}</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                      {new Date(log.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>بواسطة: {log.admin_username}</span>
                </div>
              </div>
            ))}
            {(!stats?.recentLogs || stats.recentLogs.length === 0) && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>لا توجد سجلات بعد.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardTab;
