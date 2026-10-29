import React, { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import { apiFetch } from './utils/api.js';
import { storage } from './utils/storage.js';

import ViewerHeader from './components/viewer/ViewerHeader.jsx';
import VideoPlayer from './components/viewer/VideoPlayer.jsx';
import CategoryBar from './components/viewer/CategoryBar.jsx';
import ChannelCard from './components/viewer/ChannelCard.jsx';
import AdminAuthModal from './components/admin/AdminAuthModal.jsx';
import AdminLayout from './components/admin/AdminLayout.jsx';

import { Tv, Sparkles, AlertCircle, Heart, Film } from 'lucide-react';

export function App() {
  const { isAuthenticated, requiresSetup } = useAuth();

  // Mode: 'viewer' | 'admin'
  const [currentView, setCurrentView] = useState('viewer');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Channels & Categories
  const [channels, setChannels] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cinemaMode, setCinemaMode] = useState(false);

  // Media Section: 'all' | 'live' | 'vod'
  const [mediaSection, setMediaSection] = useState('all');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState(() => storage.getFavorites());

  // Public Settings
  const [appSettings, setAppSettings] = useState({
    appTitle: 'منصة البث المباشر',
    reconnectMaxAttempts: 3
  });

  const isChannelVOD = (ch) => {
    return ch?.streamType === 'video' ||
      (ch?.category && (ch.category.includes('افلام') || ch.category.includes('مسلسلات') || ch.category.includes('Movies') || ch.category.includes('Series')));
  };

  const vodChannelsCount = channels.filter(isChannelVOD).length;
  const liveChannelsCount = channels.filter(ch => !isChannelVOD(ch)).length;

  // Fetch channels for viewers
  const loadViewerData = async () => {
    setLoading(true);
    try {
      const [channelsRes, categoriesRes, settingsRes] = await Promise.all([
        apiFetch('/api/player/channels'),
        apiFetch('/api/player/categories'),
        apiFetch('/api/player/settings').catch(() => ({ ok: false }))
      ]);

      const loadedChannels = channelsRes.channels || [];
      setChannels(loadedChannels);
      setCategories(categoriesRes.categories || []);

      if (settingsRes?.ok && settingsRes.settings) {
        setAppSettings(prev => ({ ...prev, ...settingsRes.settings }));
        if (settingsRes.settings.appTitle) {
          document.title = settingsRes.settings.appTitle;
        }
      }

      // Restore last watched channel if available, or pick the first
      const lastId = storage.getLastChannelId();
      const lastChannel = loadedChannels.find(c => c.id === lastId);

      if (lastChannel) {
        setSelectedChannel(lastChannel);
      } else if (!selectedChannel && loadedChannels.length > 0) {
        setSelectedChannel(loadedChannels[0]);
      }
    } catch (err) {
      console.error('Failed to load viewer channels:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadViewerData();
  }, []);

  // Filter channels based on section (live/vod), search, category, and favorites
  const filteredChannels = channels.filter(ch => {
    const isVod = isChannelVOD(ch);
    if (mediaSection === 'live' && isVod) return false;
    if (mediaSection === 'vod' && !isVod) return false;

    const matchesSearch = !searchQuery.trim() || 
      ch.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (ch.category && ch.category.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = activeCategory === 'all' || activeCategory === 'الكل' || ch.category === activeCategory;
    const matchesFavorites = !showFavoritesOnly || favorites.includes(ch.id);

    return matchesSearch && matchesCategory && matchesFavorites;
  });

  // Handle switching section
  const handleSectionChange = (section) => {
    setMediaSection(section);
    setActiveCategory('all');
    // If current channel doesn't match new section, select the first match
    const matchingChannels = channels.filter(ch => {
      const isVod = isChannelVOD(ch);
      if (section === 'live') return !isVod;
      if (section === 'vod') return isVod;
      return true;
    });
    if (matchingChannels.length > 0 && (!selectedChannel || !matchingChannels.some(c => c.id === selectedChannel.id))) {
      handleSelectChannel(matchingChannels[0]);
    }
  };

  // Channel selection with persistence
  const handleSelectChannel = (ch) => {
    setSelectedChannel(ch);
    if (ch?.id) {
      storage.setLastChannelId(ch.id);
    }
  };

  // Channel switching indices
  const currentIndex = filteredChannels.findIndex(ch => ch.id === selectedChannel?.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex !== -1 && currentIndex < filteredChannels.length - 1;

  const handleNextChannel = () => {
    if (hasNext) {
      handleSelectChannel(filteredChannels[currentIndex + 1]);
    }
  };

  const handlePrevChannel = () => {
    if (hasPrev) {
      handleSelectChannel(filteredChannels[currentIndex - 1]);
    }
  };

  // Toggle favorite
  const handleToggleFavorite = (chId) => {
    const updated = storage.toggleFavorite(chId);
    setFavorites([...updated]);
  };

  // Filter categories by selected media section
  const filteredCategories = categories.filter(cat => {
    if (cat.category === 'الكل' || cat.category === 'all') return true;
    if (mediaSection === 'all') return true;
    const catChannels = channels.filter(ch => ch.category === cat.category);
    if (mediaSection === 'vod') return catChannels.some(isChannelVOD);
    if (mediaSection === 'live') return catChannels.some(ch => !isChannelVOD(ch));
    return true;
  });

  const getSectionTitle = () => {
    if (showFavoritesOnly) return 'قنواتك المفضلة ⭐';
    if (activeCategory !== 'all' && activeCategory !== 'الكل') return `تصنيف: ${activeCategory}`;
    if (mediaSection === 'vod') return 'مكتبة المسلسلات والأفلام (VOD) 🍿';
    if (mediaSection === 'live') return 'قنوات البث المباشر 📡';
    return 'جميع القنوات والمحتوى المتاح';
  };

  // If currently in Admin view and user is authenticated
  if (currentView === 'admin' && isAuthenticated) {
    return <AdminLayout onExitToViewer={() => setCurrentView('viewer')} />;
  }

  return (
    <div className="app-container">
      {/* Header */}
      <ViewerHeader
        appTitle={appSettings.appTitle}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenAdminModal={() => setIsAuthModalOpen(true)}
        onNavigateToAdmin={() => setCurrentView('admin')}
        totalChannels={channels.length}
        onRefresh={loadViewerData}
      />

      <main className="main-content">
        {/* Prominent Video Player */}
        <section style={{ marginBottom: '1.75rem' }}>
          <VideoPlayer
            channel={selectedChannel}
            channels={filteredChannels}
            onSelectChannel={handleSelectChannel}
            onNextChannel={handleNextChannel}
            onPrevChannel={handlePrevChannel}
            hasPrev={hasPrev}
            hasNext={hasNext}
            cinemaMode={cinemaMode}
            onToggleCinema={() => setCinemaMode(!cinemaMode)}
            maxReconnectAttempts={appSettings.reconnectMaxAttempts}
          />
        </section>

        {/* Feature Sections Switcher (Live TV vs VOD Series & Movies) */}
        <section style={{ marginBottom: '1rem' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(12px)',
            padding: '0.35rem',
            borderRadius: '12px',
            border: '1px solid var(--border-subtle)',
            width: 'fit-content',
            flexWrap: 'wrap'
          }}>
            <button
              type="button"
              onClick={() => handleSectionChange('all')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.45rem 1rem',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.88rem',
                transition: 'all 0.2s',
                background: mediaSection === 'all' ? 'var(--accent-cyan)' : 'transparent',
                color: mediaSection === 'all' ? '#040d1a' : 'var(--text-muted)'
              }}
            >
              <span>الكل ({channels.length})</span>
            </button>

            <button
              type="button"
              onClick={() => handleSectionChange('live')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.45rem 1rem',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.88rem',
                transition: 'all 0.2s',
                background: mediaSection === 'live' ? 'rgba(6,182,212,0.2)' : 'transparent',
                color: mediaSection === 'live' ? 'var(--accent-cyan-light)' : 'var(--text-muted)',
                outline: mediaSection === 'live' ? '1px solid var(--border-glow)' : 'none'
              }}
            >
              <Tv size={16} />
              <span>البث المباشر ({liveChannelsCount})</span>
            </button>

            <button
              type="button"
              onClick={() => handleSectionChange('vod')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.45rem 1rem',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.88rem',
                transition: 'all 0.2s',
                background: mediaSection === 'vod' ? 'linear-gradient(135deg, rgba(236,72,153,0.3), rgba(168,85,247,0.3))' : 'transparent',
                color: mediaSection === 'vod' ? '#f472b6' : 'var(--text-muted)',
                outline: mediaSection === 'vod' ? '1px solid rgba(244,114,182,0.5)' : 'none'
              }}
            >
              <Film size={16} />
              <span>مسلسلات وأفلام VOD ({vodChannelsCount})</span>
              <span style={{ fontSize: '0.65rem', padding: '0.05rem 0.4rem', borderRadius: '10px', background: 'rgba(236,72,153,0.3)', color: '#f472b6', fontWeight: 800 }}>
                جديد
              </span>
            </button>
          </div>
        </section>

        {/* Categories Bar */}
        <section style={{ marginBottom: '1.25rem' }}>
          <CategoryBar
            categories={filteredCategories}
            activeCategory={activeCategory}
            onSelectCategory={setActiveCategory}
            showFavoritesOnly={showFavoritesOnly}
            onToggleFavoritesOnly={setShowFavoritesOnly}
            favoritesCount={favorites.length}
          />
        </section>

        {/* Channels Grid Section */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>
              {getSectionTitle()}
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginRight: '0.5rem', fontWeight: 500 }}>
                ({filteredChannels.length} {mediaSection === 'vod' ? 'فيديو' : 'قناة'})
              </span>
            </h3>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              <div className="badge-pulse-dot" style={{ width: '16px', height: '16px', background: 'var(--accent-cyan)', margin: '0 auto 1rem' }} />
              <p>جاري تحميل القنوات المتاحة...</p>
            </div>
          ) : filteredChannels.length > 0 ? (
            <div className="channel-grid">
              {filteredChannels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  isSelected={selectedChannel?.id === channel.id}
                  isFavorite={favorites.includes(channel.id)}
                  onSelect={handleSelectChannel}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          ) : (
            <div className="glass-panel" style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
              <Tv size={48} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
              <h4 style={{ fontSize: '1.15rem', marginBottom: '0.5rem', color: '#fff' }}>
                {showFavoritesOnly ? 'لم تقم بإضافة أي قنوات للمفضلة بعد' : 'لا توجد قنوات تطابق بحثك'}
              </h4>
              <p style={{ fontSize: '0.9rem', maxWidth: '420px', margin: '0 auto' }}>
                {showFavoritesOnly 
                  ? 'انقر على رمز النجمة ⭐ بجانب أي قناة لإضافتها إلى قائمة مفضلتك والوصول إليها بسرعة.' 
                  : 'جرب البحث باسم آخر أو إزالة التصفية لعرض جميع القنوات المتاحة.'}
              </p>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border-subtle)', padding: '1.5rem', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-faint)', marginTop: '2rem' }}>
        <p style={{ marginBottom: '0.4rem' }}>
          منصة البث المباشر — مشغل HLS آمن ومحمي بتقنيات التشفير وعزل الأسرار وحماية SSRF.
        </p>
        <p>
          ⚠️ تنبيه: استمرار البث يعتمد على توفر واستقرار المزود المعتمد. استخدام المصادر يتطلب حقوق عرض وبث مصرحة بين صاحب التطبيق والمزود.
        </p>
      </footer>

      {/* Admin Login / Setup Modal */}
      <AdminAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={() => {
          setIsAuthModalOpen(false);
          setCurrentView('admin');
        }}
      />
    </div>
  );
}

export default App;
