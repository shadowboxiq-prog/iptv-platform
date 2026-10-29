import React from 'react';
import { Star, Tv, Film } from 'lucide-react';

export function ChannelCard({ channel, isSelected, isFavorite, onSelect, onToggleFavorite }) {
  const isVOD = channel.streamType === 'video' ||
    (channel.category && (channel.category.includes('افلام') || channel.category.includes('مسلسلات') || channel.category.includes('Movies') || channel.category.includes('Series')));

  return (
    <div 
      className={`channel-card ${isSelected ? 'active' : ''}`}
      onClick={() => onSelect(channel)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(channel); }}
    >
      <div className="channel-logo-wrap" style={{ background: isVOD ? 'rgba(236,72,153,0.1)' : undefined }}>
        {channel.logoUrl ? (
          <img 
            src={channel.logoUrl} 
            alt={channel.name} 
            className="channel-logo"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : isVOD ? (
          <Film size={26} color="#f472b6" />
        ) : (
          <Tv size={26} color="var(--accent-cyan)" />
        )}
      </div>

      <div className="channel-info">
        <h4 className="channel-title" title={channel.name}>
          {channel.name}
        </h4>
        <div className="channel-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span className="badge badge-cyan" style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem' }}>
            {channel.category || 'عام'}
          </span>
          {channel.streamSources && channel.streamSources.length > 1 && (
            <span 
              className="badge" 
              style={{ 
                fontSize: '0.68rem', 
                padding: '0.1rem 0.4rem', 
                background: 'rgba(56, 189, 248, 0.15)', 
                color: 'var(--accent-cyan-light)', 
                border: '1px solid rgba(56, 189, 248, 0.3)' 
              }}
              title={`${channel.streamSources.length} مصادر بث متاحة`}
            >
              {channel.streamSources.length} سيرفرات
            </span>
          )}
          {isVOD && (
            <span className="badge" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: 'rgba(236,72,153,0.15)', color: '#f472b6', border: '1px solid rgba(244,114,182,0.3)' }}>
              VOD
            </span>
          )}
          {isSelected && (
            <span style={{ fontSize: '0.75rem', color: isVOD ? '#f472b6' : 'var(--accent-cyan-light)', fontWeight: 600 }}>
              قيد التشغيل
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        className="btn-icon"
        style={{
          border: 'none',
          background: 'transparent',
          color: isFavorite ? 'var(--accent-amber)' : 'var(--text-faint)',
          padding: '0.4rem'
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(channel.id);
        }}
        title={isFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
        aria-label={isFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
      >
        <Star size={20} fill={isFavorite ? 'var(--accent-amber)' : 'none'} />
      </button>
    </div>
  );
}

export default ChannelCard;
