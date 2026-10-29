import React, { useState, useEffect } from 'react';
import { 
  X, Search, Download, Check, Globe, Sparkles, AlertCircle, FileText, Star, ArrowDownToLine 
} from 'lucide-react';

export function SubtitleSearchModal({
  isOpen,
  onClose,
  initialQuery = '',
  onApplySubtitle
}) {
  const [query, setQuery] = useState(initialQuery);
  const [language, setLanguage] = useState('ar');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState('');
  const [appliedId, setAppliedId] = useState(null);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      handleSearch(initialQuery, language);
    }
  }, [initialQuery, isOpen]);

  const handleSearch = async (searchQuery = query, searchLang = language) => {
    if (!searchQuery || !searchQuery.trim()) return;

    setIsLoading(true);
    setError('');
    setHasSearched(true);

    try {
      const res = await fetch(`/api/player/subtitles/search?query=${encodeURIComponent(searchQuery.trim())}&lang=${searchLang}`);
      const data = await res.json();

      if (data.ok) {
        setResults(data.results || []);
      } else {
        setError(data.error || 'تعذر جلب الترجمات أونلاين');
      }
    } catch (err) {
      setError('حدث خطأ أثناء الاتصال بسيرفر البحث عن الترجمة');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = (sub) => {
    setAppliedId(sub.id);

    // If it's a demo or has direct downloadUrl
    const vttUrl = sub.downloadUrl || `/api/player/subtitles/download?id=${encodeURIComponent(sub.id)}&query=${encodeURIComponent(query || initialQuery || '')}`;
    
    if (onApplySubtitle) {
      onApplySubtitle({
        id: sub.id,
        label: `${sub.title.slice(0, 35)}... (${sub.language})`,
        language: sub.language,
        langCode: sub.langCode || 'ar',
        vttUrl: vttUrl,
        isOnline: true
      });
    }

    setTimeout(() => {
      onClose();
    }, 400);
  };

  if (!isOpen) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        direction: 'rtl'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '85vh',
          backgroundColor: 'var(--bg-card, #0f172a)',
          border: '1px solid var(--border-glow, rgba(6, 182, 212, 0.3))',
          borderRadius: '16px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.9), 0 0 25px rgba(6, 182, 212, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'modalSlideUp 0.2s ease-out'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.02)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(16, 185, 129, 0.2))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid rgba(6, 182, 212, 0.4)'
            }}>
              <Globe size={20} color="var(--accent-cyan, #06b6d4)" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>
                البحث عن ترجمة أونلاين
              </h3>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted, #94a3b8)' }}>
                مصادر معتمدة: SubSource • OpenSubtitles • SubDL
              </p>
            </div>
          </div>

          <button 
            type="button"
            onClick={onClose}
            className="btn-icon"
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: 'var(--text-muted, #94a3b8)',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Search Controls */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch();
            }}
            style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}
          >
            <div style={{ flex: 1, position: 'relative' }}>
              <Search 
                size={18} 
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted, #94a3b8)'
                }}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="اسم الفيلم أو المسلسل والحلقة (مثال: Game of Thrones S01E01)..."
                style={{
                  width: '100%',
                  padding: '0.75rem 2.5rem 0.75rem 1rem',
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '10px',
                  color: '#fff',
                  fontSize: '0.88rem',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent-cyan, #06b6d4)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)'}
              />
            </div>

            <select
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                handleSearch(query, e.target.value);
              }}
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '10px',
                color: '#fff',
                fontSize: '0.85rem',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="ar">العربية (Arabic)</option>
              <option value="en">الإنجليزية (English)</option>
              <option value="fr">الفرنسية (French)</option>
              <option value="all">جميع اللغات (All)</option>
            </select>

            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              style={{
                padding: '0.75rem 1.4rem',
                background: 'linear-gradient(135deg, var(--accent-cyan, #06b6d4), #0891b2)',
                border: 'none',
                borderRadius: '10px',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: isLoading || !query.trim() ? 'not-allowed' : 'pointer',
                opacity: isLoading || !query.trim() ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              {isLoading ? 'جاري البحث...' : 'بحث'}
            </button>
          </form>
        </div>

        {/* Results List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.25rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem'
        }}>
          {isLoading && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted, #94a3b8)' }}>
              <div style={{
                width: '36px',
                height: '36px',
                border: '3px solid rgba(6, 182, 212, 0.2)',
                borderTopColor: 'var(--accent-cyan, #06b6d4)',
                borderRadius: '50%',
                margin: '0 auto 1rem',
                animation: 'spin 1s linear infinite'
              }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>جاري استخراج ملفات الترجمة المتطابقة من السيرفرات...</p>
            </div>
          )}

          {!isLoading && error && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              padding: '1rem',
              borderRadius: '10px',
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: '0.85rem'
            }}>
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {!isLoading && hasSearched && results.length === 0 && !error && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted, #94a3b8)' }}>
              <FileText size={40} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
              <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>لم يتم العثور على ترجمة مطابقة</p>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
                جرّب البحث باسم الفيلم بالإنجليزية أو إزالة الكلمات الزائدة.
              </p>
            </div>
          )}

          {!isLoading && results.map((sub) => {
            const isApplied = appliedId === sub.id;
            return (
              <div
                key={sub.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '1rem',
                  borderRadius: '12px',
                  backgroundColor: isApplied ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                  border: isApplied 
                    ? '1px solid rgba(52, 211, 153, 0.5)' 
                    : '1px solid rgba(255, 255, 255, 0.07)',
                  transition: 'all 0.2s',
                  gap: '1rem'
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '0.15rem 0.5rem',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(6, 182, 212, 0.18)',
                      color: 'var(--accent-cyan-light, #67e8f9)',
                      border: '1px solid rgba(6, 182, 212, 0.3)'
                    }}>
                      {sub.source}
                    </span>

                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '0.15rem 0.5rem',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      color: '#34d399',
                      border: '1px solid rgba(16, 185, 129, 0.3)'
                    }}>
                      {sub.language}
                    </span>

                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted, #94a3b8)' }}>
                      صيغة {sub.format || 'SRT'}
                    </span>
                  </div>

                  <h4 style={{
                    margin: 0,
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    color: '#fff',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {sub.title}
                  </h4>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.4rem', fontSize: '0.74rem', color: 'var(--text-muted, #94a3b8)' }}>
                    {sub.downloads > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <ArrowDownToLine size={13} />
                        {sub.downloads.toLocaleString()} تحميل
                      </span>
                    )}
                    {sub.rating > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#fbbf24' }}>
                        <Star size={13} fill="#fbbf24" />
                        {sub.rating}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleApply(sub)}
                  style={{
                    padding: '0.6rem 1.1rem',
                    borderRadius: '8px',
                    background: isApplied 
                      ? '#10b981' 
                      : 'rgba(6, 182, 212, 0.15)',
                    border: isApplied 
                      ? 'none' 
                      : '1px solid rgba(6, 182, 212, 0.4)',
                    color: isApplied ? '#fff' : 'var(--accent-cyan-light, #67e8f9)',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    flexShrink: 0,
                    transition: 'all 0.15s'
                  }}
                >
                  {isApplied ? (
                    <>
                      <Check size={16} />
                      <span>تم التطبيق</span>
                    </>
                  ) : (
                    <>
                      <Download size={15} />
                      <span>تطبيق الترجمة</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.85rem 1.5rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.76rem',
          color: 'var(--text-muted, #94a3b8)',
          background: 'rgba(0, 0, 0, 0.2)'
        }}>
          <span>يمكنك ضبط توقيت وتزامن الترجمة مباشرة من شريط أدوات المشغل.</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted, #94a3b8)',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}

export default SubtitleSearchModal;
