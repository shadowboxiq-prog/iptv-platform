import React from 'react';
import { Star } from 'lucide-react';

export function CategoryBar({ 
  categories, 
  activeCategory, 
  onSelectCategory,
  showFavoritesOnly,
  onToggleFavoritesOnly,
  favoritesCount 
}) {
  return (
    <div className="category-bar">
      <button
        type="button"
        className={`category-pill ${!showFavoritesOnly && (activeCategory === 'all' || activeCategory === 'الكل') ? 'active' : ''}`}
        onClick={() => {
          if (showFavoritesOnly) onToggleFavoritesOnly(false);
          onSelectCategory('all');
        }}
      >
        جميع القنوات
      </button>

      <button
        type="button"
        className={`category-pill ${showFavoritesOnly ? 'active' : ''}`}
        onClick={() => onToggleFavoritesOnly(true)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
      >
        <Star size={16} fill={showFavoritesOnly ? '#07090e' : 'var(--accent-amber)'} color={showFavoritesOnly ? '#07090e' : 'var(--accent-amber)'} />
        المفضلة ({favoritesCount})
      </button>

      {categories.filter(c => c.category !== 'الكل' && c.category !== 'all').map((cat) => (
        <button
          key={cat.category}
          type="button"
          className={`category-pill ${!showFavoritesOnly && activeCategory === cat.category ? 'active' : ''}`}
          onClick={() => {
            if (showFavoritesOnly) onToggleFavoritesOnly(false);
            onSelectCategory(cat.category);
          }}
        >
          {cat.category} ({cat.count})
        </button>
      ))}
    </div>
  );
}

export default CategoryBar;
