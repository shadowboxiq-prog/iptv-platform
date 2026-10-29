const FAVORITES_KEY = 'iptv_viewer_favorites';

export const storage = {
  getFavorites() {
    try {
      const data = localStorage.getItem(FAVORITES_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  isFavorite(channelId) {
    const list = this.getFavorites();
    return list.includes(channelId);
  },

  toggleFavorite(channelId) {
    let list = this.getFavorites();
    if (list.includes(channelId)) {
      list = list.filter(id => id !== channelId);
    } else {
      list.push(channelId);
    }
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
    } catch (err) {
      console.warn('LocalStorage error saving favorites:', err);
    }
    return list;
  },

  getLastChannelId() {
    try {
      return localStorage.getItem('iptv_last_channel_id') || null;
    } catch {
      return null;
    }
  },

  setLastChannelId(channelId) {
    try {
      if (channelId) {
        localStorage.setItem('iptv_last_channel_id', channelId);
      }
    } catch (err) {
      console.warn('LocalStorage error saving last channel:', err);
    }
  }
};
