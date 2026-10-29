import React, { useState } from 'react';
import { Lock, User, Key, AlertCircle, CheckCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import Modal from '../common/Modal.jsx';

export function AdminAuthModal({ isOpen, onClose, onSuccess }) {
  const { requiresSetup, login, setupFirstAdmin } = useAuth();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (requiresSetup) {
        await setupFirstAdmin({ username, email, password, setupToken });
        setSuccessMsg('تم إنشاء حساب المدير بنجاح! جاري تسجيل الدخول...');
        // Auto login after setup
        await login(username, password);
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 800);
      } else {
        await login(username, password);
        onSuccess();
        onClose();
      }
    } catch (err) {
      setError(err.message || 'فشلت العملية، يرجى التحقق من البيانات');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={requiresSetup ? 'إعداد أول مدير للمنصة' : 'تسجيل دخول المدير'}
      maxWidth="460px"
    >
      <form onSubmit={handleSubmit}>
        {requiresSetup && (
          <div style={{
            background: 'rgba(6, 182, 212, 0.1)',
            border: '1px solid rgba(6, 182, 212, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '0.85rem',
            marginBottom: '1.25rem',
            fontSize: '0.88rem',
            lineHeight: 1.5,
            color: 'var(--text-main)'
          }}>
            <strong style={{ color: 'var(--accent-cyan-light)', display: 'block', marginBottom: '0.25rem' }}>
              👋 مرحباً بك في الإعداد الأولي!
            </strong>
            لا يوجد مدير مسجل حالياً. قم بإنشاء حساب المدير الأول ببيانات قوية للتحكم بالمنصة.
          </div>
        )}

        {error && (
          <div style={{
            background: 'rgba(244, 63, 94, 0.12)',
            border: '1px solid rgba(244, 63, 94, 0.3)',
            color: '#ff859b',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem',
            marginBottom: '1rem',
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <AlertCircle size={18} flexShrink={0} />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div style={{
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: 'var(--accent-emerald)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem',
            marginBottom: '1rem',
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <CheckCircle size={18} flexShrink={0} />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">اسم المستخدم</label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              required
              className="form-input"
              placeholder="مثال: admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{ paddingRight: '2.5rem' }}
            />
            <User size={18} color="var(--text-muted)" style={{ position: 'absolute', right: '0.9rem', top: '50%', transform: 'translateY(-50%)' }} />
          </div>
        </div>

        {requiresSetup && (
          <div className="form-group">
            <label className="form-label">البريد الإلكتروني (اختياري)</label>
            <input
              type="email"
              className="form-input"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        )}

        <div className="form-group">
          <label className="form-label">كلمة المرور</label>
          <div style={{ position: 'relative' }}>
            <input
              type="password"
              required
              minLength={8}
              className="form-input"
              placeholder="8 خانات على الأقل"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ paddingRight: '2.5rem' }}
            />
            <Lock size={18} color="var(--text-muted)" style={{ position: 'absolute', right: '0.9rem', top: '50%', transform: 'translateY(-50%)' }} />
          </div>
        </div>

        {requiresSetup && (
          <div className="form-group">
            <label className="form-label">رمز الإعداد الأولي (Setup Token)</label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="form-input"
                placeholder="من ملف .env (SETUP_TOKEN)"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                style={{ paddingRight: '2.5rem' }}
              />
              <Key size={18} color="var(--text-muted)" style={{ position: 'absolute', right: '0.9rem', top: '50%', transform: 'translateY(-50%)' }} />
            </div>
          </div>
        )}

        <button 
          type="submit" 
          disabled={loading}
          className="btn btn-primary" 
          style={{ width: '100%', marginTop: '0.5rem', padding: '0.85rem' }}
        >
          {loading ? 'جاري المعالجة...' : requiresSetup ? 'إنشاء حساب المدير والدخول' : 'تسجيل الدخول'}
        </button>

      </form>
    </Modal>
  );
}

export default AdminAuthModal;
