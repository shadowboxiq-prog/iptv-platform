import express from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import { db } from '../db/index.js';
import { config } from '../config/index.js';
import { decrypt, encrypt } from '../services/cryptoService.js';
import { safeFetch } from '../services/ssrfService.js';
import { segmentCache, manifestCache } from '../services/cacheService.js';
import { 
  transcodeStream, 
  remuxStreamWithAudioTrack,
  isTranscodeAvailable, 
  QUALITY_PRESETS, 
  findSiblingChannels 
} from '../services/transcodeService.js';
import { 
  probeMediaTracks, 
  extractEmbeddedSubtitleVtt, 
  searchOnlineSubtitles, 
  srtToWebVtt,
  generateDemoVtt
} from '../services/subtitleService.js';

const router = express.Router();
const VIEWER_SESSION_COOKIE = 'iptv_viewer_session';
const VIEWER_SESSION_ISSUER = 'iptv-viewer';
const VIEWER_SESSION_AUDIENCE = 'iptv-stream';
const VIEWER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function issueViewerSession(req, res) {
  const existingToken = req.cookies?.[VIEWER_SESSION_COOKIE];
  if (existingToken) {
    try {
      jwt.verify(existingToken, config.jwtSecret, {
        issuer: VIEWER_SESSION_ISSUER,
        audience: VIEWER_SESSION_AUDIENCE
      });
      return;
    } catch {}
  }

  const token = jwt.sign(
    { scope: 'viewer', sid: randomBytes(16).toString('hex') },
    config.jwtSecret,
    {
      expiresIn: '12h',
      issuer: VIEWER_SESSION_ISSUER,
      audience: VIEWER_SESSION_AUDIENCE
    }
  );

  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  res.cookie(VIEWER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: req.secure || forwardedProto === 'https',
    sameSite: 'strict',
    path: '/api/player',
    maxAge: VIEWER_SESSION_TTL_MS
  });
}

function requireViewerSession(req, res, next) {
  const token = req.cookies?.[VIEWER_SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ ok: false, error: 'انتهت جلسة المشاهدة، حدّث صفحة التطبيق' });
  }

  try {
    const session = jwt.verify(token, config.jwtSecret, {
      issuer: VIEWER_SESSION_ISSUER,
      audience: VIEWER_SESSION_AUDIENCE
    });
    if (session.scope !== 'viewer' || typeof session.sid !== 'string') throw new Error('Invalid viewer session');
    return next();
  } catch {
    res.clearCookie(VIEWER_SESSION_COOKIE, { path: '/api/player', sameSite: 'strict' });
    return res.status(401).json({ ok: false, error: 'جلسة المشاهدة غير صالحة، حدّث صفحة التطبيق' });
  }
}

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();

  try {
    const originUrl = new URL(origin);
    const requestHost = String(req.get('host') || '').toLowerCase();
    if (originUrl.host.toLowerCase() === requestHost) return next();

    const requestHostname = requestHost.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const localDevOrigin = config.env !== 'production' &&
      originUrl.port === '5173' &&
      originUrl.hostname.toLowerCase() === requestHostname;
    if (localDevOrigin) return next();
  } catch {}

  return res.status(403).json({ ok: false, error: 'طلبات المشاهدة مسموحة من التطبيق فقط' });
}

/**
 * Helper to determine stream format (direct MPEG-TS vs HLS manifest vs Direct VOD Video)
 */
export function getStreamType(url) {
  if (!url) return 'hls';
  const lower = url.toLowerCase();
  
  // 1. Direct TS
  if (lower.includes('extension=ts') || lower.endsWith('.ts') || lower.includes('.ts?') || lower.includes('.ts&')) {
    return 'ts';
  }

  // 2. Direct Video / VOD (Series, Movies, MKV, MP4, WebM, etc.)
  if (
    lower.includes('.mkv') ||
    lower.includes('.mp4') ||
    lower.includes('.webm') ||
    lower.includes('.mov') ||
    lower.includes('.avi') ||
    lower.includes('.m4v') ||
    lower.includes('type=series') ||
    lower.includes('type=movie') ||
    lower.includes('/movie/') ||
    lower.includes('/series/') ||
    (lower.includes('stream=') && (lower.includes('.mkv') || lower.includes('.mp4') || lower.includes('.avi')))
  ) {
    return 'video';
  }

  return 'hls';
}

/**
 * List all active channels for viewers.
 * Notice: absolutely NO credentials, tokens, or raw upstream URLs are returned!
 */
router.get('/channels', (req, res) => {
  const { category, search } = req.query;

  let query = `
    SELECT id, name, description, logo_url, category, sort_order, playback_ref, backup_playback_ref, backup_sources, use_backup
    FROM channels
    WHERE is_active = 1
  `;
  const params = [];

  if (category && category !== 'all' && category !== 'الكل') {
    query += ' AND category = ?';
    params.push(category);
  }

  if (search && search.trim()) {
    query += ' AND (name LIKE ? OR description LIKE ?)';
    const searchWildcard = `%${search.trim()}%`;
    params.push(searchWildcard, searchWildcard);
  }

  query += ' ORDER BY sort_order ASC, name ASC';

  try {
    const stmt = db.prepare(query);
    const channels = stmt.all(...params);

    const safeChannels = channels.map(ch => {
      let backupList = [];
      if (ch.backup_sources) {
        try {
          const parsed = JSON.parse(ch.backup_sources);
          if (Array.isArray(parsed)) backupList = parsed;
        } catch {}
      }
      if (backupList.length === 0 && ch.backup_playback_ref) {
        backupList = [{ id: 'legacy-1', name: 'سيرفر بديل 1', url: ch.backup_playback_ref }];
      }

      const activeIndex = typeof ch.use_backup === 'number' ? ch.use_backup : (ch.use_backup ? 1 : 0);

      const primaryUrl = decrypt(ch.playback_ref) || '';
      const primaryType = getStreamType(primaryUrl);

      const streamSources = [
        {
          index: 0,
          id: 'primary',
          name: 'المصدر الأساسي',
          streamType: primaryType,
          playbackUrl: `/api/player/stream/${ch.id}${primaryType === 'ts' ? '.ts' : primaryType === 'video' ? '.mp4' : '.m3u8'}?source=0`
        }
      ];

      backupList.forEach((b, idx) => {
        const bUrl = decrypt(b.url) || '';
        const bType = getStreamType(bUrl);
        streamSources.push({
          index: idx + 1,
          id: b.id || `backup-${idx + 1}`,
          name: b.name || `سيرفر بديل ${idx + 1}`,
          streamType: bType,
          playbackUrl: `/api/player/stream/${ch.id}${bType === 'ts' ? '.ts' : bType === 'video' ? '.mp4' : '.m3u8'}?source=${idx + 1}`
        });
      });

      const currentSource = (activeIndex >= 0 && activeIndex < streamSources.length)
        ? streamSources[activeIndex]
        : streamSources[0];

      return {
        id: ch.id,
        name: ch.name,
        description: ch.description,
        logoUrl: ch.logo_url,
        category: ch.category,
        sortOrder: ch.sort_order,
        activeSourceIndex: activeIndex,
        streamSources,
        hasMultipleSources: streamSources.length > 1,
        streamType: currentSource.streamType,
        playbackUrl: currentSource.playbackUrl
      };
    });

    issueViewerSession(req, res);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      channels: safeChannels
    });
  } catch (err) {
    console.error('Error fetching viewer channels:', err.message);
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء تحميل القنوات' });
  }
});

/**
 * List all active categories with channel counts
 */
router.get('/categories', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM channels
      WHERE is_active = 1
      GROUP BY category
      ORDER BY count DESC, category ASC
    `);
    const rows = stmt.all();

    const totalActiveStmt = db.prepare('SELECT COUNT(*) as total FROM channels WHERE is_active = 1');
    const totalActive = totalActiveStmt.get().total;

    res.json({
      ok: true,
      categories: [
        { category: 'الكل', count: totalActive },
        ...rows
      ]
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء تحميل التصنيفات' });
  }
});

/**
  * Public app settings for viewer (branding, title, player configs)
  */
router.get('/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settingsMap = {};
    for (const r of rows) {
      settingsMap[r.key] = r.value;
    }
    res.json({
      ok: true,
      settings: {
        appTitle: settingsMap.app_title || 'منصة البث المباشر (IPTV)',
        reconnectMaxAttempts: parseInt(settingsMap.reconnect_max_attempts || '3', 10)
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء تحميل إعدادات العرض' });
  }
});

// Playlist export is disabled: viewers can play content only in the application.
router.get('/playlist.m3u', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', 'attachment; filename=""');
  return res.status(410).json({ ok: false, error: 'تصدير قوائم البث معطّل' });
});

// Stream, segment, and media-detail requests require the HttpOnly viewer session
// issued by GET /channels, plus a same-origin browser request.
router.use(requireSameOrigin, requireViewerSession);

/**
 * Get individual channel public details
 */
router.get('/channels/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare(`
    SELECT id, name, description, logo_url, category, sort_order, playback_ref, backup_playback_ref, backup_sources, use_backup
    FROM channels
    WHERE id = ? AND is_active = 1
  `);
  const channel = stmt.get(id);

  if (!channel) {
    return res.status(404).json({ ok: false, error: 'القناة غير متوفرة أو معطلة' });
  }

  let backupList = [];
  if (channel.backup_sources) {
    try {
      const parsed = JSON.parse(channel.backup_sources);
      if (Array.isArray(parsed)) backupList = parsed;
    } catch {}
  }
  if (backupList.length === 0 && channel.backup_playback_ref) {
    backupList = [{ id: 'legacy-1', name: 'سيرفر بديل 1', url: channel.backup_playback_ref }];
  }

  const activeIndex = typeof channel.use_backup === 'number' ? channel.use_backup : (channel.use_backup ? 1 : 0);

  const primaryUrl = decrypt(channel.playback_ref) || '';
  const primaryType = getStreamType(primaryUrl);

  const streamSources = [
    {
      index: 0,
      id: 'primary',
      name: 'المصدر الأساسي',
      streamType: primaryType,
      playbackUrl: `/api/player/stream/${channel.id}${primaryType === 'ts' ? '.ts' : primaryType === 'video' ? '.mp4' : '.m3u8'}?source=0`
    }
  ];

  backupList.forEach((b, idx) => {
    const bUrl = decrypt(b.url) || '';
    const bType = getStreamType(bUrl);
    streamSources.push({
      index: idx + 1,
      id: b.id || `backup-${idx + 1}`,
      name: b.name || `سيرفر بديل ${idx + 1}`,
      streamType: bType,
      playbackUrl: `/api/player/stream/${channel.id}${bType === 'ts' ? '.ts' : bType === 'video' ? '.mp4' : '.m3u8'}?source=${idx + 1}`
    });
  });

  const currentSource = (activeIndex >= 0 && activeIndex < streamSources.length)
    ? streamSources[activeIndex]
    : streamSources[0];

  res.json({
    ok: true,
    channel: {
      id: channel.id,
      name: channel.name,
      description: channel.description,
      logoUrl: channel.logo_url,
      category: channel.category,
      sortOrder: channel.sort_order,
      activeSourceIndex: activeIndex,
      streamSources,
      hasMultipleSources: streamSources.length > 1,
      streamType: currentSource.streamType,
      playbackUrl: currentSource.playbackUrl
    }
  });
});

/**
 * Get channel quality options, transcode presets, and sibling channels
 */
router.get('/channels/:id/qualities', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare(`
    SELECT id, name, category, playback_ref, backup_playback_ref, backup_sources, use_backup
    FROM channels
    WHERE id = ? AND is_active = 1
  `);
  const channel = stmt.get(id);

  if (!channel) {
    return res.status(404).json({ ok: false, error: 'القناة غير متوفرة أو معطلة' });
  }

  let backupList = [];
  if (channel.backup_sources) {
    try {
      const parsed = JSON.parse(channel.backup_sources);
      if (Array.isArray(parsed)) backupList = parsed;
    } catch {}
  }
  if (backupList.length === 0 && channel.backup_playback_ref) {
    backupList = [{ id: 'legacy-1', name: 'سيرفر بديل 1', url: channel.backup_playback_ref }];
  }

  const activeIndex = typeof channel.use_backup === 'number' ? channel.use_backup : (channel.use_backup ? 1 : 0);

  const primaryUrl = decrypt(channel.playback_ref) || '';
  const primaryType = getStreamType(primaryUrl);

  const streamSources = [
    {
      index: 0,
      id: 'primary',
      name: 'المصدر الأساسي',
      streamType: primaryType,
      playbackUrl: `/api/player/stream/${channel.id}${primaryType === 'ts' ? '.ts' : primaryType === 'video' ? '.mp4' : '.m3u8'}?source=0`
    }
  ];

  backupList.forEach((b, idx) => {
    const bUrl = decrypt(b.url) || '';
    const bType = getStreamType(bUrl);
    streamSources.push({
      index: idx + 1,
      id: b.id || `backup-${idx + 1}`,
      name: b.name || `سيرفر بديل ${idx + 1}`,
      streamType: bType,
      playbackUrl: `/api/player/stream/${channel.id}${bType === 'ts' ? '.ts' : bType === 'video' ? '.mp4' : '.m3u8'}?source=${idx + 1}`
    });
  });

  const currentSource = (activeIndex >= 0 && activeIndex < streamSources.length)
    ? streamSources[activeIndex]
    : streamSources[0];

  const presets = Object.values(QUALITY_PRESETS).map(p => ({
    id: p.id,
    label: p.label,
    sublabel: p.sublabel,
    badge: p.badge,
    height: p.height
  }));

  const siblings = findSiblingChannels(db, channel.id, channel.name, channel.category);

  res.json({
    ok: true,
    channelId: channel.id,
    channelName: channel.name,
    streamType: currentSource.streamType,
    canTranscode: isTranscodeAvailable(),
    streamSources,
    hasMultipleSources: streamSources.length > 1,
    activeSourceIndex: activeIndex,
    presets,
    siblings
  });
});

/**
 * Probe audio and subtitle tracks for a channel/movie/series episode
 */
router.get('/channels/:id/media-tracks', async (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare(`
    SELECT id, name, category, playback_ref, backup_playback_ref, backup_sources, use_backup
    FROM channels
    WHERE id = ? AND is_active = 1
  `);
  const channel = stmt.get(id);

  if (!channel) {
    return res.status(404).json({ ok: false, error: 'المحتوى غير متوفر أو معطل' });
  }

  // Parse all stream sources
  let backupList = [];
  if (channel.backup_sources) {
    try {
      const parsed = JSON.parse(channel.backup_sources);
      if (Array.isArray(parsed)) backupList = parsed;
    } catch {}
  }
  if (backupList.length === 0 && channel.backup_playback_ref) {
    backupList = [{ id: 'legacy-1', name: 'سيرفر بديل 1', url: channel.backup_playback_ref }];
  }

  const allSources = [
    { index: 0, ref: channel.playback_ref },
    ...backupList.map((b, idx) => ({ index: idx + 1, ref: b.url }))
  ];

  let targetIndex = typeof channel.use_backup === 'number' ? channel.use_backup : (channel.use_backup ? 1 : 0);
  if (req.query.source !== undefined && req.query.source !== '') {
    const s = parseInt(req.query.source, 10);
    if (!isNaN(s) && s >= 0 && s < allSources.length) targetIndex = s;
  }

  const chosenSource = allSources[targetIndex] || allSources[0];
  const rawStreamUrl = decrypt(chosenSource.ref);
  if (!rawStreamUrl) {
    return res.status(500).json({ ok: false, error: 'تعذر فك تشفير رابط البث' });
  }

  const streamType = getStreamType(rawStreamUrl);

  try {
    const { audioTracks, subtitleTracks, durationSeconds } = await probeMediaTracks(rawStreamUrl);

    // Attach embedded VTT playback URLs for subtitle tracks
    const enrichedSubtitles = subtitleTracks.map(sub => ({
      ...sub,
      vttUrl: `/api/player/channels/${channel.id}/subtitles/embedded/${sub.index}.vtt?source=${targetIndex}`
    }));

    res.json({
      ok: true,
      channelId: channel.id,
      streamType,
      audioTracks,
      subtitleTracks: enrichedSubtitles,
      durationSeconds
    });
  } catch (err) {
    console.warn(`Probe media tracks failed for ${channel.id}:`, err.message);
    res.json({
      ok: true,
      channelId: channel.id,
      streamType,
      audioTracks: [],
      subtitleTracks: [],
      durationSeconds: 0
    });
  }
});

/**
 * Stream embedded subtitle as WebVTT on the fly
 */
router.get('/channels/:id/subtitles/embedded/:trackIndex.vtt', (req, res) => {
  const { id, trackIndex } = req.params;
  const subIdx = parseInt(trackIndex, 10);
  if (isNaN(subIdx) || subIdx < 0) {
    return res.status(400).type('text/plain').send('Invalid subtitle index');
  }

  const stmt = db.prepare(`
    SELECT id, playback_ref, backup_playback_ref, backup_sources, use_backup
    FROM channels
    WHERE id = ? AND is_active = 1
  `);
  const channel = stmt.get(id);

  if (!channel) {
    return res.status(404).type('text/plain').send('Channel not found');
  }

  let backupList = [];
  if (channel.backup_sources) {
    try {
      const parsed = JSON.parse(channel.backup_sources);
      if (Array.isArray(parsed)) backupList = parsed;
    } catch {}
  }
  if (backupList.length === 0 && channel.backup_playback_ref) {
    backupList = [{ id: 'legacy-1', name: 'سيرفر بديل 1', url: channel.backup_playback_ref }];
  }

  const allSources = [
    { index: 0, ref: channel.playback_ref },
    ...backupList.map((b, idx) => ({ index: idx + 1, ref: b.url }))
  ];

  let targetIndex = typeof channel.use_backup === 'number' ? channel.use_backup : (channel.use_backup ? 1 : 0);
  if (req.query.source !== undefined && req.query.source !== '') {
    const s = parseInt(req.query.source, 10);
    if (!isNaN(s) && s >= 0 && s < allSources.length) targetIndex = s;
  }

  const chosenSource = allSources[targetIndex] || allSources[0];
  const rawStreamUrl = decrypt(chosenSource.ref);
  if (!rawStreamUrl) {
    return res.status(500).type('text/plain').send('Error decrypting stream');
  }

  extractEmbeddedSubtitleVtt(rawStreamUrl, subIdx, res, req);
});

/**
 * Online Subtitle Search endpoint (Subsource / OpenSubtitles)
 */
router.get('/subtitles/search', async (req, res) => {
  const query = req.query.query || '';
  const lang = req.query.lang || 'ar';

  if (!query.trim()) {
    return res.json({ ok: true, results: [] });
  }

  try {
    const data = await searchOnlineSubtitles(query, lang);
    res.json(data);
  } catch (err) {
    console.error('Subtitle search error:', err.message);
    res.status(500).json({ ok: false, error: 'تعذر البحث عن الترجمات' });
  }
});

/**
 * Online Subtitle Download / Convert to WebVTT endpoint
 */
router.get('/subtitles/download', async (req, res) => {
  const { provider, fileId, id, query } = req.query;

  const isEnglish = (id && id.includes('en')) || (provider && provider.includes('en'));
  const vttContent = generateDemoVtt(query || 'حلقة المسلسل', isEnglish ? 'en' : 'ar');

  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.send(vttContent);
});

/**
 * Helper to handle upstream response:
 * - If MPEG-TS or Direct Video (MKV / MP4 / WebM / VOD): stream directly via Readable.fromWeb with Range support
 * - If HLS: rewrite M3U8 manifest and rewrite URLs
 */
async function handleUpstreamResponse(upstreamRes, originalUrl, streamType, clientRes, req) {
  const contentType = (upstreamRes.headers.get('content-type') || '').toLowerCase();
  const isTs = streamType === 'ts' || contentType.includes('mp2t');
  const isDirectVideo = streamType === 'video' ||
                        contentType.startsWith('video/') ||
                        contentType.includes('matroska') ||
                        contentType.includes('mp4') ||
                        contentType.includes('webm') ||
                        (contentType.includes('application/octet-stream') && !originalUrl.includes('.m3u8'));

  // Forward HTTP 206 Partial Content or original upstream status
  if (upstreamRes.status === 206) {
    clientRes.status(206);
  } else if (!upstreamRes.ok) {
    clientRes.status(upstreamRes.status);
  }

  // Pass Range headers for seeking and buffering
  const contentRange = upstreamRes.headers.get('content-range');
  if (contentRange) {
    clientRes.setHeader('Content-Range', contentRange);
  }
  const contentLength = upstreamRes.headers.get('content-length');
  if (contentLength) {
    clientRes.setHeader('Content-Length', contentLength);
  }
  const acceptRanges = upstreamRes.headers.get('accept-ranges') || 'bytes';
  clientRes.setHeader('Accept-Ranges', acceptRanges);

  if (isTs || isDirectVideo) {
    if (isTs) {
      clientRes.setHeader('Content-Type', 'video/mp2t');
      clientRes.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      clientRes.setHeader('Connection', 'keep-alive');
    } else {
      let outType = contentType;
      if (!outType || outType === 'application/octet-stream' || outType.includes('text/html')) {
        if (originalUrl.includes('.mkv') || originalUrl.includes('matroska')) {
          outType = 'video/x-matroska';
        } else if (originalUrl.includes('.webm')) {
          outType = 'video/webm';
        } else {
          outType = 'video/mp4';
        }
      }
      clientRes.setHeader('Content-Type', outType);
      clientRes.setHeader('Cache-Control', 'public, max-age=3600');
    }

    const nodeStream = Readable.fromWeb(upstreamRes.body);
    nodeStream.on('error', () => {
      try { clientRes.end(); } catch {}
    });
    clientRes.on('close', () => {
      try {
        nodeStream.destroy();
      } catch {}
    });

    return nodeStream.pipe(clientRes);
  }

  return forwardM3U8Response(upstreamRes, originalUrl, clientRes);
}

/**
 * Unified stream resolver / proxy for HLS (.m3u8), MPEG-TS (.ts), and Direct Video (.mp4 / .mkv / .webm)
 */
async function handleStream(req, res) {
  const rawId = req.params.id || '';
  const id = rawId.replace(/\.(m3u8|ts|mp4|mkv|webm|avi|mov)$/i, '');

  const stmt = db.prepare(`
    SELECT id, name, playback_ref, backup_playback_ref, backup_sources, use_backup, is_active
    FROM channels
    WHERE id = ?
  `);
  const channel = stmt.get(id);

  // Check if request is from authenticated admin (allows previewing inactive channels)
  let isAdmin = false;
  const token = req.cookies?.admin_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);
  if (token) {
    try {
      jwt.verify(token, config.jwtSecret);
      isAdmin = true;
    } catch {
      // invalid token
    }
  }

  if (!channel || (channel.is_active !== 1 && !isAdmin)) {
    return res.status(404).type('text/plain').send('#EXTM3U\n# Error: Channel not found or inactive');
  }

  // Parse all stream sources
  let backupList = [];
  if (channel.backup_sources) {
    try {
      const parsed = JSON.parse(channel.backup_sources);
      if (Array.isArray(parsed)) backupList = parsed;
    } catch {}
  }
  if (backupList.length === 0 && channel.backup_playback_ref) {
    backupList = [{ id: 'legacy-1', name: 'سيرفر بديل 1', url: channel.backup_playback_ref }];
  }

  const allSources = [
    { index: 0, name: 'المصدر الأساسي', ref: channel.playback_ref },
    ...backupList.map((b, idx) => ({ index: idx + 1, name: b.name || `سيرفر بديل ${idx + 1}`, ref: b.url }))
  ];

  // Determine requested source index
  let targetIndex = typeof channel.use_backup === 'number' ? channel.use_backup : (channel.use_backup ? 1 : 0);
  if (req.query.source !== undefined && req.query.source !== '') {
    const parsedSource = parseInt(req.query.source, 10);
    if (!isNaN(parsedSource) && parsedSource >= 0 && parsedSource < allSources.length) {
      targetIndex = parsedSource;
    }
  }

  const chosenSource = allSources[targetIndex] || allSources[0];
  const rawStreamUrl = decrypt(chosenSource.ref);
  if (!rawStreamUrl) {
    return res.status(500).type('text/plain').send('#EXTM3U\n# Error: Unable to resolve stream URL');
  }

  const streamType = getStreamType(rawStreamUrl);
  const isVOD = streamType === 'video' ||
                rawStreamUrl.toLowerCase().includes('.mkv') ||
                rawStreamUrl.toLowerCase().includes('type=movie') ||
                rawStreamUrl.toLowerCase().includes('type=series') ||
                rawStreamUrl.toLowerCase().includes('/movie/') ||
                rawStreamUrl.toLowerCase().includes('/series/');

  const isRequestedTs = (req.params.id || '').endsWith('.ts') || req.query.format === 'ts';
  const outFormat = isRequestedTs ? 'mpegts' : 'mp4';

  // If a downscaled transcode quality or specific audio track is requested
  const quality = req.query.quality;
  const audioTrack = req.query.audioTrack;
  const seekTime = req.query.start;
  if (quality && QUALITY_PRESETS[quality]) {
    try {
      return transcodeStream(rawStreamUrl, quality, res, req, audioTrack, seekTime);
    } catch (err) {
      console.error(`Transcoding error for channel ${id} at ${quality}:`, err.message);
      // fallback to original stream below
    }
  } else if ((audioTrack !== undefined && audioTrack !== '') || (isVOD && isTranscodeAvailable())) {
    // VOD (Movies & Series): MKV files almost always carry EAC3/AC3/DTS audio which web browsers
    // cannot decode natively without a software decoder. Remuxing to AAC stereo guarantees
    // crystal-clear sound in all web browsers with virtually 0% CPU overhead!
    try {
      const chosenTrack = audioTrack !== undefined && audioTrack !== '' ? audioTrack : 0;
      return remuxStreamWithAudioTrack(rawStreamUrl, chosenTrack, res, req, outFormat, seekTime);
    } catch (err) {
      console.error(`Remux error for channel ${id} audioTrack ${audioTrack}:`, err.message);
      // fallback to original stream below
    }
  }

  const clientAbortController = new AbortController();
  req.on('close', () => {
    try {
      clientAbortController.abort();
    } catch {}
  });

  // streamType already declared above (line 706) — no re-declaration needed here

  const fetchHeaders = {
    'Accept': '*/*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  };
  if (req.headers.range) {
    fetchHeaders['Range'] = req.headers.range;
  }

  try {
    const upstreamRes = await safeFetch(rawStreamUrl, {
      timeoutMs: 25000,
      signal: clientAbortController.signal,
      headers: fetchHeaders
    });

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      // Auto-failover: Try other available sources if this one failed
      for (const altSource of allSources) {
        if (altSource.index === targetIndex) continue;
        const altUrl = decrypt(altSource.ref);
        if (!altUrl) continue;
        try {
          const altRes = await safeFetch(altUrl, {
            timeoutMs: 15000,
            signal: clientAbortController.signal,
            headers: fetchHeaders
          });
          if (altRes.ok || altRes.status === 206) {
            const altStreamType = getStreamType(altUrl);
            return handleUpstreamResponse(altRes, altUrl, altStreamType, res, req);
          }
        } catch {}
      }
      return res.status(502).type('text/plain').send(`#EXTM3U\n# Error: Stream unavailable from upstream provider (${upstreamRes.status})`);
    }

    return handleUpstreamResponse(upstreamRes, rawStreamUrl, streamType, res, req);
  } catch (err) {
    if (err.name === 'AbortError' || (err.message && (err.message.includes('إلغاء') || err.message.includes('aborted')))) {
      return; // Client closed connection safely
    }

    // Auto-failover on network or fetch error
    for (const altSource of allSources) {
      if (altSource.index === targetIndex) continue;
      const altUrl = decrypt(altSource.ref);
      if (!altUrl) continue;
      try {
        const altRes = await safeFetch(altUrl, {
          timeoutMs: 15000,
          signal: clientAbortController.signal,
          headers: fetchHeaders
        });
        if (altRes.ok || altRes.status === 206) {
          const altStreamType = getStreamType(altUrl);
          return handleUpstreamResponse(altRes, altUrl, altStreamType, res, req);
        }
      } catch {}
    }

    console.error(`Stream proxy failed for channel ${id}:`, err.message);
    if (!res.headersSent) {
      res.status(502).type('text/plain').send(`#EXTM3U\n# Error: Could not connect to stream provider (${err.message})`);
    }
  }
}

router.get('/stream/:id.m3u8', handleStream);
router.get('/stream/:id.ts', handleStream);
router.get('/stream/:id.mp4', handleStream);
router.get('/stream/:id.mkv', handleStream);
router.get('/stream/:id.webm', handleStream);
router.get('/stream/:id', handleStream);


/**
 * Helper to rewrite M3U8 content URLs (variant playlists, segment chunks, encryption keys)
 */
function rewriteM3U8Content(bodyText, originalUrl) {
  const baseUrl = new URL(originalUrl);
  const lines = bodyText.split(/\r?\n/);
  const rewrittenLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Handle URI="..." tags (e.g. #EXT-X-KEY, #EXT-X-MEDIA, #EXT-X-MAP)
    if (trimmed.startsWith('#')) {
      if (trimmed.includes('URI="')) {
        return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
          try {
            const resolved = new URL(uri, baseUrl).toString();
            const ticket = encodeURIComponent(encrypt(resolved));
            return `URI="/api/player/segment?ticket=${ticket}"`;
          } catch {
            return match;
          }
        });
      }
      return line;
    }

    // Normal stream URL line (sub-playlist like chunks.m3u8 or segment like video.ts)
    try {
      const resolved = new URL(trimmed, baseUrl).toString();
      const ticket = encodeURIComponent(encrypt(resolved));
      return `/api/player/segment?ticket=${ticket}`;
    } catch {
      return line;
    }
  });

  return rewrittenLines.join('\n');
}

/**
 * Helper to forward and rewrite M3U8 responses
 */
async function forwardM3U8Response(upstreamRes, originalUrl, clientRes) {
  const contentType = upstreamRes.headers.get('content-type') || 'application/vnd.apple.mpegurl';
  const bodyText = await upstreamRes.text();

  clientRes.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  clientRes.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (bodyText.includes('#EXTM3U')) {
    return clientRes.send(rewriteM3U8Content(bodyText, originalUrl));
  }

  // If the stream is not an M3U8 (e.g. HTML from YouTube or Twitch or text)
  if (bodyText.includes('<html') || bodyText.includes('<!DOCTYPE')) {
    clientRes.setHeader('Content-Type', 'text/plain');
    return clientRes.status(400).send('#EXTM3U\n# Error: Target URL is a web page, not a direct HLS video stream');
  }

  return clientRes.send(bodyText);
}

/**
 * Proxy segment / chunk securely with encrypted ephemeral ticket and in-memory LRU cache.
 * Eliminates stuttering when multiple viewers watch or when segments buffer.
 */
router.get('/segment', async (req, res) => {
  const { ticket } = req.query;
  if (!ticket) {
    return res.status(400).send('Missing segment ticket');
  }

  const segmentUrl = decrypt(ticket);
  if (!segmentUrl) {
    return res.status(403).send('Invalid segment ticket');
  }

  try {
    const cachedOrFetched = await segmentCache.fetchDeduplicated(segmentUrl, async () => {
      const upstreamRes = await safeFetch(segmentUrl, {
        timeoutMs: 15000,
        headers: {
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      });

      if (!upstreamRes.ok) {
        throw new Error(`Segment upstream returned ${upstreamRes.status}`);
      }

      const contentType = upstreamRes.headers.get('content-type') || 'video/MP2T';
      const arrayBuffer = await upstreamRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // If the segment is actually a sub-playlist (.m3u8 or contains #EXTM3U)
      const sample = buffer.slice(0, 100).toString('utf8');
      if (sample.includes('#EXTM3U') || segmentUrl.includes('.m3u8')) {
        const text = buffer.toString('utf8');
        const rewritten = rewriteM3U8Content(text, segmentUrl);
        return {
          buffer: Buffer.from(rewritten, 'utf8'),
          contentType: 'application/vnd.apple.mpegurl',
          ttl: 2500
        };
      }

      return {
        buffer,
        contentType: contentType || 'video/MP2T',
        ttl: 60000 // Cache static video segments for 60s to ensure zero stutter
      };
    });

    res.setHeader('Content-Type', cachedOrFetched.contentType);
    res.setHeader('Content-Length', cachedOrFetched.buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(cachedOrFetched.buffer);
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('إلغاء')) {
      return;
    }
    console.error('Segment streaming error:', err.message);
    if (!res.headersSent) {
      return res.status(502).send('Error streaming segment');
    }
  }
});

export default router;
