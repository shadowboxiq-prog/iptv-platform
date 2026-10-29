import React, { useState, useEffect } from 'react';
import { Shield, Key, Lock, CheckCircle, Save, Info, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../utils/api.js';

export function SettingsTab() {
  const [settings, setSettings] = useState({
    auto_activate_imported: 'false',
    app_title: 'منصة البث المباشر (IPTV)',
    reconnect_max_attempts: '3'
  });
  const [settingsMsg, setSettingsMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // Password Change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passMsg, setPassMsg] = useState('');
  const [passError, setPassError] = useState('');
  const [passLoading, setPassLoading] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await apiFetch('/api/admin/settings');
        if (res.settings) {
          setSettings(prev => ({ ...prev, ...res.settings }));
        }
      } catch (err) {
        console.warn('Failed to load settings:', err);
      }
    };
    fetchSettings();
  }, []);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setLoading(true);
    setSettingsMsg('');
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: { settings }
      });
      setSettingsMsg('تم حفظ الإعدادات بنجاح');
      setTimeout(() => setSettingsMsg(''), 3000);
    } catch (err) {
      setSettingsMsg(`خطأ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPassError('');
    setPassMsg('');

    if (newPassword !== confirmPassword) {
      setPassError('كلمة المرور الجديدة غير متطابقة مع التأكيد');
      return;
    }

    if (newPassword.length < 8) {
      setPassError('كلمة المرور الجديدة يجب أن تكون 8 خانات على الأقل');
      return;
    }

    setPassLoading(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword }
      });
      setPassMsg('تم تحديث كلمة المرور بنجاح!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPassMsg(''), 4000);
    } catch (err) {
      setPassError(err.message || 'فشل تحديث كلمة المرور');
    } finally {
      setPassLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>إعدادات المنصة والأمان</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          ضبط سياسات الاستيراد، وإدارة كلمة مرور المدير، والتحقق من آليات الأمان المدمجة
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
        {/* General Settings Card */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Shield size={18} color="var(--accent-cyan)" />
            إعدادات المنصة والاستيراد
          </h3>

          <form onSubmit={handleSaveSettings}>
            {settingsMsg && (
              <div style={{ background: settingsMsg.includes('خطأ') ? 'rgba(244,63,94,0.15)' : 'rgba(16,185,129,0.15)', color: settingsMsg.includes('خطأ') ? 'var(--accent-rose)' : 'var(--accent-emerald)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.88rem' }}>
                {settingsMsg}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">عنوان التطبيق / الموقع</label>
              <input
                type="text"
                className="form-input"
                value={settings.app_title || ''}
                onChange={(e) => setSettings({ ...settings, app_title: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">الحد الأقصى لمحاولات إعادة الاتصال التلقائية بالمشغل</label>
              <select
                className="form-select"
                value={settings.reconnect_max_attempts || '3'}
                onChange={(e) => setSettings({ ...settings, reconnect_max_attempts: e.target.value })}
              >
                <option value="2">2 محاولات</option>
                <option value="3">3 محاولات (مستحسن)</option>
                <option value="5">5 محاولات</option>
              </select>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', marginBottom: '1.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={settings.auto_activate_imported === 'true'}
                  onChange={(e) => setSettings({ ...settings, auto_activate_imported: e.target.checked ? 'true' : 'false' })}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--accent-cyan)' }}
                />
                <div>
                  <strong style={{ fontSize: '0.92rem', display: 'block' }}>تفعيل القنوات المستوردة تلقائياً</strong>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    عند إلغاء هذا الخيار (الوضع الافتراضي الآمن)، تبقى القنوات الجديدة معطلة حتى يقوم المدير بمراجعتها وتفعيلها يدوياً.
                  </span>
                </div>
              </label>
            </div>

            <button type="submit" disabled={loading} className="btn btn-primary">
              <Save size={16} />
              {loading ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
            </button>
          </form>
        </div>

        {/* Change Password Card */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Key size={18} color="var(--accent-cyan)" />
            تغيير كلمة مرور المدير
          </h3>

          <form onSubmit={handleChangePassword}>
            {passError && (
              <div style={{ background: 'rgba(244,63,94,0.15)', color: 'var(--accent-rose)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.88rem' }}>
                {passError}
              </div>
            )}
            {passMsg && (
              <div style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--accent-emerald)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.88rem' }}>
                {passMsg}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">كلمة المرور الحالية</label>
              <input
                type="password"
                required
                className="form-input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">كلمة المرور الجديدة (8 خانات على الأقل)</label>
              <input
                type="password"
                required
                minLength={8}
                className="form-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">تأكيد كلمة المرور الجديدة</label>
              <input
                type="password"
                required
                minLength={8}
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <button type="submit" disabled={passLoading} className="btn btn-primary">
              <Lock size={16} />
              {passLoading ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
            </button>
          </form>
        </div>
      </div>

      {/* Security & Legal Disclaimers Box */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1.5rem', border: '1px solid rgba(6,182,212,0.2)' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '0.75rem', color: 'var(--accent-cyan-light)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Info size={18} />
          معلومات الحماية والأمان والامتثال القانوني
        </h3>
        <ul style={{ paddingRight: '1.25rem', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
          <li>
            <strong>تشفير AES-256-GCM نشط:</strong> كافة كلمات مرور المزودين ورموز Stalker وXtream مشفرة بقفل متقدم بمفتاح سري مشتق من متغيرات البيئة.
          </li>
          <li>
            <strong>حماية SSRF نشطة:</strong> يتم حظر المضيف المحلي (Localhost) ونطاقات RFC1918 وعناوين السحابة (169.254.169.254) عند جلب القوائم أو فحص الروابط.
          </li>
          <li>
            <strong>عزل المشاهد:</strong> واجهة المشاهد تتصل فقط بوسيط البث الداخلي ولا تستلم أي تفاصيل دخول أو مفاتيح سرية خاصة بالمزودين.
          </li>
          <li>
            <strong>مسؤولية المحتوى:</strong> استخدام أي مصدر بث يتطلب اتفاقاً وترخيصاً رسمياً بين صاحب المنصة والمزود. لا يدعم التطبيق كسر الحماية أو تجاوز DRM أو القرصنة.
          </li>
        </ul>
      </div>
    </div>
  );
}

export default SettingsTab;
