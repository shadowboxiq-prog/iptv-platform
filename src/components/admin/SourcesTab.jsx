import React, { useState, useEffect } from 'react';
import { 
  Plus, Radio, RefreshCw, CheckCircle, AlertTriangle, Trash2, 
  Edit, Activity, Upload, Link as LinkIcon, FileText, Eye, Check
} from 'lucide-react';
import { apiFetch } from '../../utils/api.js';
import Modal from '../common/Modal.jsx';

export function SourcesTab() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState(null);
  const [testResult, setTestResult] = useState(null);

  // Add Source Modal state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newType, setNewType] = useState('m3u'); // 'm3u' | 'xtream' | 'stalker'
  const [newName, setNewName] = useState('');
  const [newEndpoint, setNewEndpoint] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newMac, setNewMac] = useState('');
  const [newToken, setNewToken] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');

  // Sync Diff Modal state
  const [syncSource, setSyncSource] = useState(null);
  const [diffData, setDiffData] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncExecuting, setSyncExecuting] = useState(false);
  const [syncAutoActivate, setSyncAutoActivate] = useState(false);
  const [syncHandleSuspended, setSyncHandleSuspended] = useState('keep');
  const [syncMessage, setSyncMessage] = useState('');

  // Edit Source Modal state
  const [editingSource, setEditingSource] = useState(null);
  const [editSourceData, setEditSourceData] = useState({
    name: '',
    endpoint: '',
    username: '',
    password: '',
    mac: '',
    token: '',
    isActive: true
  });
  const [editSourceLoading, setEditSourceLoading] = useState(false);
  const [editSourceMessage, setEditSourceMessage] = useState('');

  const fetchSources = async () => {
    try {
      const res = await apiFetch('/api/admin/sources');
      setSources(res.sources);
    } catch (err) {
      console.error('Failed to load sources:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  // Handle Test Connection
  const handleTestConnection = async (sourceId) => {
    setTestingId(sourceId);
    setTestResult(null);
    try {
      const res = await apiFetch(`/api/admin/sources/${sourceId}/test`, { method: 'POST' });
      setTestResult({ id: sourceId, ok: res.ok, message: res.ok ? 'الاتصال سليم وناجح' : (res.error || 'فشل الاتصال') });
      fetchSources();
    } catch (err) {
      setTestResult({ id: sourceId, ok: false, message: err.message });
    } finally {
      setTestingId(null);
    }
  };

  // Open Sync Diff Modal
  const handleOpenSync = async (source) => {
    setSyncSource(source);
    setDiffData(null);
    setSyncMessage('');
    setSyncLoading(true);

    try {
      const res = await apiFetch(`/api/admin/sources/${source.id}/import-preview`, { method: 'POST' });
      setDiffData(res.diff);
    } catch (err) {
      setSyncMessage(`تعذر جلب معاينة القنوات: ${err.message}`);
    } finally {
      setSyncLoading(false);
    }
  };

  // Execute Sync
  const handleExecuteSync = async () => {
    if (!syncSource) return;
    setSyncExecuting(true);
    setSyncMessage('');

    try {
      const res = await apiFetch(`/api/admin/sources/${syncSource.id}/sync`, {
        method: 'POST',
        body: {
          autoActivate: syncAutoActivate,
          handleSuspended: syncHandleSuspended
        }
      });
      setSyncMessage(res.message);
      fetchSources();
      setTimeout(() => {
        setSyncSource(null);
      }, 1500);
    } catch (err) {
      setSyncMessage(`فشلت المزامنة: ${err.message}`);
    } finally {
      setSyncExecuting(false);
    }
  };

  // Open Edit Source Modal
  const handleOpenEditSource = async (source) => {
    try {
      const res = await apiFetch(`/api/admin/sources/${source.id}`);
      setEditingSource(res.source);
      setEditSourceData({
        name: res.source.name || '',
        endpoint: res.source.endpoint || '',
        username: res.source.credentials?.username || '',
        password: '',
        mac: res.source.credentials?.macMasked ? '' : '',
        token: res.source.credentials?.tokenMasked ? '' : '',
        isActive: res.source.is_active === 1
      });
      setEditSourceMessage('');
    } catch (err) {
      alert(`تعذر جلب تفاصيل المصدر: ${err.message}`);
    }
  };

  // Save Edit Source Submit
  const handleSaveEditSource = async (e) => {
    e.preventDefault();
    if (!editingSource) return;
    setEditSourceLoading(true);
    setEditSourceMessage('');

    try {
      await apiFetch(`/api/admin/sources/${editingSource.id}`, {
        method: 'PUT',
        body: editSourceData
      });
      setEditSourceMessage('تم تحديث بيانات المصدر بنجاح');
      fetchSources();
      setTimeout(() => {
        setEditingSource(null);
      }, 1000);
    } catch (err) {
      setEditSourceMessage(`خطأ في التحديث: ${err.message}`);
    } finally {
      setEditSourceLoading(false);
    }
  };

  // Handle Add Source Submit
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setAddError('');
    setAddLoading(true);

    try {
      const formData = new FormData();
      formData.append('name', newName);
      formData.append('type', newType);
      if (newEndpoint) formData.append('endpoint', newEndpoint);
      if (newUsername) formData.append('username', newUsername);
      if (newPassword) formData.append('password', newPassword);
      if (newMac) formData.append('mac', newMac);
      if (newToken) formData.append('token', newToken);
      if (selectedFile) formData.append('file', selectedFile);

      await apiFetch('/api/admin/sources', {
        method: 'POST',
        body: formData
      });

      setIsAddOpen(false);
      resetAddForm();
      fetchSources();
    } catch (err) {
      setAddError(err.message || 'فشل إضافة المصدر');
    } finally {
      setAddLoading(false);
    }
  };

  const resetAddForm = () => {
    setNewName('');
    setNewEndpoint('');
    setNewUsername('');
    setNewPassword('');
    setNewMac('');
    setNewToken('');
    setSelectedFile(null);
    setAddError('');
  };

  // Handle Delete Source
  const handleDeleteSource = async (sourceId, sourceName) => {
    const confirmDelete = window.confirm(`هل أنت متأكد من حذف مصدر البث "${sourceName}"؟`);
    if (!confirmDelete) return;

    const deleteChannels = window.confirm('هل تريد أيضاً حذف جميع القنوات المستوردة من هذا المصدر؟ (إلغاء الأمر سيبقي القنوات في المكتبة بشكل مستقل)');

    try {
      await apiFetch(`/api/admin/sources/${sourceId}?deleteChannels=${deleteChannels}`, {
        method: 'DELETE'
      });
      fetchSources();
    } catch (err) {
      alert(`خطأ أثناء الحذف: ${err.message}`);
    }
  };

  return (
    <div>
      {/* Header with Add Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>إدارة مصادر البث</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            إضافة وإدارة مزودي Stalker Portal وXtream Codes وقوائم M3U/M3U8 المشفرة
          </p>
        </div>
        <button 
          type="button" 
          className="btn btn-primary"
          onClick={() => setIsAddOpen(true)}
        >
          <Plus size={18} />
          إضافة مصدر بث جديد
        </button>
      </div>

      {/* Sources Table */}
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>المصدر</th>
              <th>النوع</th>
              <th>حالة الاتصال</th>
              <th>القنوات المستوردة</th>
              <th>آخر فحص / مزامنة</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong style={{ display: 'block', fontSize: '0.98rem' }}>{s.name}</strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>
                    {s.endpoint ? s.endpoint.substring(0, 45) + (s.endpoint.length > 45 ? '...' : '') : 'قائمة محلية مرفوعة'}
                  </span>
                </td>
                <td>
                  <span className={`badge ${s.type === 'xtream' ? 'badge-cyan' : s.type === 'stalker' ? 'badge-warning' : 'badge-success'}`}>
                    {s.type === 'xtream' ? 'Xtream Codes' : s.type === 'stalker' ? 'Stalker Portal' : 'M3U Playlist'}
                  </span>
                </td>
                <td>
                  {s.last_checked_status === 'ok' ? (
                    <span className="badge badge-success">
                      <CheckCircle size={14} />
                      متصل وسليم
                    </span>
                  ) : s.last_checked_status === 'error' ? (
                    <span className="badge" style={{ background: 'rgba(244,63,94,0.15)', color: 'var(--accent-rose)' }} title={s.last_checked_message}>
                      <AlertTriangle size={14} />
                      تنبيه / خطأ
                    </span>
                  ) : (
                    <span className="badge" style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-faint)' }}>
                      قيد الانتظار
                    </span>
                  )}
                </td>
                <td>
                  <strong>{s.channel_count}</strong> قناة
                  <span style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)', display: 'block' }}>
                    ({s.active_channel_count} مفعلة)
                  </span>
                </td>
                <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  <div>فحص: {s.last_checked_at ? new Date(s.last_checked_at).toLocaleDateString('ar-EG') : 'لم يفحص'}</div>
                  <div>مزامنة: {s.last_sync_at ? new Date(s.last_sync_at).toLocaleDateString('ar-EG') : 'لم تتم'}</div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => handleTestConnection(s.id)}
                      disabled={testingId === s.id}
                      title="فحص الاتصال"
                    >
                      <Activity size={16} color={testingId === s.id ? 'var(--accent-cyan)' : 'var(--text-main)'} className={testingId === s.id ? 'animate-spin' : ''} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => handleOpenSync(s)}
                      title="استيراد ومزامنة القنوات مع فحص الفروقات"
                      style={{ color: 'var(--accent-cyan)' }}
                    >
                      <RefreshCw size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => handleOpenEditSource(s)}
                      title="تعديل بيانات المصدر"
                      style={{ color: 'var(--accent-amber)' }}
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => handleDeleteSource(s.id, s.name)}
                      title="حذف المصدر"
                      style={{ color: 'var(--accent-rose)' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  {testResult && testResult.id === s.id && (
                    <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: testResult.ok ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                      {testResult.message}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                  لا توجد مصادر بث مسجلة بعد. انقر على «إضافة مصدر بث جديد» للبدء.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Source Modal */}
      <Modal
        isOpen={isAddOpen}
        onClose={() => { setIsAddOpen(false); resetAddForm(); }}
        title="إضافة مصدر بث جديد"
        maxWidth="640px"
      >
        <form onSubmit={handleAddSubmit}>
          {addError && (
            <div style={{ background: 'rgba(244, 63, 94, 0.15)', color: 'var(--accent-rose)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.88rem' }}>
              {addError}
            </div>
          )}

          {/* Type Selector Tabs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '1.25rem' }}>
            <button
              type="button"
              className={`btn ${newType === 'm3u' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setNewType('m3u')}
              style={{ fontSize: '0.88rem' }}
            >
              M3U / M3U8
            </button>
            <button
              type="button"
              className={`btn ${newType === 'xtream' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setNewType('xtream')}
              style={{ fontSize: '0.88rem' }}
            >
              Xtream Codes
            </button>
            <button
              type="button"
              className={`btn ${newType === 'stalker' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setNewType('stalker')}
              style={{ fontSize: '0.88rem' }}
            >
              Stalker Portal
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">الاسم التعريفي للمصدر</label>
            <input
              type="text"
              required
              className="form-input"
              placeholder="مثال: باقة الأخبار والرياضة"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>

          {/* M3U Specific Inputs */}
          {newType === 'm3u' && (
            <>
              <div className="form-group">
                <label className="form-label">رابط قائمة M3U / M3U8 (عبر الإنترنت)</label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://example.com/playlist.m3u"
                  value={newEndpoint}
                  onChange={(e) => setNewEndpoint(e.target.value)}
                />
                <small style={{ color: 'var(--text-faint)', fontSize: '0.78rem', marginTop: '0.25rem', display: 'block' }}>
                  يتم تطبيق فحص SSRF لحظر العناوين المحلية والمخفية تلقائياً.
                </small>
              </div>

              <div style={{ textAlign: 'center', margin: '0.75rem 0', color: 'var(--text-faint)', fontSize: '0.85rem' }}>
                — أو رفع ملف محلي —
              </div>

              <div className="form-group">
                <label className="form-label">رفع ملف M3U / M3U8 محلي</label>
                <input
                  type="file"
                  accept=".m3u,.m3u8,.txt"
                  className="form-input"
                  onChange={(e) => setSelectedFile(e.target.files[0] || null)}
                />
                <small style={{ color: 'var(--text-faint)', fontSize: '0.78rem', marginTop: '0.25rem', display: 'block' }}>
                  يتم استخراج بيانات القنوات وتنظيفها وحذف الملف فوراً من الذاكرة دون تخزين محتواه الخام.
                </small>
              </div>
            </>
          )}

          {/* Xtream Codes Inputs */}
          {newType === 'xtream' && (
            <>
              <div className="form-group">
                <label className="form-label">عنوان الخادم (Server URL مع المنفذ)</label>
                <input
                  type="text"
                  required
                  className="form-input"
                  placeholder="http://iptv-server.com:8080"
                  value={newEndpoint}
                  onChange={(e) => setNewEndpoint(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">اسم المستخدم</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">كلمة المرور</label>
                  <input
                    type="password"
                    required
                    className="form-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ background: 'rgba(6, 182, 212, 0.08)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                🔒 يتم تشفير بيانات الاعتماد فوراً باستخدام AES-256-GCM ولا يتم إرسالها إلى واجهة المشاهد إطلاقاً.
              </div>
            </>
          )}

          {/* Stalker Portal Inputs */}
          {newType === 'stalker' && (
            <>
              <div className="form-group">
                <label className="form-label">عنوان Portal أو URL الأساسي</label>
                <input
                  type="text"
                  required
                  className="form-input"
                  placeholder="http://portal.example.com/c/"
                  value={newEndpoint}
                  onChange={(e) => setNewEndpoint(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">عنوان MAC المصرح به (اختياري)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="00:1A:79:XX:XX:XX"
                    value={newMac}
                    onChange={(e) => setNewMac(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">رمز الترخيص الرسمي / Token (اختياري)</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Authorized API Token"
                    value={newToken}
                    onChange={(e) => setNewToken(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.82rem', color: 'var(--accent-amber)' }}>
                ⚠️ <strong>تنبيه قانوني وتقني:</strong> يتعامل التطبيق مع بوابة Stalker فقط عبر واجهة API رسمية ومصرح بها من المزود، ولا ينفذ محاولات تجاوز الحماية أو تقليد الأجهزة غير المصرح بها.
              </div>
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setIsAddOpen(false); resetAddForm(); }}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={addLoading}
              className="btn btn-primary"
            >
              {addLoading ? 'جاري الحفظ والاستيراد...' : 'حفظ المصدر'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Sync Diff & Review Modal */}
      <Modal
        isOpen={!!syncSource}
        onClose={() => setSyncSource(null)}
        title={`استيراد ومزامنة القنوات: ${syncSource?.name}`}
        maxWidth="680px"
      >
        {syncLoading && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <RefreshCw className="animate-spin" size={32} color="var(--accent-cyan)" style={{ margin: '0 auto 1rem' }} />
            <p>جاري فحص المصدر وحساب الفروقات...</p>
          </div>
        )}

        {!syncLoading && diffData && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.25rem' }}>
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--accent-emerald)' }}>قنوات جديدة</span>
                <strong style={{ fontSize: '1.6rem', display: 'block', color: 'var(--accent-emerald)' }}>{diffData.counts.new}</strong>
              </div>
              <div style={{ background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.3)', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)' }}>قنوات محدثة</span>
                <strong style={{ fontSize: '1.6rem', display: 'block', color: 'var(--accent-cyan)' }}>{diffData.counts.updated}</strong>
              </div>
              <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--accent-amber)' }}>قنوات غير موجودة بالقائمة</span>
                <strong style={{ fontSize: '1.6rem', display: 'block', color: 'var(--accent-amber)' }}>{diffData.counts.suspended}</strong>
              </div>
            </div>

            {/* Sync Options */}
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', marginBottom: '1.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={syncAutoActivate}
                  onChange={(e) => setSyncAutoActivate(e.target.checked)}
                />
                <span style={{ fontSize: '0.9rem' }}>تفعيل القنوات الجديدة فوراً للمشاهدين دون مراجعة مسبقة</span>
              </label>

              <div>
                <label className="form-label" style={{ fontSize: '0.85rem' }}>التعامل مع القنوات المفقودة مؤقتاً من المصدر:</label>
                <select
                  className="form-select"
                  value={syncHandleSuspended}
                  onChange={(e) => setSyncHandleSuspended(e.target.value)}
                  style={{ fontSize: '0.88rem', padding: '0.5rem' }}
                >
                  <option value="keep">الإبقاء عليها نشطة كما هي (حماية ضد انقطاع المزود المؤقت)</option>
                  <option value="deactivate">تعطيلها مؤقتاً حتى تعود للظهور في المصدر</option>
                </select>
              </div>
            </div>

            {syncMessage && (
              <div style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--accent-emerald)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.88rem' }}>
                {syncMessage}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSyncSource(null)}
              >
                إغلاق
              </button>
              <button
                type="button"
                disabled={syncExecuting}
                className="btn btn-primary"
                onClick={handleExecuteSync}
              >
                {syncExecuting ? 'جاري اعتماد المزامنة...' : 'اعتماد وتطبيق المزامنة'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Source Modal */}
      <Modal
        isOpen={!!editingSource}
        onClose={() => setEditingSource(null)}
        title={`تعديل مصدر البث: ${editingSource?.name}`}
        maxWidth="620px"
      >
        <form onSubmit={handleSaveEditSource}>
          {editSourceMessage && (
            <div style={{
              background: editSourceMessage.includes('خطأ') ? 'rgba(244, 63, 94, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              color: editSourceMessage.includes('خطأ') ? 'var(--accent-rose)' : 'var(--accent-emerald)',
              padding: '0.75rem',
              borderRadius: '8px',
              marginBottom: '1rem',
              fontSize: '0.88rem'
            }}>
              {editSourceMessage}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">الاسم التعريفي للمصدر</label>
            <input
              type="text"
              required
              className="form-input"
              value={editSourceData.name}
              onChange={(e) => setEditSourceData({ ...editSourceData, name: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">عنوان الرابط أو الخادم (Endpoint)</label>
            <input
              type="text"
              className="form-input"
              value={editSourceData.endpoint}
              onChange={(e) => setEditSourceData({ ...editSourceData, endpoint: e.target.value })}
            />
          </div>

          {editingSource?.type === 'xtream' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">اسم المستخدم</label>
                <input
                  type="text"
                  className="form-input"
                  value={editSourceData.username}
                  onChange={(e) => setEditSourceData({ ...editSourceData, username: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">كلمة المرور الجديدة (اتركها فارغة للإبقاء على الحالية)</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="form-input"
                  value={editSourceData.password}
                  onChange={(e) => setEditSourceData({ ...editSourceData, password: e.target.value })}
                />
              </div>
            </div>
          )}

          {editingSource?.type === 'stalker' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">عنوان MAC</label>
                <input
                  type="text"
                  placeholder="00:1A:79:XX:XX:XX"
                  className="form-input"
                  value={editSourceData.mac}
                  onChange={(e) => setEditSourceData({ ...editSourceData, mac: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">رمز Token الجديد (اختياري)</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="form-input"
                  value={editSourceData.token}
                  onChange={(e) => setEditSourceData({ ...editSourceData, token: e.target.value })}
                />
              </div>
            </div>
          )}

          <div style={{ margin: '1rem 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={editSourceData.isActive}
                onChange={(e) => setEditSourceData({ ...editSourceData, isActive: e.target.checked })}
              />
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>المصدر قيد التفعيل</span>
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEditingSource(null)}
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={editSourceLoading}
              className="btn btn-primary"
            >
              {editSourceLoading ? 'جاري الحفظ...' : 'حفظ التعديلات'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default SourcesTab;
