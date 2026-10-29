import React, { useState, useEffect } from 'react';
import { Shield, Clock, User, Info, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../utils/api.js';

export function AuditLogsTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/admin/audit-logs?page=${page}&limit=25`);
      setLogs(res.logs);
      setPagination(res.pagination);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page]);

  const getActionColor = (action) => {
    if (action.includes('CREATE') || action.includes('SETUP') || action.includes('ACTIVATE')) return 'badge-success';
    if (action.includes('DELETE') || action.includes('DEACTIVATE') || action.includes('FAILED')) return 'badge-warning';
    return 'badge-cyan';
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>سجل الأنشطة والأمان (Audit Logs)</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            تتبع جميع العمليات وتغييرات المصادر والقنوات مع إخفاء وتشفير الأسرار تلقائياً
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={fetchLogs}
        >
          <RefreshCw size={16} />
          تحديث السجل
        </button>
      </div>

      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>الوقت والتاريخ</th>
              <th>المدير</th>
              <th>نوع الإجراء</th>
              <th>العنصر</th>
              <th>تفاصيل العملية (خالية من الأسرار)</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(log.created_at).toLocaleString('ar-EG', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </td>
                <td>
                  <strong style={{ fontSize: '0.9rem' }}>{log.admin_username}</strong>
                  {log.ip_address && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)', display: 'block' }}>
                      IP: {log.ip_address}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`badge ${getActionColor(log.action)}`}>
                    {log.action}
                  </span>
                </td>
                <td style={{ fontSize: '0.85rem' }}>
                  {log.entity_type ? `${log.entity_type}` : '—'}
                </td>
                <td style={{ fontSize: '0.82rem', color: 'var(--text-main)', maxWidth: '380px' }}>
                  <code style={{ background: 'rgba(0,0,0,0.3)', padding: '0.2rem 0.4rem', borderRadius: '4px', wordBreak: 'break-all' }}>
                    {log.details ? log.details : '—'}
                  </code>
                </td>
              </tr>
            ))}
            {logs.length === 0 && !loading && (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                  لا توجد سجلات نشاط مسجلة بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pagination.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            السابق
          </button>
          <span style={{ alignSelf: 'center', padding: '0 0.75rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            صفحة {page} من {pagination.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
          >
            التالي
          </button>
        </div>
      )}
    </div>
  );
}

export default AuditLogsTab;
