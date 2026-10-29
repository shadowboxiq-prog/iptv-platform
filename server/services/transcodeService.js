import { spawn } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

export const ffmpegPath = ffmpegInstaller?.path || null;

export const QUALITY_PRESETS = {
  '720p': {
    id: '720p',
    label: 'جودة عالية (720p HD)',
    sublabel: 'صورة نقية وتوفير ~50% من البيانات (~1.8 Mbps)',
    badge: '720p',
    height: 720,
    videoBitrate: '1800k',
    maxRate: '2200k',
    bufSize: '3000k',
    audioBitrate: '96k',
    scale: 'scale=-2:720'
  },
  '480p': {
    id: '480p',
    label: 'جودة متوسطة (480p SD)',
    sublabel: 'ممتازة لتجنب التقطيع عند ضعف النت (~900 Kbps)',
    badge: '480p',
    height: 480,
    videoBitrate: '900k',
    maxRate: '1100k',
    bufSize: '1600k',
    audioBitrate: '64k',
    scale: 'scale=-2:480'
  },
  '360p': {
    id: '360p',
    label: 'موفر البيانات (360p Low)',
    sublabel: 'أفضل خيار للاتصال الضعيف جداً وباقات الموبايل (~450 Kbps)',
    badge: '360p',
    height: 360,
    videoBitrate: '450k',
    maxRate: '600k',
    bufSize: '900k',
    audioBitrate: '48k',
    scale: 'scale=-2:360'
  }
};

/**
 * Check if server-side transcoding via ffmpeg is supported
 */
export function isTranscodeAvailable() {
  return Boolean(ffmpegPath);
}

/**
 * Extract quality badge/tag from channel name (e.g. 4K, 8K, FHD, HD, SD, HEVC)
 */
export function extractQualityTag(name = '') {
  const upper = name.toUpperCase();
  if (upper.includes('8K')) return '8K UHD';
  if (upper.includes('4K') || upper.includes('UHD')) return '4K UHD';
  if (upper.includes('FHD') || upper.includes('1080')) return 'FHD 1080p';
  if (upper.includes('HD') || upper.includes('720')) return 'HD 720p';
  if (upper.includes('SD') || upper.includes('LOW')) return 'SD';
  if (upper.includes('HEVC')) return 'HEVC';
  if (upper.includes('RAW')) return 'RAW';
  return 'بث قياسي';
}

/**
 * Search database for sibling channels that represent different qualities or alternative feeds of the same station
 */
export function findSiblingChannels(db, channelId, channelName, category) {
  if (!db || !channelName) return [];

  try {
    // 1. Clean name to find root station identifier
    const words = channelName
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\b(4k|8k|fhd|hd|sd|hevc|uhd|1080p|720p|50fps|60fps|raw|◉|Ⓢ|Ⓣ|Ⓨ)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(w => w.length > 1);

    if (words.length === 0) return [];

    // Use top 2-3 significant words for matching
    const searchPrefix = words.slice(0, Math.min(3, words.length)).join(' ');
    if (searchPrefix.length < 3) return [];

    // Query in same category first or global channels
    const stmt = db.prepare(`
      SELECT id, name, category, logo_url
      FROM channels
      WHERE is_active = 1 
        AND id != ? 
        AND (name LIKE ? OR (category = ? AND name LIKE ?))
      LIMIT 8
    `);

    const matches = stmt.all(channelId, `%${searchPrefix}%`, category || '', `%${words[0]}%`);

    return matches.map(ch => ({
      id: ch.id,
      name: ch.name,
      category: ch.category,
      logoUrl: ch.logo_url,
      qualityTag: extractQualityTag(ch.name)
    }));
  } catch (err) {
    console.warn('findSiblingChannels error:', err.message);
    return [];
  }
}

/**
 * Real-time downscaling / transcoding of live stream via ffmpeg piped to MPEG-TS HTTP response
 */
export function transcodeStream(rawStreamUrl, qualityKey, clientRes, req, audioTrackIndex = null, startTime = 0) {
  if (!ffmpegPath) {
    throw new Error('محرك تحويل الفيديو (FFmpeg) غير متوفر على الخادم');
  }

  const preset = QUALITY_PRESETS[qualityKey] || QUALITY_PRESETS['480p'];

  clientRes.setHeader('Content-Type', 'video/mp2t');
  clientRes.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  clientRes.setHeader('Connection', 'keep-alive');
  clientRes.setHeader('X-Transcoded-Quality', preset.id);

  const seekSeconds = Number(startTime);
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'error',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '4',
    '-headers', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36\r\n',
    '-seekable', '1',
    ...(Number.isFinite(seekSeconds) && seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
    '-i', rawStreamUrl
  ];

  if (audioTrackIndex !== null && !isNaN(parseInt(audioTrackIndex, 10))) {
    ffmpegArgs.push('-map', '0:v:0', '-map', `0:a:${parseInt(audioTrackIndex, 10)}`);
  }

  ffmpegArgs.push(
    '-vf', preset.scale,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-b:v', preset.videoBitrate,
    '-maxrate', preset.maxRate,
    '-bufsize', preset.bufSize,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', preset.audioBitrate,
    '-ar', '44100',
    '-ac', '2',
    '-f', 'mpegts',
    'pipe:1'
  );

  const proc = spawn(ffmpegPath, ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let hasEnded = false;
  const cleanup = () => {
    if (hasEnded) return;
    hasEnded = true;
    try {
      proc.stdout.unpipe(clientRes);
    } catch {}
    try {
      proc.stdout.destroy();
    } catch {}
    try {
      proc.kill('SIGKILL');
    } catch {}
  };

  // IncomingMessage 'close' fires after the request has been received, which is
  // normal for a GET and would kill FFmpeg before it can stream any media.
  req.on('aborted', cleanup);
  clientRes.on('close', () => {
    if (!clientRes.writableEnded) cleanup();
  });

  proc.on('error', (err) => {
    console.error('FFmpeg process execution error:', err.message);
    cleanup();
    if (!clientRes.headersSent) {
      clientRes.status(500).type('text/plain').send('FFmpeg Transcoding Error: ' + err.message);
    }
  });

  proc.stderr.on('data', (data) => {
    const msg = data.toString();
    // Only log actual fatal errors, ignore standard PTS discontinuities
    if (msg.includes('Error') || msg.includes('Invalid')) {
      console.warn(`[FFmpeg Transcode ${preset.id}]`, msg.trim());
    }
  });

  proc.on('close', (code) => {
    cleanup();
    if (!clientRes.writableEnded) {
      try { clientRes.end(); } catch {}
    }
  });

  proc.stdout.pipe(clientRes);
  return proc;
}

/**
 * Fast remux with browser-compatible AAC audio conversion (-c:v copy -c:a aac)
 * Automatically converts EAC3 / AC3 / DTS to standard stereo AAC so audio plays
 * with pristine clarity in all web browsers!
 * Instant start with virtually zero CPU overhead!
 */
export function remuxStreamWithAudioTrack(rawStreamUrl, audioTrackIndex = 0, clientRes, req, outFormat = 'mp4', startTime = 0) {
  if (!ffmpegPath) {
    throw new Error('محرك تحويل الفيديو (FFmpeg) غير متوفر على الخادم');
  }

  const isMp4 = outFormat === 'mp4';
  const trackIdx = parseInt(audioTrackIndex || 0, 10);

  clientRes.setHeader('Content-Type', isMp4 ? 'video/mp4' : 'video/mp2t');
  clientRes.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  clientRes.setHeader('Connection', 'keep-alive');
  clientRes.setHeader('X-Audio-Track', String(trackIdx));

  const seekSeconds = Number(startTime);
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'error',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '4',
    '-headers', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36\r\n',
    '-seekable', '1',
    ...(Number.isFinite(seekSeconds) && seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
    '-i', rawStreamUrl,
    '-map', '0:v:0',
    '-map', `0:a:${isNaN(trackIdx) ? 0 : trackIdx}`,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '2'
  ];

  if (isMp4) {
    ffmpegArgs.push(
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4'
    );
  } else {
    ffmpegArgs.push('-f', 'mpegts');
  }

  ffmpegArgs.push('pipe:1');

  const proc = spawn(ffmpegPath, ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let hasEnded = false;
  const cleanup = () => {
    if (hasEnded) return;
    hasEnded = true;
    try {
      proc.stdout.unpipe(clientRes);
    } catch {}
    try {
      proc.stdout.destroy();
    } catch {}
    try {
      proc.kill('SIGKILL');
    } catch {}
  };

  // IncomingMessage 'close' fires after the request has been received, which is
  // normal for a GET and would kill FFmpeg before it can stream any media.
  req.on('aborted', cleanup);
  clientRes.on('close', () => {
    if (!clientRes.writableEnded) cleanup();
  });

  proc.on('error', (err) => {
    console.error('FFmpeg remux process execution error:', err.message);
    cleanup();
    if (!clientRes.headersSent) {
      clientRes.status(500).type('text/plain').send('FFmpeg Remux Error: ' + err.message);
    }
  });

  proc.stderr.on('data', (data) => {
    console.warn('[FFmpeg Remux]', data.toString().trim());
  });

  proc.on('close', (code) => {
    cleanup();
    if (!clientRes.writableEnded) {
      try { clientRes.end(); } catch {}
    }
  });

  proc.stdout.pipe(clientRes);
  return proc;
}
