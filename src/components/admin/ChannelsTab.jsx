import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { 
  Search, Filter, Edit, Trash2, CheckCircle2, XCircle, 
  ToggleLeft, ToggleRight, Radio, ExternalLink, Save, Layers,
  Plus, Play, Eye, RotateCcw, AlertTriangle, Check
} from 'lucide-react';
import { apiFetch } from '../../utils/api.js';
import Modal from '../common/Modal.jsx';

export function ChannelsTab() {
  const [channels, setChannels] = useState([]);
  const [sources, setSources] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sourceId, setSourceId] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState([]);

  // Add Channel Modal
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addFormData, setAddFormData] = useState({
    name: '',
    category: '',
    logoUrl: '',
    sortOrder: 0,
    isActive: true,
    streamUrl: '',
    backupSources: [],
    sourceId: ''
  });
  const [addLoading, setAddLoading] = useState(false);
  const [addMessage, setAddMessage] = useState('');

  // Edit Modal
  const [editingChannel, setEditingChannel] = useState(null);
  const [editFormData, setEditFormData] = useState({
    name: '',
    category: '',
    logoUrl: '',
    sortOrder: 0,
    isActive: true,
    streamUrl: '',
    backupSources: [],
    useBackup: 0
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editMessage, setEditMessage] = useState('');

  // Helpers for dynamic backup sources
  const handleAddBackupRowAdd = () => {
    setAddFormData(prev => ({
      ...prev,
      backupSources: [
        ...prev.backupSources,
        { id: String(Date.now()), name: `سيرفر بديل ${prev.backupSources.length + 1}`, url: '' }
      ]
    }));
  };

  const handleUpdateBackupAdd = (idx, field, value) => {
    setAddFormData(prev => {
      const updated = [...prev.backupSources];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, backupSources: updated };
    });
  };

  const handleRemoveBackupAdd = (idx) => {
    setAddFormData(prev => ({
      ...prev,
      backupSources: prev.backupSources.filter((_, i) => i !== idx)
    }));
  };

  const handleAddBackupRowEdit = () => {
    setEditFormData(prev => ({
      ...prev,
      backupSources: [
        ...prev.backupSources,
        { id: String(Date.now()), name: `سيرفر بديل ${prev.backupSources.length + 1}`, url: '' }
      ]
    }));
  };

  const handleUpdateBackupEdit = (idx, field, value) => {
    setEditFormData(prev => {
      const updated = [...prev.backupSources];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, backupSources: updated };
    });
  };

  const handleRemoveBackupEdit = (idx) => {
    setEditFormData(prev => {
      const updated = prev.backupSources.filter((_, i) => i !== idx);
      let newUseBackup = prev.useBackup;
      if (prev.useBackup === idx + 1) {
        newUseBackup = 0;
      } else if (prev.useBackup > idx + 1) {
        newUseBackup = prev.useBackup - 1;
      }
      return { ...prev, backupSources: updated, useBackup: newUseBackup };
    });
  };

  // Live Stream Preview Modal
  const [previewChannel, setPreviewChannel] = useState(null);

  const fetchChannels = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        search,
        category,
        sourceId,
        status,
        page: String(page),
        limit: '30'
      });
      const res = await apiFetch(`/api/admin/channels?${queryParams.toString()}`);
      setChannels(res.channels);
      setPagination(res.pagination);
    } catch (err) {
      console.error('Failed to load channels:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSourcesAndCategories = async () => {
    try {
      const [sourcesRes, catRes] = await Promise.all([
        apiFetch('/api/admin/sources'),
        apiFetch('/api/admin/channels/categories')
      ]);
      setSources(sourcesRes.sources || []);
      setCategories(catRes.categories || []);
    } catch (err) {
      console.warn('Failed to load filter metadata:', err);
    }
  };

  useEffect(() => {
    fetchSourcesAndCategories();
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [search, category, sourceId, status, page]);

  // Quick toggle single channel active status
  const handleToggleActive = async (chId) => {
    try {
      const res = await apiFetch(`/api/admin/channels/${chId}/toggle`, { method: 'PATCH' });
      setChannels(prev => prev.map(ch => ch.id === chId ? { ...ch, is_active: res.isActive ? 1 : 0 } : ch));
    } catch (err) {
      alert(`خطأ: ${err.message}`);
    }
  };

  // Bulk toggle
  const handleBulkToggle = async (activate) => {
    if (selectedIds.length === 0) return;
    try {
      await apiFetch('/api/admin/channels/bulk-toggle', {
        method: 'POST',
        body: { channelIds: selectedIds, activate }
      });
      setSelectedIds([]);
      fetchChannels();
    } catch (err) {
      alert(`خطأ في الإجراء المجمع: ${err.message}`);
    }
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const confirmed = window.confirm(`هل أنت متأكد من حذف ${selectedIds.length} قناة محددة نهائياً من المكتبة؟`);
    if (!confirmed) return;

    try {
      await apiFetch('/api/admin/channels/bulk-delete', {
        method: 'POST',
        body: { channelIds: selectedIds }
      });
      setSelectedIds([]);
      fetchChannels();
      fetchSourcesAndCategories();
    } catch (err) {
      alert(`خطأ في الحذف المجمع: ${err.message}`);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = async (ch) => {
    try {
      const res = await apiFetch(`/api/admin/channels/${ch.id}`);
      setEditingChannel(res.channel);

      let sources = [];
      if (res.channel.backupSources && Array.isArray(res.channel.backupSources)) {
        sources = res.channel.backupSources;
      } else if (res.channel.backupStreamUrl) {
        sources = [{ id: '1', name: 'سيرفر بديل 1', url: res.channel.backupStreamUrl }];
      }

      const activeIndex = typeof res.channel.use_backup === 'number'
        ? res.channel.use_backup
        : (res.channel.use_backup ? 1 : 0);

      setEditFormData({
        name: res.channel.name || '',
        category: res.channel.category || '',
        logoUrl: res.channel.logo_url || '',
        sortOrder: res.channel.sort_order || 0,
        isActive: res.channel.is_active === 1,
        streamUrl: res.channel.streamUrl || '',
        backupSources: sources,
        useBackup: activeIndex
      });
      setEditMessage('');
    } catch (err) {
      alert(`تعذر جلب تفاصيل القناة: ${err.message}`);
    }
  };

  // Submit Edit Modal
  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingChannel) return;
    setEditLoading(true);
    setEditMessage('');

    try {
      await apiFetch(`/api/admin/channels/${editingChannel.id}`, {
        method: 'PUT',
        body: editFormData
      });
      setEditMessage('تم حفظ التعديلات بنجاح');
      fetchChannels();
      fetchSourcesAndCategories();
      setTimeout(() => {
        setEditingChannel(null);
      }, 900);
    } catch (err) {
      setEditMessage(`خطأ في الحفظ: ${err.message}`);
    } finally {
      setEditLoading(false);
    }
  };

  // Submit Add Channel
  const handleSaveAdd = async (e) => {
    e.preventDefault();
    setAddLoading(true);
    setAddMessage('');

    try {
      await apiFetch('/api/admin/channels', {
        method: 'POST',
        body: addFormData
      });
      setAddMessage('تمت إضافة القناة بنجاح!');
      fetchChannels();
      fetchSourcesAndCategories();
      setTimeout(() => {
        setIsAddOpen(false);
        setAddFormData({
          name: '',
          category: '',
          logoUrl: '',
          sortOrder: 0,
          isActive: true,
          streamUrl: '',
          backupSources: [],
          sourceId: ''
        });
        setAddMessage('');
      }, 900);
    } catch (err) {
      setAddMessage(`خطأ: ${err.message}`);
    } finally {
      setAddLoading(false);
    }
  };

  // Delete channel
  const handleDeleteChannel = async (chId, chName) => {
    if (!window.confirm(`هل أنت متأكد من حذف قناة "${chName}" نهائياً من المكتبة؟`)) return;
    try {
      await apiFetch(`/api/admin/channels/${chId}`, { method: 'DELETE' });
      fetchChannels();
      fetchSourcesAndCategories();
    } catch (err) {
      alert(`خطأ في الحذف: ${err.message}`);
    }
  };

  // Toggle selection
  const toggleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(channels.map(c => c.id));
    } else {
      setSelectedIds([]);
    }
  };

  const toggleSelectOne = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>مكتبة القنوات الموحدة</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            تنظيم وتفعيل القنوات، فحص البث المباشر، وتحديث الروابط المشفرة والبديلة
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Bulk Action Controls */}
          {selectedIds.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(6,182,212,0.1)', padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid rgba(6,182,212,0.25)' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-cyan-light)' }}>
                تم تحديد {selectedIds.length} قناة:
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}
                onClick={() => handleBulkToggle(true)}
              >
                تفعيل
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}
                onClick={() => handleBulkToggle(false)}
              >
                تعطيل
              </button>
              <button
                type="button"
                className="btn btn-danger"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}
                onClick={handleBulkDelete}
              >
                <Trash2 size={13} />
                حذف المحدد
              </button>
            </div>
          )}

          {/* Add Channel Button */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setAddMessage('');
              setIsAddOpen(true);
            }}
          >
            <Plus size={18} />
            إضافة قناة جديدة
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
        <div style={{ flex: '1', minWidth: '220px', position: 'relative' }}>
          <input
            type="text"
            className="form-input"
            placeholder="البحث بالاسم أو المعرف..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ paddingRight: '2.5rem' }}
          />
          <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', right: '0.9rem', top: '50%', transform: 'translateY(-50%)' }} />
        </div>

        {/* Category Filter */}
        <select
          className="form-select"
          style={{ width: 'auto', minWidth: '140px' }}
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(1); }}
        >
          <option value="all">التصنيف: الكل</option>
          {categories.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Source Filter */}
        <select
          className="form-select"
          style={{ width: 'auto', minWidth: '150px' }}
          value={sourceId}
          onChange={(e) => { setSourceId(e.target.value); setPage(1); }}
        >
          <option value="all">جميع المصادر</option>
          {sources.map(s => (
            <option key={s.id} value={s.id}>{s.name} ({s.type})</option>
          ))}
        </select>

        {/* Status Filter */}
        <select
          className="form-select"
          style={{ width: 'auto', minWidth: '130px' }}
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        >
          <option value="all">الحالة: الكل</option>
          <option value="active">مفعلة فقط</option>
          <option value="inactive">معطلة فقط</option>
        </select>
      </div>

      {/* Channels Table */}
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={channels.length > 0 && selectedIds.length === channels.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th>القناة</th>
              <th>التصنيف</th>
              <th>المصدر</th>
              <th>الترتيب</th>
              <th>الحالة للمشاهدين</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <tr key={ch.id}>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(ch.id)}
                    onChange={() => toggleSelectOne(ch.id)}
                  />
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                      {ch.logo_url ? (
                        <img 
                          src={ch.logo_url} 
                          alt={ch.name} 
                          style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <Radio size={18} color="var(--accent-cyan)" />
                      )}
                    </div>
                    <div>
                      <strong style={{ fontSize: '0.95rem' }}>{ch.name}</strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.15rem', flexWrap: 'wrap' }}>
                        {ch.external_id && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
                            ID: {ch.external_id}
                          </span>
                        )}
                        {(ch.sourcesCount > 1 || ch.hasBackup) && (
                          <span 
                            className="badge" 
                            style={{ 
                              fontSize: '0.68rem', 
                              padding: '0.08rem 0.45rem', 
                              background: 'rgba(56, 189, 248, 0.15)', 
                              color: 'var(--accent-cyan-light)', 
                              border: '1px solid rgba(56, 189, 248, 0.3)' 
                            }}
                            title={`${ch.sourcesCount || 2} مصادر بث متاحة`}
                          >
                            {ch.sourcesCount || 2} مصادر بث
                          </span>
                        )}
                        {ch.use_backup > 0 && (
                          <span className="badge badge-warning" style={{ fontSize: '0.68rem', padding: '0.08rem 0.45rem' }}>
                            يعمل على: {ch.activeSourceName || `بديل ${ch.use_backup}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="badge badge-cyan">{ch.category || 'عام'}</span>
                  {ch.streamType === 'video' && (
                    <span className="badge" style={{ marginRight: '0.4rem', fontSize: '0.72rem', background: 'rgba(236,72,153,0.15)', color: '#f472b6', border: '1px solid rgba(244,114,182,0.3)' }}>
                      VOD / مسلسلات
                    </span>
                  )}
                </td>
                <td>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {ch.source_name || 'قناة يدوية'}
                  </span>
                </td>
                <td>{ch.sort_order}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(ch.id)}
                    className="btn"
                    style={{
                      padding: '0.3rem 0.7rem',
                      fontSize: '0.8rem',
                      borderRadius: 'var(--radius-full)',
                      background: ch.is_active === 1 ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
                      color: ch.is_active === 1 ? 'var(--accent-emerald)' : 'var(--text-faint)',
                      border: `1px solid ${ch.is_active === 1 ? 'rgba(16,185,129,0.3)' : 'var(--border-subtle)'}`
                    }}
                  >
                    {ch.is_active === 1 ? 'مفعلة' : 'معطلة'}
                  </button>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {/* Live Preview Button */}
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => setPreviewChannel(ch)}
                      title="معاينة وتشغيل البث المباشر"
                      style={{ color: 'var(--accent-emerald)' }}
                    >
                      <Play size={16} />
                    </button>

                    {/* Edit Channel Button */}
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => handleOpenEdit(ch)}
                      title="تعديل بيانات ورابط القناة"
                      style={{ color: 'var(--accent-cyan)' }}
                    >
                      <Edit size={16} />
                    </button>

                    {/* Delete Channel Button */}
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => handleDeleteChannel(ch.id, ch.name)}
                      title="حذف القناة"
                      style={{ color: 'var(--accent-rose)' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {channels.length === 0 && !loading && (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                  لا توجد قنوات مطابقة لشروط البحث والتصفية.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
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
            صفحة {page} من {pagination.totalPages} (إجمالي {pagination.total} قناة)
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

      {/* Add Channel Modal */}
      <Modal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="إضافة قناة جديدة للمكتبة"
        maxWidth="640px"
      >
        <form onSubmit={handleSaveAdd}>
          {addMessage && (
            <div style={{
              background: addMessage.includes('خطأ') ? 'rgba(244,63,94,0.15)' : 'rgba(16,185,129,0.15)',
              color: addMessage.includes('خطأ') ? 'var(--accent-rose)' : 'var(--accent-emerald)',
              padding: '0.75rem',
              borderRadius: '8px',
              marginBottom: '1rem',
              fontSize: '0.88rem'
            }}>
              {addMessage}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">اسم القناة *</label>
              <input
                type="text"
                required
                className="form-input"
                placeholder="مثال: الجزيرة الإخبارية HD"
                value={addFormData.name}
                onChange={(e) => setAddFormData({ ...addFormData, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">التصنيف</label>
              <input
                type="text"
                className="form-input"
                placeholder="مثال: أخبار، رياضة"
                list="category-suggestions"
                value={addFormData.category}
                onChange={(e) => setAddFormData({ ...addFormData, category: e.target.value })}
              />
              <datalist id="category-suggestions">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">رابط الشعار (Logo URL)</label>
              <input
                type="url"
                className="form-input"
                placeholder="https://example.com/logo.png"
                value={addFormData.logoUrl}
                onChange={(e) => setAddFormData({ ...addFormData, logoUrl: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">المصدر المرتبط (اختياري)</label>
              <select
                className="form-select"
                value={addFormData.sourceId}
                onChange={(e) => setAddFormData({ ...addFormData, sourceId: e.target.value })}
              >
                <option value="">قناة يدوية مستقلة</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              رابط البث أو الفيديو (HLS / m3u8 / MKV / MP4 / VOD / مسلسلات وأفلام) *
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', marginRight: '0.5rem' }}>
                (يتم تشفيره فورياً ولا يظهر في واجهة المشاهد)
              </span>
            </label>
            <input
              type="url"
              required
              className="form-input"
              placeholder="https://example.com/stream.m3u8 أو http://domain/play/movie.php?..."
              value={addFormData.streamUrl}
              onChange={(e) => setAddFormData({ ...addFormData, streamUrl: e.target.value })}
            />
          </div>

          {/* Multiple Backup Sources Section */}
          <div style={{ marginTop: '1.25rem', marginBottom: '1.25rem', padding: '1rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <label className="form-label" style={{ marginBottom: '0.15rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                  مصادر البث البديلة (اختياري - للاحتياط عند تعطل الأساسي)
                </label>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  يمكنك إضافة أكثر من مصدر بث بديل مع تسمية كل سيرفر (سيرفر 2، سيرفر 3...).
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={handleAddBackupRowAdd}
              >
                <Plus size={14} /> إضافة مصدر بث بديل
              </button>
            </div>

            {addFormData.backupSources.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '0.85rem', color: 'var(--text-faint)', fontSize: '0.82rem', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                لا توجد مصادر بديلة مضافة. اضغط على "+ إضافة مصدر بث بديل" بالأعلى لإضافة رابط احتياطي.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {addFormData.backupSources.map((backup, idx) => (
                  <div 
                    key={backup.id || idx}
                    style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'rgba(0,0,0,0.25)', padding: '0.55rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <div style={{ width: '140px', flexShrink: 0 }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder={`سيرفر بديل ${idx + 1}`}
                        value={backup.name}
                        onChange={(e) => handleUpdateBackupAdd(idx, 'name', e.target.value)}
                        style={{ fontSize: '0.82rem', padding: '0.35rem 0.55rem' }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <input
                        type="url"
                        className="form-input"
                        placeholder="https://example.com/backup.m3u8"
                        value={backup.url}
                        onChange={(e) => handleUpdateBackupAdd(idx, 'url', e.target.value)}
                        style={{ fontSize: '0.82rem', padding: '0.35rem 0.55rem' }}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => handleRemoveBackupAdd(idx)}
                      title="حذف هذا المصدر البديل"
                      style={{ color: 'var(--accent-rose)', padding: '0.35rem' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '1rem 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={addFormData.isActive}
                onChange={(e) => setAddFormData({ ...addFormData, isActive: e.target.checked })}
              />
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>تفعيل القناة فوراً للمشاهدين</span>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label className="form-label" style={{ marginBottom: 0, fontSize: '0.85rem' }}>الترتيب:</label>
              <input
                type="number"
                className="form-input"
                style={{ width: '80px', padding: '0.35rem 0.5rem' }}
                value={addFormData.sortOrder}
                onChange={(e) => setAddFormData({ ...addFormData, sortOrder: parseInt(e.target.value, 10) || 0 })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsAddOpen(false)}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={addLoading}
              className="btn btn-primary"
            >
              {addLoading ? 'جاري الإضافة...' : 'إضافة القناة الآن'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Channel Modal */}
      <Modal
        isOpen={!!editingChannel}
        onClose={() => setEditingChannel(null)}
        title={`تعديل القناة: ${editingChannel?.name}`}
        maxWidth="620px"
      >
        <form onSubmit={handleSaveEdit}>
          {editMessage && (
            <div style={{ background: editMessage.includes('خطأ') ? 'rgba(244,63,94,0.15)' : 'rgba(16,185,129,0.15)', color: editMessage.includes('خطأ') ? 'var(--accent-rose)' : 'var(--accent-emerald)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.88rem' }}>
              {editMessage}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">اسم القناة</label>
              <input
                type="text"
                required
                className="form-input"
                value={editFormData.name}
                onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">التصنيف</label>
              <input
                type="text"
                className="form-input"
                list="category-suggestions"
                value={editFormData.category}
                onChange={(e) => setEditFormData({ ...editFormData, category: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">رابط الشعار (Logo URL)</label>
            <input
              type="url"
              className="form-input"
              value={editFormData.logoUrl}
              onChange={(e) => setEditFormData({ ...editFormData, logoUrl: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              رابط البث الأساسي (سيرفر 1 - HLS / m3u8 / MKV / MP4 / VOD / TS) *
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', marginRight: '0.5rem' }}>
                (يتم تشفيره دائماً ولا يظهر للزوار)
              </span>
            </label>
            <input
              type="text"
              required
              className="form-input"
              value={editFormData.streamUrl}
              onChange={(e) => setEditFormData({ ...editFormData, streamUrl: e.target.value })}
            />
          </div>

          {/* Multiple Backup Sources Section */}
          <div style={{ marginTop: '1.25rem', marginBottom: '1.25rem', padding: '1rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <label className="form-label" style={{ marginBottom: '0.15rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                  مصادر البث البديلة (اختياري - للاحتياط عند تعطل الأساسي)
                </label>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  يمكنك إضافة أكثر من مصدر بث بديل مع تسمية مخصصة لكل سيرفر (سيرفر 2، سيرفر 3...).
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={handleAddBackupRowEdit}
              >
                <Plus size={14} /> إضافة مصدر بث بديل
              </button>
            </div>

            {editFormData.backupSources.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '0.85rem', color: 'var(--text-faint)', fontSize: '0.82rem', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                لا توجد مصادر بديلة مضافة. اضغط على "+ إضافة مصدر بث بديل" بالأعلى لإضافة رابط احتياطي.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {editFormData.backupSources.map((backup, idx) => (
                  <div 
                    key={backup.id || idx}
                    style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'rgba(0,0,0,0.25)', padding: '0.55rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <div style={{ width: '140px', flexShrink: 0 }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder={`سيرفر بديل ${idx + 1}`}
                        value={backup.name}
                        onChange={(e) => handleUpdateBackupEdit(idx, 'name', e.target.value)}
                        style={{ fontSize: '0.82rem', padding: '0.35rem 0.55rem' }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="https://example.com/backup.m3u8"
                        value={backup.url}
                        onChange={(e) => handleUpdateBackupEdit(idx, 'url', e.target.value)}
                        style={{ fontSize: '0.82rem', padding: '0.35rem 0.55rem' }}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => handleRemoveBackupEdit(idx)}
                      title="حذف هذا المصدر البديل"
                      style={{ color: 'var(--accent-rose)', padding: '0.35rem' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Default Source Selector */}
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" style={{ fontWeight: 700, marginBottom: '0.5rem' }}>
              المصدر النشط افتراضياً للبث:
            </label>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                cursor: 'pointer',
                padding: '0.45rem 0.85rem',
                borderRadius: 'var(--radius-sm)',
                background: editFormData.useBackup === 0 ? 'rgba(6,182,212,0.18)' : 'rgba(255,255,255,0.03)',
                border: editFormData.useBackup === 0 ? '1px solid var(--accent-cyan)' : '1px solid rgba(255,255,255,0.08)',
                color: editFormData.useBackup === 0 ? 'var(--accent-cyan-light)' : 'var(--text-muted)'
              }}>
                <input
                  type="radio"
                  name="activeSourceChoice"
                  checked={editFormData.useBackup === 0}
                  onChange={() => setEditFormData({ ...editFormData, useBackup: 0 })}
                />
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>المصدر الأساسي</span>
              </label>

              {editFormData.backupSources.map((backup, idx) => {
                const isSelected = editFormData.useBackup === idx + 1;
                return (
                  <label key={idx} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    cursor: 'pointer',
                    padding: '0.45rem 0.85rem',
                    borderRadius: 'var(--radius-sm)',
                    background: isSelected ? 'rgba(245, 158, 11, 0.18)' : 'rgba(255,255,255,0.03)',
                    border: isSelected ? '1px solid var(--accent-amber)' : '1px solid rgba(255,255,255,0.08)',
                    color: isSelected ? 'var(--accent-amber)' : 'var(--text-muted)'
                  }}>
                    <input
                      type="radio"
                      name="activeSourceChoice"
                      checked={isSelected}
                      onChange={() => setEditFormData({ ...editFormData, useBackup: idx + 1 })}
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                      {backup.name || `سيرفر بديل ${idx + 1}`}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', margin: '1rem 0', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={editFormData.isActive}
                onChange={(e) => setEditFormData({ ...editFormData, isActive: e.target.checked })}
              />
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>مفعلة للمشاهدين</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEditingChannel(null)}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={editLoading}
              className="btn btn-primary"
            >
              {editLoading ? 'جاري الحفظ...' : 'حفظ التعديلات'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Stream Live Preview Modal */}
      {previewChannel && (
        <ChannelPreviewModal
          channel={previewChannel}
          onClose={() => setPreviewChannel(null)}
          onToggleActive={async (chId) => {
            await handleToggleActive(chId);
            setPreviewChannel(prev => prev ? { ...prev, is_active: prev.is_active === 1 ? 0 : 1 } : null);
          }}
        />
      )}
    </div>
  );
}

// Mini Preview Modal for Live Inspection
function ChannelPreviewModal({ channel, onClose, onToggleActive }) {
  const videoRef = useRef(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewSourceIndex, setPreviewSourceIndex] = useState(channel.activeSourceIndex || 0);

  const sources = (channel.streamSources && channel.streamSources.length > 0)
    ? channel.streamSources
    : [{ index: 0, name: 'المصدر الأساسي', streamType: channel.streamType }];

  useEffect(() => {
    let hls = null;
    let mpegPlayer = null;
    const video = videoRef.current;
    if (!video) return;

    setError(false);
    setLoading(true);

    const activeSrc = sources.find(s => s.index === previewSourceIndex) || sources[0];
    const streamFormat = activeSrc.streamType || channel.streamType;
    const streamUrl = `/api/player/stream/${channel.id}${streamFormat === 'ts' ? '.ts' : streamFormat === 'video' ? '.mp4' : '.m3u8'}?source=${previewSourceIndex}`;
    const isTs = streamFormat === 'ts' || streamUrl.endsWith('.ts');
    const isDirectVideo = streamFormat === 'video' || streamUrl.endsWith('.mp4') || streamUrl.endsWith('.mkv') || streamUrl.endsWith('.webm');

    if (isDirectVideo) {
      video.src = streamUrl;
      video.load();
      video.onloadeddata = () => { setLoading(false); video.play().catch(console.warn); };
      video.onerror = () => { setError(true); setLoading(false); };
    } else if (isTs && mpegts.isSupported()) {
      try {
        mpegPlayer = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: streamUrl
        }, {
          enableWorker: false,
          lazyLoad: false
        });
        mpegPlayer.attachMediaElement(video);
        mpegPlayer.load();
        mpegPlayer.play().then(() => setLoading(false)).catch(() => setLoading(false));
        mpegPlayer.on(mpegts.Events.ERROR, () => {
          setError(true);
          setLoading(false);
        });
      } catch (err) {
        console.error('mpegts preview error:', err);
        setError(true);
        setLoading(false);
      }
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.play().catch(console.warn);
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          setError(true);
          setLoading(false);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        video.play().catch(console.warn);
      });
      video.addEventListener('error', () => {
        setError(true);
        setLoading(false);
      });
    }

    return () => {
      if (mpegPlayer) {
        try {
          mpegPlayer.pause();
          mpegPlayer.unload();
          mpegPlayer.detachMediaElement();
          mpegPlayer.destroy();
        } catch {}
      }
      if (hls) hls.destroy();
    };
  }, [channel.id, channel.streamType, previewSourceIndex]);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`معاينة البث المباشر: ${channel.name}`}
      maxWidth="720px"
    >
      {/* Sources Switcher in Preview if multiple sources exist */}
      {sources.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            معاينة السيرفر:
          </span>
          {sources.map(s => {
            const isSelected = previewSourceIndex === s.index;
            return (
              <button
                key={s.index}
                type="button"
                className="btn"
                style={{
                  padding: '0.25rem 0.7rem',
                  fontSize: '0.8rem',
                  borderRadius: 'var(--radius-full)',
                  background: isSelected ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                  color: isSelected ? 'var(--accent-cyan-light)' : 'var(--text-muted)',
                  border: isSelected ? '1px solid var(--accent-cyan)' : '1px solid rgba(255, 255, 255, 0.1)'
                }}
                onClick={() => setPreviewSourceIndex(s.index)}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: '10px', overflow: 'hidden' }}>
        <video
          ref={videoRef}
          controls
          autoPlay
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />

        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', color: '#fff' }}>
            <div className="badge-pulse-dot" style={{ width: '16px', height: '16px', background: 'var(--accent-cyan)', marginBottom: '0.75rem' }} />
            <span style={{ fontSize: '0.9rem' }}>جاري فحص وتوصيل البث عبر خادم البروكسي الآمن...</span>
          </div>
        )}

        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,10,15,0.92)', color: '#fff', padding: '1.25rem', textAlign: 'center' }}>
            <AlertTriangle size={36} color="var(--accent-rose)" style={{ marginBottom: '0.75rem' }} />
            <strong style={{ marginBottom: '0.35rem', fontSize: '1.05rem' }}>تعذر تشغيل هذا الرابط من المصدر</strong>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '400px', lineHeight: 1.5 }}>
              رابط هذا البث متوقف أو منتهي الصلاحية من خادم المزود الخارجي (HTTP 404 أو رابط صفحة ويب). يمكنك تجربة القنوات النشطة الأخرى في القائمة.
            </p>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span>التصنيف: <strong style={{ color: '#fff' }}>{channel.category || 'عام'}</strong></span>
          <span>•</span>
          <span>الحالة للمشاهدين: <strong style={{ color: channel.is_active === 1 ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>{channel.is_active === 1 ? 'مفعلة' : 'معطلة'}</strong></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {onToggleActive && (
            <button
              type="button"
              className={`btn ${channel.is_active === 1 ? 'btn-secondary' : 'btn-primary'}`}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
              onClick={() => onToggleActive(channel.id)}
            >
              {channel.is_active === 1 ? 'تعطيل القناة' : 'تفعيل القناة للمشاهدين'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            إغلاق المعاينة
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default ChannelsTab;
