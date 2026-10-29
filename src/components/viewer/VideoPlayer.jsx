import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { 
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, 
  RotateCcw, RotateCw, Tv, AlertTriangle, Radio, Film,
  SkipForward, SkipBack, Airplay, Sliders, ChevronRight, ChevronLeft, X,
  Gauge, Check, Sparkles, WifiOff, Zap, Settings2,
  Subtitles, Languages, Upload, Search, FileText, Clock, Plus
} from 'lucide-react';
import { SubtitleSearchModal } from './SubtitleSearchModal.jsx';

export function VideoPlayer({ 
  channel, 
  channels = [],
  onSelectChannel,
  onNextChannel, 
  onPrevChannel,
  hasPrev,
  hasNext,
  cinemaMode,
  onToggleCinema,
  maxReconnectAttempts = 3
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const mpegtsRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const seekTimeoutRef = useRef(null);
  const playbackOffsetRef = useRef(0);
  const probedDurationRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true); // Don't autoplay sound initially
  const [volume, setVolume] = useState(0.8);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playerState, setPlayerState] = useState('loading'); // 'loading' | 'playing' | 'error' | 'reconnecting'
  const [errorMessage, setErrorMessage] = useState('');
  const [reconnectCount, setReconnectCount] = useState(0);

  // VOD Time & Progress
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const durationRef = useRef(duration);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const directVideoCleanupRef = useRef(null);

  // Quality levels & quick drawer
  const [qualityLevels, setQualityLevels] = useState([]);
  const [currentQualityIndex, setCurrentQualityIndex] = useState(-1); // -1 = Auto
  const [isQualityMenuOpen, setIsQualityMenuOpen] = useState(false);
  const [isChannelDrawerOpen, setIsChannelDrawerOpen] = useState(false);
  const [isPipSupported, setIsPipSupported] = useState(false);

  // Server downscaled qualities & sibling channel discovery
  const [serverPresets, setServerPresets] = useState([]);
  const [siblingChannels, setSiblingChannels] = useState([]);
  const [canTranscode, setCanTranscode] = useState(false);
  const [actualResolution, setActualResolution] = useState({ width: 0, height: 0 });
  const [qualityNotification, setQualityNotification] = useState('');
  const toastTimerRef = useRef(null);

  // Data saver mode preference (persisted)
  const [dataSaverMode, setDataSaverMode] = useState(() => {
    try {
      return localStorage.getItem('iptv_data_saver') === 'true';
    } catch {
      return false;
    }
  });

  // Selected quality: 'auto' | 'original' | '720p' | '480p' | '360p'
  const [selectedQualityPreset, setSelectedQualityPreset] = useState(() => {
    try {
      if (localStorage.getItem('iptv_data_saver') === 'true') {
        return '480p';
      }
    } catch {}
    return 'auto';
  });

  // Stream sources / server switching state
  const [streamSources, setStreamSources] = useState(channel?.streamSources || []);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState(channel?.activeSourceIndex || 0);
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const currentSources = (streamSources && streamSources.length > 0) ? streamSources : (channel?.streamSources || []);

  // Multi-source failover and stability refs (prevents resetting back to primary & enables auto-failover)
  const selectedSourceIndexRef = useRef(channel?.activeSourceIndex || 0);
  const currentChannelIdRef = useRef(null);
  const failedSourcesRef = useRef(new Set());
  const stallWatchdogRef = useRef(null);
  const handleStreamFailureRef = useRef(null);
  const initPlayerRef = useRef(null);
  const destroyPlayerRef = useRef(null);
  const showQualityToastRef = useRef(null);
  const streamSourcesRef = useRef(channel?.streamSources || []);
  streamSourcesRef.current = currentSources;

  const resetStallWatchdog = useCallback(() => {
    if (stallWatchdogRef.current) {
      clearTimeout(stallWatchdogRef.current);
      stallWatchdogRef.current = null;
    }
  }, []);

  const MAX_RECONNECT_ATTEMPTS = Math.max(1, maxReconnectAttempts);

  const activePlaybackSource = channel?.streamSources?.find(source => source.index === selectedSourceIndex);
  const vodCategory = String(channel?.category || '')
    .normalize('NFKC')
    .replace(/[أإآ]/g, 'ا')
    .toLowerCase();
  const isVOD = (activePlaybackSource?.streamType || channel?.streamType) === 'video' ||
    ['افلام', 'مسلسلات', 'movies', 'series', 'vod'].some(category => vodCategory.includes(category)) ||
    duration > 0;
  const canSeekByRestartingStream = (activePlaybackSource?.streamType || channel?.streamType) === 'video';

  useEffect(() => {
    setIsPipSupported(typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled);
  }, []);

  // Multi-Audio Tracks & Subtitles State
  const [audioTracks, setAudioTracks] = useState([]);
  const [selectedAudioTrackIndex, setSelectedAudioTrackIndex] = useState(null);
  const [isAudioMenuOpen, setIsAudioMenuOpen] = useState(false);
  const selectedAudioTrackIndexRef = useRef(null);

  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [customSubtitles, setCustomSubtitles] = useState([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState(null);
  const [isSubtitleMenuOpen, setIsSubtitleMenuOpen] = useState(false);
  const [isSubtitleSearchModalOpen, setIsSubtitleSearchModalOpen] = useState(false);
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  const subtitleFileInputRef = useRef(null);

  // Subtitle cues & high-visibility display overlay state
  const [activeSubtitleText, setActiveSubtitleText] = useState('');
  const subtitleCuesRef = useRef([]);
  const subtitleDelayRef = useRef(0);

  // Time formatter helper
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '00:00';
    const totalSecs = Math.floor(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Cleanup helper
  const destroyPlayer = useCallback(() => {
    resetStallWatchdog();
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (seekTimeoutRef.current) {
      clearTimeout(seekTimeoutRef.current);
      seekTimeoutRef.current = null;
    }
    if (directVideoCleanupRef.current) {
      directVideoCleanupRef.current();
      directVideoCleanupRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (mpegtsRef.current) {
      try {
        mpegtsRef.current.pause();
        mpegtsRef.current.unload();
        mpegtsRef.current.detachMediaElement();
        mpegtsRef.current.destroy();
      } catch (e) {
        console.warn('mpegts destroy warning:', e);
      }
      mpegtsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
    setQualityLevels([]);
    setCurrentQualityIndex(-1);
    setCurrentTime(0);
    setDuration(0);
    setActualResolution({ width: 0, height: 0 });
  }, [resetStallWatchdog]);

  // ─── Mutable refs for values needed inside initPlayer (avoids stale closures) ───
  const channelRef = useRef(channel);
  const isMutedRef = useRef(isMuted);
  const selectedQualityPresetRef = useRef(selectedQualityPreset);
  const dataSaverModeRef = useRef(dataSaverMode);
  const isVODRef = useRef(isVOD);

  // Keep value-refs in sync with latest state/props without adding to useCallback deps
  channelRef.current = channel;
  durationRef.current = duration;
  isMutedRef.current = isMuted;
  selectedQualityPresetRef.current = selectedQualityPreset;
  dataSaverModeRef.current = dataSaverMode;
  isVODRef.current = isVOD;

  // Initialize playback — uses only refs so the function identity never changes
  const initPlayer = useCallback((retryAttempt = 0, explicitSourceIndex = null, explicitAudioTrackIndex = null, explicitStartTime = null) => {
    const channel = channelRef.current;
    if (!channel || !videoRef.current) return;

    const requestedStart = Number(explicitStartTime);
    const startOffset = Number.isFinite(requestedStart) && requestedStart > 0 ? requestedStart : 0;
    const previousDuration = durationRef.current;
    destroyPlayerRef.current?.();
    playbackOffsetRef.current = startOffset;
    if (startOffset > 0 && previousDuration > 0) {
      setCurrentTime(startOffset);
      setDuration(previousDuration);
    }
    setErrorMessage('');
    
    if (retryAttempt > 0) {
      setPlayerState('reconnecting');
      setReconnectCount(retryAttempt);
    } else {
      setPlayerState('loading');
      setReconnectCount(0);
    }

    const video = videoRef.current;
    video.muted = isMutedRef.current;

    // Use internal proxy stream URL with explicit or active source
    const activeIdx = explicitSourceIndex !== null ? explicitSourceIndex : selectedSourceIndexRef.current;
    selectedSourceIndexRef.current = activeIdx;
    setSelectedSourceIndex(activeIdx);

    const allSources = streamSourcesRef.current.length > 0 ? streamSourcesRef.current : (channel.streamSources || []);
    const activeSource = allSources.find(s => s.index === activeIdx) || allSources[0];

    let baseStreamUrl = activeSource?.playbackUrl || channel.playbackUrl || `/api/player/stream/${channel.id}${channel.streamType === 'ts' ? '.ts' : channel.streamType === 'video' ? '.mp4' : '.m3u8'}?source=${activeIdx}`;
    if (!baseStreamUrl.includes('source=')) {
      baseStreamUrl += (baseStreamUrl.includes('?') ? '&' : '?') + `source=${activeIdx}`;
    }

    let streamUrl = baseStreamUrl;
    const qPreset = selectedQualityPresetRef.current;
    // If a transcoded downscaled quality is explicitly selected (720p, 480p, 360p)
    if (qPreset && qPreset !== 'auto' && qPreset !== 'original') {
      streamUrl = `/api/player/stream/${channel.id}.ts?source=${activeIdx}&quality=${qPreset}`;
    }

    // If an audio track is explicitly selected (for multi-audio VOD / series)
    const activeAudioIdx = explicitAudioTrackIndex !== null ? explicitAudioTrackIndex : selectedAudioTrackIndexRef.current;
    if (activeAudioIdx !== null && activeAudioIdx !== undefined) {
      streamUrl += (streamUrl.includes('?') ? '&' : '?') + `audioTrack=${activeAudioIdx}`;
    }
    if (Number.isFinite(Number(explicitStartTime)) && Number(explicitStartTime) > 0) {
      streamUrl += (streamUrl.includes('?') ? '&' : '?') + `start=${Number(explicitStartTime)}`;
    }

    const currentStreamType = activeSource?.streamType || channel.streamType;
    const isTsStream = streamUrl.includes('?quality=') || currentStreamType === 'ts' || streamUrl.endsWith('.ts') || streamUrl.includes('.ts?') || streamUrl.includes('extension=ts');
    const isDirectVideo = !streamUrl.includes('?quality=') && (currentStreamType === 'video' ||
      streamUrl.endsWith('.mp4') ||
      streamUrl.includes('.mp4?') ||
      streamUrl.endsWith('.mkv') ||
      streamUrl.includes('.mkv?') ||
      streamUrl.endsWith('.webm') ||
      streamUrl.endsWith('.avi') ||
      streamUrl.endsWith('.mov'));

    // Dynamically detect playing video resolution
    const onResolutionDetected = () => {
      if (video.videoWidth && video.videoHeight) {
        setActualResolution({ width: video.videoWidth, height: video.videoHeight });
      }
    };
    video.addEventListener('loadedmetadata', onResolutionDetected);
    video.addEventListener('resize', onResolutionDetected);
    video.addEventListener('playing', onResolutionDetected);

    // Live stream freeze / stall watchdog (triggers auto failover if stream stops transmitting for > 6.5s)
    const onWaitingOrStalled = () => {
      if (isVODRef.current) return;
      if (stallWatchdogRef.current) return;
      stallWatchdogRef.current = setTimeout(() => {
        console.warn('[Watchdog] Stream stalled/frozen for > 6.5s, auto-switching to alternative source...');
        if (handleStreamFailureRef.current) {
          handleStreamFailureRef.current(0, 'توقف وتجمد تدفق البث');
        }
      }, 6500);
    };

    const onProgressOrPlaying = () => {
      resetStallWatchdog();
    };

    video.addEventListener('waiting', onWaitingOrStalled);
    video.addEventListener('stalled', onWaitingOrStalled);
    video.addEventListener('playing', onProgressOrPlaying);
    video.addEventListener('timeupdate', onProgressOrPlaying);

    if (isDirectVideo) {
      // Direct Video (MKV / MP4 / WebM / Series Episode / Movie VOD)
      const onLoadedMetadata = () => {
        if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
          if (!probedDurationRef.current && (!playbackOffsetRef.current || !durationRef.current)) {
            setDuration(video.duration + playbackOffsetRef.current);
          }
        }
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            setIsPlaying(true);
            setPlayerState('playing');
          }).catch((err) => {
            console.warn('Direct video play() paused/prevented:', err);
            setIsPlaying(false);
            setPlayerState('playing');
          });
        }
      };

      const onCanPlay = () => {
        setPlayerState('playing');
      };

      const onTimeUpdate = () => {
        setCurrentTime((video.currentTime || 0) + playbackOffsetRef.current);
        if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
          if (!probedDurationRef.current && (!playbackOffsetRef.current || !durationRef.current)) {
            setDuration(video.duration + playbackOffsetRef.current);
          }
        }
      };

      const onError = () => {
        console.error('Direct video error:', video.error);
        if (handleStreamFailureRef.current) {
          handleStreamFailureRef.current(retryAttempt, 'تعذر تشغيل هذا الرابط أو صيغة الفيديو غير مدعومة مباشرة');
        }
      };

      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('error', onError);

      directVideoCleanupRef.current = () => {
        resetStallWatchdog();
        video.removeEventListener('waiting', onWaitingOrStalled);
        video.removeEventListener('stalled', onWaitingOrStalled);
        video.removeEventListener('playing', onProgressOrPlaying);
        video.removeEventListener('timeupdate', onProgressOrPlaying);
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('timeupdate', onTimeUpdate);
        video.removeEventListener('error', onError);
      };

      video.src = streamUrl;
      video.load();
    } else if (isTsStream && mpegts.isSupported()) {
      try {
        const isDataSaver = dataSaverMode || selectedQualityPreset === '360p' || selectedQualityPreset === '480p';
        const player = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: streamUrl
        }, {
          enableWorker: false,
          lazyLoad: false,
          enableStashBuffer: true,
          stashInitialSize: isDataSaver ? 128 * 1024 : 384 * 1024,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: isDataSaver ? 12.0 : 20.0,
          liveBufferLatencyMinRemain: isDataSaver ? 2.5 : 3.5,
          liveBufferLatencyChasingOnPaused: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: isDataSaver ? 45 : 90,
          autoCleanupMinBackwardDuration: isDataSaver ? 20 : 45,
          fixAudioTimestampGap: true
        });

        mpegtsRef.current = player;
        player.attachMediaElement(video);
        player.load();

        const onPlaying = () => {
          setIsPlaying(true);
          setPlayerState('playing');
        };
        video.addEventListener('playing', onPlaying, { once: true });

        const playPromise = player.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            setIsPlaying(true);
            setPlayerState('playing');
          }).catch((err) => {
            console.warn('mpegts play() prevented or paused:', err);
            setIsPlaying(false);
            setPlayerState('playing');
          });
        }

        player.on(mpegts.Events.ERROR, (errorType, errorDetail, errorInfo) => {
          console.error('mpegts error:', errorType, errorDetail, errorInfo);
          if (errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
            handleStreamFailureRef.current?.(retryAttempt, `تعذر الاتصال بمصدر البث (${errorDetail || errorType})`);
          } else if (errorType === mpegts.ErrorTypes.MEDIA_ERROR) {
            console.warn('Recoverable media warning in stream:', errorDetail);
          } else {
            handleStreamFailureRef.current?.(retryAttempt, `تعذر تشغيل بث MPEG-TS (${errorDetail || errorType})`);
          }
        });
      } catch (err) {
        console.error('Error creating mpegts player:', err);
        handleStreamFailureRef.current?.(retryAttempt, 'تعذر تهيئة مشغل MPEG-TS');
      }
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: dataSaverMode ? 15 : 30,
        maxBufferLength: dataSaverMode ? 15 : 30,
        maxMaxBufferLength: dataSaverMode ? 30 : 60,
        maxBufferSize: dataSaverMode ? 20 * 1000 * 1000 : 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        capLevelToPlayerSize: dataSaverMode,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.2,
        nudgeMaxRetry: 5,
        startFragPrefetch: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 500,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 4,
        levelLoadingTimeOut: 15000,
        levelLoadingMaxRetry: 4,
      });

      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        if (data.levels && data.levels.length > 1) {
          const formattedLevels = data.levels.map((lvl, idx) => ({
            index: idx,
            label: lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)}k`,
            height: lvl.height,
            bitrate: lvl.bitrate
          }));
          setQualityLevels(formattedLevels);
        } else {
          setQualityLevels([]);
        }

        // Detect HLS native audio tracks
        if (hls.audioTracks && hls.audioTracks.length > 1) {
          const formattedAudio = hls.audioTracks.map((t, idx) => ({
            index: idx,
            id: t.id !== undefined ? t.id : idx,
            label: t.name || t.lang || `مسار صوتي ${idx + 1}`,
            language: t.lang || 'und'
          }));
          setAudioTracks(formattedAudio);
          setSelectedAudioTrackIndex(hls.audioTrack);
        }

        video.play().then(() => {
          setIsPlaying(true);
          setPlayerState('playing');
        }).catch((err) => {
          console.warn('Playback play() prevented or paused:', err);
          setIsPlaying(false);
          setPlayerState('playing');
        });
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              handleStreamFailureRef.current?.(retryAttempt, 'تعذر الاتصال بمصدر البث (خطأ شبكة)');
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              handleStreamFailureRef.current?.(retryAttempt, 'تعذر تشغيل تنسيق البث من المصدر');
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().then(() => {
          setIsPlaying(true);
          setPlayerState('playing');
        }).catch(() => {
          setIsPlaying(false);
          setPlayerState('playing');
        });
      });
      video.addEventListener('error', () => {
        handleStreamFailureRef.current?.(retryAttempt, 'تعذر تشغيل القناة على هذا المتصفح');
      });
    } else {
      setPlayerState('error');
      setErrorMessage('متصفحك لا يدعم تشغيل هذا البث');
    }
  }, []); // stable — reads all values via refs (channelRef, isMutedRef, etc.)

  const showQualityToast = useCallback((msg) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setQualityNotification(msg);
    toastTimerRef.current = setTimeout(() => {
      setQualityNotification('');
    }, 3500);
  }, []);
  // Keep ref in sync so triggerAutoFailover (stable []) can call it
  showQualityToastRef.current = showQualityToast;

  // Automatic source failover when stream fails or stalls
  const triggerAutoFailover = useCallback((reason) => {
    const allSources = streamSourcesRef.current.length > 0 ? streamSourcesRef.current : (channelRef.current?.streamSources || []);
    if (!allSources || allSources.length <= 1) {
      return false;
    }

    const currentIdx = selectedSourceIndexRef.current;
    failedSourcesRef.current.add(currentIdx);

    // Look for untried alternative source first
    let nextSource = allSources.find(s => !failedSourcesRef.current.has(s.index));
    if (!nextSource) {
      // All sources have failed; reset tracker and cycle circularly
      failedSourcesRef.current.clear();
      failedSourcesRef.current.add(currentIdx);
      const nextIdx = (currentIdx + 1) % allSources.length;
      nextSource = allSources.find(s => s.index === nextIdx) || allSources[0];
    }

    const currentSourceObj = allSources.find(s => s.index === currentIdx);
    const failedName = currentSourceObj ? currentSourceObj.name : `السيرفر ${currentIdx + 1}`;

    console.warn(`[Auto-Failover] ${failedName} failed (${reason}). Switching automatically to: ${nextSource.name}`);
    showQualityToastRef.current?.(`⚠️ انقطع البث من ${failedName}، جاري التحويل تلقائياً إلى: ${nextSource.name}...`);

    selectedSourceIndexRef.current = nextSource.index;
    setSelectedSourceIndex(nextSource.index);

    setTimeout(() => {
      initPlayerRef.current?.(0, nextSource.index);
    }, 400);

    return true;
  }, []); // stable — reads all values via refs

  // Progressive reconnect backoff & auto-failover
  const handleStreamFailure = useCallback((currentAttempt, reason) => {
    resetStallWatchdog();

    // Check if we can automatically failover to an alternative stream source!
    const allSources = streamSourcesRef.current.length > 0 ? streamSourcesRef.current : (channelRef.current?.streamSources || []);
    if (allSources && allSources.length > 1) {
      const didFailover = triggerAutoFailover(reason);
      if (didFailover) return;
    }

    if (currentAttempt < MAX_RECONNECT_ATTEMPTS) {
      const nextAttempt = currentAttempt + 1;
      setPlayerState('reconnecting');
      setReconnectCount(nextAttempt);
      const delayMs = Math.pow(2, currentAttempt) * 1000;

      retryTimeoutRef.current = setTimeout(() => {
        initPlayerRef.current?.(nextAttempt);
      }, delayMs);
    } else {
      destroyPlayerRef.current?.();
      setPlayerState('error');
      setErrorMessage(`${reason}. توقفت محاولات إعادة الاتصال التلقائية.`);
    }
  }, [resetStallWatchdog, triggerAutoFailover, MAX_RECONNECT_ATTEMPTS]); // stable

  // Bind refs — updated every render so callbacks always have latest version
  handleStreamFailureRef.current = handleStreamFailure;
  initPlayerRef.current = initPlayer;
  destroyPlayerRef.current = destroyPlayer;

  // Channel change effect - ONLY runs when switching to a DIFFERENT channel ID
  // ⚠️ dependency array must be [channel?.id] ONLY — adding initPlayer/destroyPlayer causes
  //    re-execution on every render which resets selectedSourceIndex back to primary (bug fix)
  useEffect(() => {
    if (!channel?.id) return;
    if (currentChannelIdRef.current !== channel.id) {
      currentChannelIdRef.current = channel.id;
      const defaultIdx = channel.activeSourceIndex || 0;
      selectedSourceIndexRef.current = defaultIdx;
      setSelectedSourceIndex(defaultIdx);
      if (channel.streamSources && channel.streamSources.length > 0) {
        setStreamSources(channel.streamSources);
        streamSourcesRef.current = channel.streamSources;
      }
      failedSourcesRef.current.clear();
      setIsSourceMenuOpen(false);
      // Use refs so this doesn't add them to dependency array
      if (initPlayerRef.current) initPlayerRef.current(0, defaultIdx);
    }
    return () => {
      if (destroyPlayerRef.current) destroyPlayerRef.current();
    };
  }, [channel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch channel quality presets & sibling alternative channels & sources
  useEffect(() => {
    if (!channel?.id) return;
    let isMounted = true;
    fetch(`/api/player/channels/${channel.id}/qualities`)
      .then(res => res.json())
      .then(data => {
        if (!isMounted) return;
        if (data.ok) {
          setServerPresets(data.presets || []);
          setSiblingChannels(data.siblings || []);
          setCanTranscode(Boolean(data.canTranscode));
          if (data.streamSources && data.streamSources.length > 0) {
            setStreamSources(data.streamSources);
          }
        }
      })
      .catch(err => console.warn('Failed to fetch qualities:', err));

    return () => { isMounted = false; };
  }, [channel?.id]);

  // Fetch media tracks (Audio Languages & Embedded Subtitles) for VOD / Series / Movies
  useEffect(() => {
    if (!channel?.id) return;
    probedDurationRef.current = 0;
    let isMounted = true;
    const currentIdx = selectedSourceIndexRef.current;

    fetch(`/api/player/channels/${channel.id}/media-tracks?source=${currentIdx}`)
      .then(res => res.json())
      .then(data => {
        if (!isMounted) return;
        if (data.ok) {
          if (Number.isFinite(data.durationSeconds) && data.durationSeconds > 0) {
            probedDurationRef.current = data.durationSeconds;
            setDuration(data.durationSeconds);
          }
          if (data.audioTracks && data.audioTracks.length > 0) {
            setAudioTracks(data.audioTracks);
          }
          if (data.subtitleTracks && data.subtitleTracks.length > 0) {
            setSubtitleTracks(data.subtitleTracks);
          }
        }
      })
      .catch(err => console.warn('Probe media tracks failed:', err));

    return () => { isMounted = false; };
  }, [channel?.id, selectedSourceIndex]);

  // Audio track switching handler
  const handleSelectAudioTrack = (trackIndex) => {
    setSelectedAudioTrackIndex(trackIndex);
    selectedAudioTrackIndexRef.current = trackIndex;
    setIsAudioMenuOpen(false);

    // If HLS with native audio tracks
    if (hlsRef.current && hlsRef.current.audioTracks && hlsRef.current.audioTracks.length > 1) {
      hlsRef.current.audioTrack = trackIndex;
      const chosen = audioTracks.find(t => t.index === trackIndex || t.id === trackIndex);
      showQualityToast(`🔊 تم تغيير الصوت إلى: ${chosen?.label || trackIndex}`);
      return;
    }

    // Direct Video / MPEG-TS Remux
    const chosen = audioTracks.find(t => t.index === trackIndex);
    showQualityToast(`🔊 جاري التبديل إلى المسار الصوتي: ${chosen?.label || trackIndex}...`);
    initPlayer(0, selectedSourceIndexRef.current, trackIndex, canSeekByRestartingStream ? currentTime : null);
  };

  // WebVTT & SRT timestamp parsing helper to guarantee subtitle display on any browser/format
  const parseVttCues = (vttText) => {
    if (!vttText) return [];
    const cues = [];
    const lines = vttText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let currentStartTime = null;
    let currentEndTime = null;
    let currentText = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const timeMatch = line.match(/(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})/);
      if (timeMatch) {
        if (currentStartTime !== null && currentText.length > 0) {
          cues.push({
            start: currentStartTime,
            end: currentEndTime,
            text: currentText.join('\n')
          });
          currentText = [];
        }
        const h1 = parseInt(timeMatch[1] || '0', 10);
        const m1 = parseInt(timeMatch[2], 10);
        const s1 = parseInt(timeMatch[3], 10);
        const ms1 = parseInt(timeMatch[4], 10);
        currentStartTime = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000;

        const h2 = parseInt(timeMatch[5] || '0', 10);
        const m2 = parseInt(timeMatch[6], 10);
        const s2 = parseInt(timeMatch[7], 10);
        const ms2 = parseInt(timeMatch[8], 10);
        currentEndTime = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000;
      } else if (line && !line.startsWith('WEBVTT') && !line.match(/^\d+$/)) {
        if (currentStartTime !== null) {
          currentText.push(line);
        }
      } else if (!line && currentStartTime !== null && currentText.length > 0) {
        cues.push({
          start: currentStartTime,
          end: currentEndTime,
          text: currentText.join('\n')
        });
        currentStartTime = null;
        currentEndTime = null;
        currentText = [];
      }
    }
    if (currentStartTime !== null && currentText.length > 0) {
      cues.push({
        start: currentStartTime,
        end: currentEndTime,
        text: currentText.join('\n')
      });
    }
    return cues;
  };

  // Video timeupdate handler to render custom overlay subtitles with 100% reliability
  const handleVideoTimeUpdate = (e) => {
    const time = (e?.target?.currentTime ?? videoRef.current?.currentTime ?? 0) + playbackOffsetRef.current;
    setCurrentTime(time);
    if (videoRef.current?.duration && !isNaN(videoRef.current.duration) && isFinite(videoRef.current.duration)) {
      if (!probedDurationRef.current && (!playbackOffsetRef.current || !durationRef.current)) {
        setDuration(videoRef.current.duration + playbackOffsetRef.current);
      }
    }

    if (subtitleCuesRef.current && subtitleCuesRef.current.length > 0) {
      const effectiveTime = time + (subtitleDelayRef.current || 0);
      const cue = subtitleCuesRef.current.find(c => effectiveTime >= c.start && effectiveTime <= c.end);
      setActiveSubtitleText(cue ? cue.text : '');
    } else {
      setActiveSubtitleText('');
    }
  };

  // Subtitle Application handler (Supports both Native HTML5 Track and High-Visibility Overlay)
  const applySubtitle = useCallback(async (sub, directVttText = null) => {
    const video = videoRef.current;
    if (!video) return;

    // Remove any existing dynamic subtitle tracks from DOM
    const existingTracks = video.querySelectorAll('track');
    existingTracks.forEach(t => t.remove());

    if (!sub) {
      setSelectedSubtitleId(null);
      subtitleCuesRef.current = [];
      setActiveSubtitleText('');
      showQualityToast('❌ تم إيقاف الترجمة');
      return;
    }

    setSelectedSubtitleId(sub.id);

    try {
      let vttContent = directVttText;
      if (!vttContent && sub.vttUrl) {
        const fetchRes = await fetch(sub.vttUrl);
        vttContent = await fetchRes.text();
      }

      if (vttContent) {
        const parsedCues = parseVttCues(vttContent);
        subtitleCuesRef.current = parsedCues;

        // Immediately check if there is a cue at current time
        const curTime = (video.currentTime || 0) + (subtitleDelayRef.current || 0);
        const match = parsedCues.find(c => curTime >= c.start && curTime <= c.end);
        if (match) {
          setActiveSubtitleText(match.text);
        }
      }
    } catch (err) {
      console.warn('Failed to parse subtitle text for overlay:', err);
    }

    // Attach native HTML5 track as well
    try {
      const trackEl = document.createElement('track');
      trackEl.kind = 'subtitles';
      trackEl.label = sub.label;
      trackEl.srclang = sub.langCode || 'ar';
      trackEl.src = sub.vttUrl;
      trackEl.default = true;

      trackEl.addEventListener('load', () => {
        try { trackEl.track.mode = 'showing'; } catch {}
      });

      video.appendChild(trackEl);
    } catch (err) {
      console.warn('Error attaching native track:', err);
    }

    showQualityToast(`💬 تم تفعيل وعرض الترجمة: ${sub.label}`);
  }, [showQualityToast]);

  // Upload local .srt or .vtt file
  const handleUploadSubtitle = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      let vttContent = content;
      if (file.name.endsWith('.srt')) {
        let text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        vttContent = `WEBVTT\n\n${text.trim()}\n`;
      }

      const blob = new Blob([vttContent], { type: 'text/vtt; charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const newSub = {
        id: `local-${Date.now()}`,
        label: `${file.name.replace(/\.(srt|vtt)$/i, '')} (ملف محلي)`,
        language: 'محلي',
        langCode: 'ar',
        vttUrl: blobUrl,
        isCustom: true
      };

      setCustomSubtitles(prev => [...prev, newSub]);
      applySubtitle(newSub, vttContent);
      setIsSubtitleMenuOpen(false);
    };

    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  // Subtitle timing sync adjustment
  const handleAdjustSubtitleDelay = (delta) => {
    setSubtitleDelay(prev => {
      const next = Math.round((prev + delta) * 10) / 10;
      subtitleDelayRef.current = next;

      // Immediately refresh active cue text with new delay offset
      const curTime = (videoRef.current?.currentTime || 0) + next;
      if (subtitleCuesRef.current && subtitleCuesRef.current.length > 0) {
        const match = subtitleCuesRef.current.find(c => curTime >= c.start && curTime <= c.end);
        setActiveSubtitleText(match ? match.text : '');
      }

      showQualityToast(`⏱️ تم ضبط توقيت الترجمة: ${next > 0 ? '+' : ''}${next} ثانية`);
      return next;
    });
  };

  // Manual Retry
  const handleManualRetry = () => {
    initPlayer(0, null, null, canSeekByRestartingStream ? currentTime : null);
  };

  // Keyboard controls & seek helpers
  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    if (!Number.isFinite(newTime)) return;
    setCurrentTime(newTime);
    if (canSeekByRestartingStream) {
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      seekTimeoutRef.current = setTimeout(() => {
        initPlayer(0, selectedSourceIndexRef.current, selectedAudioTrackIndexRef.current, newTime);
      }, 180);
    } else if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
  };

  const handleSkip = (seconds) => {
    if (!videoRef.current) return;
    const newTime = Math.min(Math.max(0, currentTime + seconds), duration || Infinity);
    setCurrentTime(newTime);
    if (canSeekByRestartingStream) {
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      initPlayer(0, selectedSourceIndexRef.current, selectedAudioTrackIndexRef.current, newTime);
    } else {
      videoRef.current.currentTime = newTime;
    }
  };

  const handleChangeSpeed = (speed) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setIsSpeedMenuOpen(false);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if focus is inside an input/textarea
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        toggleMute();
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (isVOD) {
          handleSkip(10);
        } else if (onPrevChannel) {
          onPrevChannel();
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (isVOD) {
          handleSkip(-10);
        } else if (onNextChannel) {
          onNextChannel();
        }
      } else if (e.code === 'KeyP') {
        e.preventDefault();
        if (onPrevChannel) onPrevChannel();
      } else if (e.code === 'KeyN') {
        e.preventDefault();
        if (onNextChannel) onNextChannel();
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        changeVolume(Math.min(1, volume + 0.1));
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        changeVolume(Math.max(0, volume - 0.1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, isMuted, volume, isVOD, duration, onNextChannel, onPrevChannel]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(console.warn);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const newMuted = !isMuted;
    videoRef.current.muted = newMuted;
    setIsMuted(newMuted);
  };

  const changeVolume = (newVol) => {
    if (!videoRef.current) return;
    videoRef.current.volume = newVol;
    setVolume(newVol);
    if (newVol > 0 && isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  };

  const toggleFullscreen = () => {
    const container = document.getElementById('player-container');
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(console.warn);
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(console.warn);
    }
  };

  const togglePictureInPicture = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP error:', err);
    }
  };

  const handleSelectSource = (index) => {
    // 1. Update ref FIRST (before any state update) so initPlayer reads the correct index
    selectedSourceIndexRef.current = index;
    // 2. Update UI state
    setSelectedSourceIndex(index);
    setIsSourceMenuOpen(false);
    // 3. Clear failed-sources so this source gets a fresh attempt
    failedSourcesRef.current.delete(index);

    const allSources = streamSourcesRef.current.length > 0 ? streamSourcesRef.current : (channel?.streamSources || []);
    const chosen = allSources.find(s => s.index === index);
    const sourceLabel = chosen ? chosen.name : `سيرفر ${index + 1}`;
    showQualityToast(`📡 جاري التبديل إلى: ${sourceLabel}...`);

    // 4. Actually reload the player with the new source!
    if (initPlayerRef.current) {
      initPlayerRef.current(0, index);
    }
  };

  const handleSelectPreset = (presetId) => {
    setSelectedQualityPreset(presetId);
    setIsQualityMenuOpen(false);

    let label = 'تلقائي (Auto)';
    if (presetId === 'original') label = 'المصدر الأصلي (Full Quality)';
    else if (presetId === '720p') label = '720p HD (توفير 50% بيانات)';
    else if (presetId === '480p') label = '480p SD (منع التقطيع)';
    else if (presetId === '360p') label = '360p موفر البيانات (أقل استهلاك)';

    showQualityToast(`⚡ جاري التبديل إلى: ${label}`);
  };

  const handleSelectNativeLevel = (index) => {
    setCurrentQualityIndex(index);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = index;
    }
    setIsQualityMenuOpen(false);
    const label = index === -1 ? 'تلقائي (Auto)' : qualityLevels.find(l => l.index === index)?.label || `${index}`;
    showQualityToast(`🎯 تم تحديد جودة المصدر المدمجة: ${label}`);
  };

  const handleSelectSibling = (sibling) => {
    setIsQualityMenuOpen(false);
    showQualityToast(`📺 الانتقال إلى: ${sibling.name} (${sibling.qualityTag})`);
    if (onSelectChannel) {
      onSelectChannel(sibling);
    }
  };

  const toggleDataSaver = () => {
    const next = !dataSaverMode;
    setDataSaverMode(next);
    try {
      localStorage.setItem('iptv_data_saver', next ? 'true' : 'false');
    } catch {}

    if (next) {
      if (selectedQualityPreset === 'auto' || selectedQualityPreset === 'original') {
        setSelectedQualityPreset('480p');
        showQualityToast('🍃 تم تفعيل موفر البيانات (480p - استهلاك ميغات أقل)');
      } else {
        showQualityToast('🍃 تم تفعيل وضع توفير البيانات ومنع التقطيع');
      }
    } else {
      setSelectedQualityPreset('auto');
      showQualityToast('🚀 تم تعطيل موفر البيانات - العودة للبث الأصلي');
    }
  };

  const getQualityBadgeText = () => {
    if (dataSaverMode) return '🍃 موفر البيانات';
    if (selectedQualityPreset === '720p') return '720p HD';
    if (selectedQualityPreset === '480p') return '480p SD';
    if (selectedQualityPreset === '360p') return '360p موفر';
    if (selectedQualityPreset === 'original') return 'أصلي';
    if (currentQualityIndex !== -1 && qualityLevels[currentQualityIndex]) {
      return qualityLevels[currentQualityIndex].label;
    }
    return 'الجودة';
  };

  const getPresetItemStyle = (isSelected) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.45rem 0.6rem',
    borderRadius: '7px',
    background: isSelected ? 'rgba(6, 182, 212, 0.18)' : 'rgba(255, 255, 255, 0.03)',
    border: isSelected ? '1px solid var(--accent-cyan)' : '1px solid transparent',
    color: '#fff',
    cursor: 'pointer',
    transition: 'all 0.15s',
    width: '100%',
    textAlign: 'right'
  });

  if (!channel) {
    return (
      <div className="player-wrapper" style={{ background: 'var(--bg-surface-elevated)' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <Tv size={56} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
          <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>اختر قناة من القائمة لبدء المشاهدة</h3>
          <p style={{ fontSize: '0.9rem' }}>يمكنك البحث والتصفية حسب التصنيف المفضل لديك</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      id="player-container" 
      className="player-wrapper"
      style={{
        maxHeight: cinemaMode ? '82vh' : undefined,
        aspectRatio: cinemaMode ? '21 / 9' : '16 / 9'
      }}
    >
      <video
        ref={videoRef}
        className="player-video"
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        onTimeUpdate={handleVideoTimeUpdate}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      {/* High-Visibility Arabic Subtitle Overlay Banner (Netflix / VLC Style) */}
      {activeSubtitleText && (
        <div 
          className="player-subtitle-overlay"
          style={{
            position: 'absolute',
            bottom: '75px',
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: '85%',
            width: 'max-content',
            textAlign: 'center',
            pointerEvents: 'none',
            zIndex: 22,
            direction: 'rtl',
            userSelect: 'none'
          }}
        >
          <span 
            style={{
              display: 'inline-block',
              backgroundColor: 'rgba(0, 0, 0, 0.85)',
              color: '#ffffff',
              fontSize: 'clamp(1.1rem, 2.5vw, 1.85rem)',
              fontWeight: 700,
              lineHeight: 1.5,
              padding: '0.4rem 1.1rem',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.18)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.85)',
              textShadow: '0 2px 4px #000, 0 0 4px #000',
              whiteSpace: 'pre-wrap'
            }}
          >
            {activeSubtitleText}
          </span>
        </div>
      )}

      {/* Floating Click-to-Unmute Badge (When sound is muted on startup) */}
      {isMuted && isPlaying && (
        <button
          type="button"
          onClick={toggleMute}
          style={{
            position: 'absolute',
            top: '5.2rem',
            left: '1.5rem',
            background: 'rgba(239, 68, 68, 0.92)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            borderRadius: '24px',
            padding: '0.45rem 1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            color: '#fff',
            fontSize: '0.82rem',
            fontWeight: 700,
            boxShadow: '0 8px 25px rgba(239, 68, 68, 0.45)',
            zIndex: 25,
            cursor: 'pointer'
          }}
        >
          <VolumeX size={16} />
          <span>الصوت مكتوم - اضغط للتشغيل 🔊</span>
        </button>
      )}

      {/* Floating Quality Change Toast Notification */}
      {qualityNotification && (
        <div style={{
          position: 'absolute',
          top: '4.8rem',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(11, 16, 29, 0.94)',
          backdropFilter: 'blur(12px)',
          border: '1px solid var(--accent-cyan)',
          borderRadius: '24px',
          padding: '0.45rem 1.1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          color: '#fff',
          fontSize: '0.85rem',
          fontWeight: 700,
          boxShadow: '0 8px 30px rgba(0,0,0,0.8), 0 0 15px rgba(6,182,212,0.3)',
          zIndex: 25,
          pointerEvents: 'none'
        }}>
          <Sliders size={16} color="var(--accent-cyan)" />
          <span>{qualityNotification}</span>
        </div>
      )}



      {/* Top Channel Bar Overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '1rem 1.25rem',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          {channel.logoUrl ? (
            <img 
              src={channel.logoUrl} 
              alt={channel.name} 
              style={{ width: '42px', height: '42px', objectFit: 'contain', borderRadius: '8px', background: 'rgba(255,255,255,0.1)' }} 
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          ) : (
            <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Radio size={22} color="var(--accent-cyan)" />
            </div>
          )}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800 }}>{channel.name}</h2>
              {isVOD ? (
                <span className="badge" style={{
                  background: 'linear-gradient(135deg, rgba(236,72,153,0.25), rgba(168,85,247,0.25))',
                  color: '#f472b6',
                  border: '1px solid rgba(244,114,182,0.4)',
                  fontSize: '0.75rem',
                  padding: '0.2rem 0.6rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}>
                  <Film size={13} />
                  مسلسلات وأفلام VOD
                </span>
              ) : (
                <span className="badge badge-live">
                  <span className="badge-pulse-dot" />
                  مباشر
                </span>
              )}
              {actualResolution.height > 0 && (
                <span style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '0.12rem 0.45rem',
                  borderRadius: '4px',
                  background: dataSaverMode ? 'rgba(16, 185, 129, 0.2)' : 'rgba(6, 182, 212, 0.2)',
                  color: dataSaverMode ? '#34d399' : 'var(--accent-cyan-light)',
                  border: dataSaverMode ? '1px solid rgba(52, 211, 153, 0.35)' : '1px solid rgba(6, 182, 212, 0.35)'
                }}>
                  {dataSaverMode ? '🍃 ' : ''}{actualResolution.height}p
                </span>
              )}
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{channel.category || 'عام'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Quick Channels Drawer Trigger */}
          {channels.length > 0 && (
            <button
              type="button"
              className="btn-icon"
              onClick={() => setIsChannelDrawerOpen(!isChannelDrawerOpen)}
              title={isChannelDrawerOpen ? 'إغلاق قائمة القنوات' : 'فتح قائمة القنوات السريعة'}
              style={{
                background: isChannelDrawerOpen ? 'rgba(6,182,212,0.25)' : 'rgba(0,0,0,0.5)',
                color: isChannelDrawerOpen ? 'var(--accent-cyan-light)' : '#fff'
              }}
            >
              <Tv size={18} />
            </button>
          )}

          {/* Cinema Mode Toggle */}
          <button 
            type="button" 
            className="btn-icon" 
            onClick={onToggleCinema} 
            title={cinemaMode ? 'إلغاء وضع السينما' : 'تفعيل وضع السينما'}
          >
            <Film size={18} color={cinemaMode ? 'var(--accent-cyan)' : '#fff'} />
          </button>
        </div>
      </div>

      {/* Quick In-Player Channel Drawer */}
      {isChannelDrawerOpen && (
        <div style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: '280px',
          background: 'rgba(10, 14, 24, 0.95)',
          backdropFilter: 'blur(16px)',
          borderLeft: '1px solid var(--border-subtle)',
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          padding: '1rem',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
              القنوات المتاحة ({channels.length})
            </span>
            <button 
              type="button" 
              className="btn-icon" 
              style={{ padding: '0.3rem' }}
              onClick={() => setIsChannelDrawerOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {channels.map((ch) => (
              <div
                key={ch.id}
                onClick={() => {
                  onSelectChannel(ch);
                  setIsChannelDrawerOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '0.5rem 0.6rem',
                  borderRadius: '8px',
                  background: ch.id === channel.id ? 'rgba(6,182,212,0.2)' : 'rgba(255,255,255,0.03)',
                  border: ch.id === channel.id ? '1px solid var(--border-glow)' : '1px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {ch.logoUrl ? (
                    <img src={ch.logoUrl} alt={ch.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.target.style.display = 'none'; }} />
                  ) : (
                    <Radio size={14} color="var(--accent-cyan)" />
                  )}
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ch.name}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{ch.category || 'عام'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}



      {/* Loading Overlay */}
      {playerState === 'loading' && (
        <div className="player-overlay">
          <div className="badge-pulse-dot" style={{ width: '20px', height: '20px', background: isVOD ? '#ec4899' : 'var(--accent-cyan)', marginBottom: '1rem' }} />
          <p style={{ fontWeight: 600, fontSize: '1.05rem' }}>
            {isVOD ? 'جاري تهيئة الحلقة / الفيديو...' : 'جاري تهيئة البث المباشر...'}
          </p>
        </div>
      )}



      {/* Reconnecting Overlay */}
      {playerState === 'reconnecting' && (
        <div className="player-overlay">
          <RotateCcw className="animate-spin" size={32} color="var(--accent-amber)" style={{ marginBottom: '1rem' }} />
          <h4 style={{ color: 'var(--accent-amber)', marginBottom: '0.5rem' }}>جاري إعادة الاتصال بمصدر البث...</h4>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            محاولة ({reconnectCount} من {MAX_RECONNECT_ATTEMPTS})
          </p>
        </div>
      )}



      {/* Error Overlay */}
      {playerState === 'error' && (
        <div className="player-overlay" style={{ background: 'rgba(10, 10, 15, 0.92)' }}>
          <AlertTriangle size={48} color="var(--accent-rose)" style={{ marginBottom: '1rem' }} />
          <h3 style={{ color: '#fff', marginBottom: '0.5rem' }}>تعذر تشغيل هذا المحتوى</h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: '420px', marginBottom: '1.25rem', fontSize: '0.95rem' }}>
            {errorMessage || 'المصدر غير متاح حالياً أو يتطلب ترخيصاً من المزود. استمرار البث يعتمد على توفر الخادم المزود.'}
          </p>

          {/* Quick Alternative Servers Fallback */}
          {currentSources.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', width: '100%', maxWidth: '380px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--accent-amber)', fontWeight: 600 }}>
                توجد سيرفرات بديلة متاحة، يمكنك تجربة مصدر آخر:
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                {currentSources.map(s => (
                  <button
                    key={s.index}
                    type="button"
                    className="btn btn-secondary"
                    style={{
                      fontSize: '0.8rem',
                      padding: '0.35rem 0.75rem',
                      background: selectedSourceIndex === s.index ? 'rgba(6,182,212,0.25)' : 'rgba(255,255,255,0.08)',
                      borderColor: selectedSourceIndex === s.index ? 'var(--accent-cyan)' : 'var(--border-subtle)',
                      color: selectedSourceIndex === s.index ? 'var(--accent-cyan-light)' : '#fff'
                    }}
                    onClick={() => handleSelectSource(s.index)}
                  >
                    {s.name} {selectedSourceIndex === s.index ? '(الحالي)' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button 
            type="button" 
            className="btn btn-primary" 
            onClick={handleManualRetry}
          >
            <RotateCcw size={18} />
            إعادة المحاولة
          </button>
        </div>
      )}



      {/* Bottom Controls Overlay */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '1.5rem 1.25rem 0.75rem',
        background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        zIndex: 10
      }}>
        {/* Scrubber / Progress Bar for Series & Movies (VOD) */}
        {isVOD && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            width: '100%',
            direction: 'ltr',
            userSelect: 'none'
          }}>
            <span style={{ fontSize: '0.8rem', color: '#f1f5f9', fontFamily: 'monospace', minWidth: '45px', fontWeight: 600 }}>
              {formatTime(currentTime)}
            </span>
            <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
              <input
                type="range"
                min="0"
                max={duration > 0 ? duration : 100}
                step="0.5"
                value={currentTime}
                onChange={handleSeek}
                style={{
                  width: '100%',
                  cursor: 'pointer',
                  accentColor: '#ec4899',
                  height: '6px',
                  borderRadius: '3px',
                  background: `linear-gradient(to right, #ec4899 ${duration ? (currentTime / duration) * 100 : 0}%, rgba(255,255,255,0.2) ${duration ? (currentTime / duration) * 100 : 0}%)`
                }}
                aria-label="شريط التقدم"
              />
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace', minWidth: '45px' }}>
              {formatTime(duration)}
            </span>
          </div>
        )}

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%'
        }}>
          {/* Left Side: Playback & Volume & Skip / Channel Switching */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {isVOD ? (
              <button
                type="button"
                className="btn-icon"
                onClick={() => handleSkip(-10)}
                title="ترجيع 10 ثوانٍ (ArrowLeft)"
                style={{ fontSize: '0.72rem', display: 'inline-flex', gap: '0.2rem', padding: '0.3rem 0.5rem', width: 'auto' }}
              >
                <RotateCcw size={15} />
                <span>10-</span>
              </button>
            ) : (
              <button 
                type="button" 
                className="btn-icon" 
                onClick={onPrevChannel}
                disabled={!hasPrev}
                title="القناة السابقة (ArrowRight / P)"
                aria-label="القناة السابقة"
                style={{ opacity: hasPrev ? 1 : 0.4 }}
              >
                <SkipBack size={18} />
              </button>
            )}

            {/* Play/Pause */}
            <button 
              type="button" 
              className="btn-icon" 
              onClick={togglePlay}
              aria-label={isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
              style={{ background: 'rgba(255,255,255,0.18)', width: '38px', height: '38px' }}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} fill="#fff" />}
            </button>

            {isVOD ? (
              <button
                type="button"
                className="btn-icon"
                onClick={() => handleSkip(10)}
                title="تقديم 10 ثوانٍ (ArrowRight)"
                style={{ fontSize: '0.72rem', display: 'inline-flex', gap: '0.2rem', padding: '0.3rem 0.5rem', width: 'auto' }}
              >
                <RotateCw size={15} />
                <span>10+</span>
              </button>
            ) : (
              <button 
                type="button" 
                className="btn-icon" 
                onClick={onNextChannel}
                disabled={!hasNext}
                title="القناة التالية (ArrowLeft / N)"
                aria-label="القناة التالية"
                style={{ opacity: hasNext ? 1 : 0.4 }}
              >
                <SkipForward size={18} />
              </button>
            )}

            {/* Volume Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginRight: '0.5rem' }}>
              <button 
                type="button" 
                className="btn-icon" 
                onClick={toggleMute}
                aria-label={isMuted ? 'إلغاء كتم الصوت' : 'كتم الصوت'}
              >
                {isMuted ? <VolumeX size={19} color="var(--accent-rose)" /> : <Volume2 size={19} />}
              </button>

              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05"
                value={isMuted ? 0 : volume} 
                onChange={(e) => changeVolume(parseFloat(e.target.value))}
                style={{ width: '75px', accentColor: 'var(--accent-cyan)', cursor: 'pointer' }}
                aria-label="مستوى الصوت"
              />
            </div>
          </div>

          {/* Right Side: Speed & Quality & PiP & Fullscreen */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}>
            {/* Speed Selector for VOD */}
            {isVOD && (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => setIsSpeedMenuOpen(!isSpeedMenuOpen)}
                  title="سرعة التشغيل"
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    width: 'auto',
                    padding: '0.3rem 0.6rem',
                    borderRadius: 'var(--radius-full)',
                    background: playbackSpeed === 1 ? 'rgba(255,255,255,0.1)' : 'rgba(236,72,153,0.25)',
                    color: playbackSpeed === 1 ? '#fff' : '#f472b6'
                  }}
                >
                  <Gauge size={14} style={{ marginLeft: '0.25rem' }} />
                  {playbackSpeed}x
                </button>

                {isSpeedMenuOpen && (
                  <div style={{
                    position: 'absolute',
                    bottom: '120%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(13, 18, 31, 0.95)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '8px',
                    padding: '0.4rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    minWidth: '95px',
                    boxShadow: 'var(--shadow-md)',
                    zIndex: 20
                  }}>
                    {[0.75, 1, 1.25, 1.5, 2].map(spd => (
                      <button
                        key={spd}
                        type="button"
                        className={`btn ${playbackSpeed === spd ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', justifyContent: 'center' }}
                        onClick={() => handleChangeSpeed(spd)}
                      >
                        {spd}x {spd === 1 ? '(عادي)' : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          {/* Stream Source / Server Switcher (when multiple sources exist) */}
          {currentSources.length > 1 && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="btn-icon"
                onClick={() => {
                  setIsSourceMenuOpen(!isSourceMenuOpen);
                  setIsQualityMenuOpen(false);
                  setIsSpeedMenuOpen(false);
                }}
                title="التبديل بين سيرفرات ومصادر البث"
                aria-label="سيرفرات البث"
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  width: 'auto',
                  padding: '0.3rem 0.65rem',
                  borderRadius: 'var(--radius-full)',
                  background: selectedSourceIndex > 0 ? 'rgba(245, 158, 11, 0.22)' : 'rgba(6, 182, 212, 0.22)',
                  color: selectedSourceIndex > 0 ? 'var(--accent-amber)' : 'var(--accent-cyan-light)',
                  border: selectedSourceIndex > 0 ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid rgba(6, 182, 212, 0.4)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  transition: 'all 0.2s'
                }}
              >
                <Radio size={14} />
                <span>{currentSources.find(s => s.index === selectedSourceIndex)?.name || `سيرفر ${selectedSourceIndex + 1}`}</span>
                <span style={{
                  fontSize: '0.65rem',
                  padding: '0.05rem 0.35rem',
                  background: 'rgba(0,0,0,0.35)',
                  borderRadius: '3px',
                  opacity: 0.85
                }}>
                  {currentSources.length} سيرفرات
                </span>
              </button>

              {/* Source Selection Dropdown Menu */}
              {isSourceMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '135%',
                    left: 0,
                    width: '280px',
                    maxWidth: '90vw',
                    background: 'rgba(11, 16, 29, 0.96)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid var(--border-glow)',
                    borderRadius: '12px',
                    padding: '0.85rem',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 12px 36px rgba(0,0,0,0.85), 0 0 20px rgba(6,182,212,0.15)',
                    zIndex: 35,
                    direction: 'rtl'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.86rem', color: '#fff' }}>
                      <Radio size={16} color="var(--accent-cyan)" />
                      <span>مصادر وسيرفرات البث</span>
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {currentSources.length} مصادر متاحة
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {currentSources.map(source => {
                      const isSelected = selectedSourceIndex === source.index;
                      return (
                        <button
                          key={source.index}
                          type="button"
                          onClick={() => handleSelectSource(source.index)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.55rem 0.75rem',
                            borderRadius: '8px',
                            background: isSelected ? 'rgba(6, 182, 212, 0.18)' : 'rgba(255,255,255,0.04)',
                            border: isSelected ? '1px solid var(--accent-cyan)' : '1px solid rgba(255,255,255,0.06)',
                            color: isSelected ? '#fff' : 'var(--text-muted)',
                            cursor: 'pointer',
                            textAlign: 'right',
                            fontSize: '0.85rem',
                            fontWeight: isSelected ? 700 : 500,
                            transition: 'all 0.15s'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: isSelected ? 'var(--accent-emerald)' : 'rgba(255,255,255,0.3)',
                              boxShadow: isSelected ? '0 0 8px var(--accent-emerald)' : 'none'
                            }} />
                            <span>{source.name}</span>
                          </div>
                          {isSelected && <Check size={16} color="var(--accent-cyan)" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quality Selector & Data Saver Modal Button */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setIsQualityMenuOpen(!isQualityMenuOpen)}
              title="جودة البث وخيارات توفير البيانات"
              aria-label="خيارات جودة البث"
              style={{
                fontSize: '0.78rem',
                fontWeight: 700,
                width: 'auto',
                padding: '0.3rem 0.65rem',
                borderRadius: 'var(--radius-full)',
                background: dataSaverMode
                  ? 'rgba(16, 185, 129, 0.22)'
                  : (selectedQualityPreset !== 'auto' && selectedQualityPreset !== 'original')
                    ? 'rgba(6, 182, 212, 0.22)'
                    : 'rgba(255, 255, 255, 0.1)',
                color: dataSaverMode
                  ? '#34d399'
                  : (selectedQualityPreset !== 'auto' && selectedQualityPreset !== 'original')
                    ? 'var(--accent-cyan-light)'
                    : '#fff',
                border: dataSaverMode
                  ? '1px solid rgba(52, 211, 153, 0.45)'
                  : (selectedQualityPreset !== 'auto' && selectedQualityPreset !== 'original')
                    ? '1px solid rgba(6, 182, 212, 0.4)'
                    : '1px solid rgba(255, 255, 255, 0.12)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                transition: 'all 0.2s'
              }}
            >
              <Sliders size={14} />
              <span>{getQualityBadgeText()}</span>
              {actualResolution.height > 0 && (
                <span style={{
                  fontSize: '0.65rem',
                  padding: '0.05rem 0.35rem',
                  background: 'rgba(0,0,0,0.35)',
                  borderRadius: '3px',
                  opacity: 0.85
                }}>
                  {actualResolution.height}p
                </span>
              )}
            </button>

            {/* Quality Modal / Dropdown */}
            {isQualityMenuOpen && (
              <div 
                style={{
                  position: 'absolute',
                  bottom: '135%',
                  left: 0,
                  width: '320px',
                  maxWidth: '90vw',
                  background: 'rgba(11, 16, 29, 0.96)',
                  backdropFilter: 'blur(16px)',
                  border: '1px solid var(--border-glow)',
                  borderRadius: '12px',
                  padding: '0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 12px 36px rgba(0,0,0,0.85), 0 0 20px rgba(6,182,212,0.15)',
                  zIndex: 30,
                  direction: 'rtl'
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.86rem', color: '#fff' }}>
                    <Settings2 size={16} color="var(--accent-cyan)" />
                    <span>خيارات الجودة وموفر البيانات</span>
                  </div>
                  {actualResolution.height > 0 && (
                    <span style={{ fontSize: '0.7rem', background: 'rgba(6,182,212,0.15)', color: 'var(--accent-cyan-light)', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 700 }}>
                      {actualResolution.width} × {actualResolution.height}
                    </span>
                  )}
                </div>

                {/* Data Saver Mode Toggle Card */}
                <div 
                  onClick={toggleDataSaver}
                  role="button"
                  tabIndex={0}
                  style={{
                    padding: '0.6rem 0.7rem',
                    borderRadius: '8px',
                    background: dataSaverMode ? 'rgba(16, 185, 129, 0.16)' : 'rgba(255, 255, 255, 0.04)',
                    border: dataSaverMode ? '1px solid rgba(52, 211, 153, 0.45)' : '1px solid rgba(255, 255, 255, 0.08)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.75rem',
                    transition: 'all 0.15s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem' }}>
                    <WifiOff size={15} color={dataSaverMode ? '#34d399' : 'var(--text-muted)'} style={{ marginTop: '0.15rem', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: dataSaverMode ? '#34d399' : '#fff' }}>
                        وضع توفير البيانات (Data Saver)
                      </div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                        تقليل استهلاك الميغات ومنع التقطيع
                      </div>
                    </div>
                  </div>
                  <div style={{
                    width: '32px',
                    height: '18px',
                    borderRadius: '10px',
                    background: dataSaverMode ? '#10b981' : 'rgba(255,255,255,0.2)',
                    position: 'relative',
                    transition: 'all 0.2s',
                    flexShrink: 0
                  }}>
                    <div style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      background: '#fff',
                      position: 'absolute',
                      top: '3px',
                      left: dataSaverMode ? '17px' : '3px',
                      transition: 'all 0.2s'
                    }} />
                  </div>
                </div>

                {/* Available Qualities */}
                <div style={{ fontSize: '0.73rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                  جودات العرض (اختر الأنسب لسرعة اتصالك):
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {/* Auto */}
                  <button
                    type="button"
                    onClick={() => handleSelectPreset('auto')}
                    style={getPresetItemStyle(selectedQualityPreset === 'auto')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <Zap size={14} color={selectedQualityPreset === 'auto' ? 'var(--accent-cyan)' : 'var(--text-muted)'} />
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>تلقائي (Auto Adaptive)</div>
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>تكيف ذكي حسب سرعة الإنترنت تلقائياً</div>
                      </div>
                    </div>
                    {selectedQualityPreset === 'auto' && <Check size={14} color="var(--accent-cyan)" />}
                  </button>

                  {/* Original */}
                  <button
                    type="button"
                    onClick={() => handleSelectPreset('original')}
                    style={getPresetItemStyle(selectedQualityPreset === 'original')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <Sparkles size={14} color={selectedQualityPreset === 'original' ? '#ec4899' : 'var(--text-muted)'} />
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>جودة المصدر الأصلية (Full / Original)</div>
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>بث مباشر أصلي بأعلى وضوح ومعدل نقل</div>
                      </div>
                    </div>
                    {selectedQualityPreset === 'original' && <Check size={14} color="var(--accent-cyan)" />}
                  </button>

                  {/* Transcoded Presets (720p, 480p, 360p) */}
                  {serverPresets.map((preset) => {
                    const isSelected = selectedQualityPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectPreset(preset.id)}
                        style={getPresetItemStyle(isSelected)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                          <span style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '0.12rem 0.35rem',
                            borderRadius: '4px',
                            background: isSelected ? 'rgba(6,182,212,0.3)' : 'rgba(255,255,255,0.08)',
                            color: isSelected ? 'var(--accent-cyan-light)' : '#cbd5e1'
                          }}>
                            {preset.badge}
                          </span>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>{preset.label}</div>
                            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>{preset.sublabel}</div>
                          </div>
                        </div>
                        {isSelected && <Check size={14} color="var(--accent-cyan)" />}
                      </button>
                    );
                  })}
                </div>

                {/* Native Multi-bitrate HLS Levels */}
                {qualityLevels.length > 0 && (
                  <div style={{ marginTop: '0.65rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                      مستويات البث المدمجة من المصدر:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                      {qualityLevels.map(lvl => (
                        <button
                          key={lvl.index}
                          type="button"
                          onClick={() => handleSelectNativeLevel(lvl.index)}
                          className={`btn ${currentQualityIndex === lvl.index ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                        >
                          {lvl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sibling Channels with Alternative Qualities */}
                {siblingChannels.length > 0 && (
                  <div style={{ marginTop: '0.65rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                      قنوات بديلة بنفس الاسم بدقات أخرى:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '110px', overflowY: 'auto' }}>
                      {siblingChannels.map(sib => (
                        <button
                          key={sib.id}
                          type="button"
                          onClick={() => handleSelectSibling(sib)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.3rem 0.5rem',
                            borderRadius: '6px',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            cursor: 'pointer',
                            color: '#fff',
                            textAlign: 'right'
                          }}
                        >
                          <span style={{ fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>
                            {sib.name}
                          </span>
                          <span style={{
                            fontSize: '0.65rem',
                            padding: '0.1rem 0.35rem',
                            background: 'rgba(236,72,153,0.2)',
                            color: '#f472b6',
                            borderRadius: '4px',
                            fontWeight: 700
                          }}>
                            {sib.qualityTag}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Audio Tracks Selector Button (Multi-Audio Languages) */}
          {(audioTracks.length > 0 || isVOD) && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="btn-icon"
                onClick={() => {
                  setIsAudioMenuOpen(!isAudioMenuOpen);
                  setIsSubtitleMenuOpen(false);
                  setIsQualityMenuOpen(false);
                }}
                title="تغيير المسار الصوتي واللغة"
                aria-label="تغيير الصوت"
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  width: 'auto',
                  padding: '0.3rem 0.65rem',
                  borderRadius: 'var(--radius-full)',
                  background: selectedAudioTrackIndex !== null
                    ? 'rgba(168, 85, 247, 0.22)'
                    : 'rgba(255, 255, 255, 0.1)',
                  color: selectedAudioTrackIndex !== null
                    ? '#c084fc'
                    : '#fff',
                  border: selectedAudioTrackIndex !== null
                    ? '1px solid rgba(168, 85, 247, 0.45)'
                    : '1px solid rgba(255, 255, 255, 0.12)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  transition: 'all 0.2s'
                }}
              >
                <Languages size={14} />
                <span>الصوت</span>
                {audioTracks.length > 1 && (
                  <span style={{
                    fontSize: '0.65rem',
                    padding: '0.05rem 0.35rem',
                    background: 'rgba(0,0,0,0.35)',
                    borderRadius: '3px',
                    opacity: 0.9
                  }}>
                    {audioTracks.length}
                  </span>
                )}
              </button>

              {/* Audio Tracks Dropdown */}
              {isAudioMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '135%',
                    left: 0,
                    width: '260px',
                    maxWidth: '90vw',
                    background: 'rgba(11, 16, 29, 0.96)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid var(--border-glow)',
                    borderRadius: '12px',
                    padding: '0.85rem',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 12px 36px rgba(0,0,0,0.85), 0 0 20px rgba(168,85,247,0.15)',
                    zIndex: 35,
                    direction: 'rtl'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.86rem', color: '#fff' }}>
                      <Languages size={16} color="#c084fc" />
                      <span>المسارات واللغات الصوتية</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '200px', overflowY: 'auto' }}>
                    {audioTracks.length === 0 ? (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0.5rem', textAlign: 'center' }}>
                        لا توجد مسارات صوتية بديلة مكتشفة في هذا الملف
                      </div>
                    ) : (
                      audioTracks.map((track) => {
                        const isSelected = selectedAudioTrackIndex === track.index || selectedAudioTrackIndex === track.id;
                        return (
                          <button
                            key={track.index !== undefined ? track.index : track.id}
                            type="button"
                            onClick={() => handleSelectAudioTrack(track.index !== undefined ? track.index : track.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.5rem 0.65rem',
                              borderRadius: '8px',
                              background: isSelected ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.04)',
                              border: isSelected ? '1px solid #c084fc' : '1px solid rgba(255,255,255,0.06)',
                              color: isSelected ? '#fff' : 'var(--text-muted)',
                              cursor: 'pointer',
                              textAlign: 'right',
                              fontSize: '0.82rem',
                              fontWeight: isSelected ? 700 : 500
                            }}
                          >
                            <span>{track.label}</span>
                            {isSelected && <Check size={14} color="#c084fc" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Subtitles (الترجمة) Menu Button */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn-icon"
              onClick={() => {
                setIsSubtitleMenuOpen(!isSubtitleMenuOpen);
                setIsAudioMenuOpen(false);
                setIsQualityMenuOpen(false);
              }}
              title="خيارات الترجمة والبحث أونلاين"
              aria-label="خيارات الترجمة"
              style={{
                fontSize: '0.78rem',
                fontWeight: 700,
                width: 'auto',
                padding: '0.3rem 0.65rem',
                borderRadius: 'var(--radius-full)',
                background: selectedSubtitleId
                  ? 'rgba(245, 158, 11, 0.22)'
                  : 'rgba(255, 255, 255, 0.1)',
                color: selectedSubtitleId
                  ? '#fbbf24'
                  : '#fff',
                border: selectedSubtitleId
                  ? '1px solid rgba(245, 158, 11, 0.45)'
                  : '1px solid rgba(255, 255, 255, 0.12)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                transition: 'all 0.2s'
              }}
            >
              <Subtitles size={14} />
              <span>الترجمة</span>
              {selectedSubtitleId && (
                <span style={{
                  fontSize: '0.65rem',
                  padding: '0.05rem 0.35rem',
                  background: 'rgba(0,0,0,0.35)',
                  borderRadius: '3px',
                  opacity: 0.9
                }}>
                  ON
                </span>
              )}
            </button>

            {/* Subtitles Dropdown Menu */}
            {isSubtitleMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '135%',
                  left: 0,
                  width: '300px',
                  maxWidth: '90vw',
                  background: 'rgba(11, 16, 29, 0.96)',
                  backdropFilter: 'blur(16px)',
                  border: '1px solid var(--border-glow)',
                  borderRadius: '12px',
                  padding: '0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 12px 36px rgba(0,0,0,0.85), 0 0 20px rgba(245,158,11,0.15)',
                  zIndex: 35,
                  direction: 'rtl'
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem', paddingBottom: '0.4rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.86rem', color: '#fff' }}>
                    <Subtitles size={16} color="#fbbf24" />
                    <span>خيارات ومصادر الترجمة</span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '220px', overflowY: 'auto' }}>
                  {/* Off Option */}
                  <button
                    type="button"
                    onClick={() => {
                      applySubtitle(null);
                      setIsSubtitleMenuOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.45rem 0.65rem',
                      borderRadius: '8px',
                      background: selectedSubtitleId === null ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.04)',
                      border: selectedSubtitleId === null ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255,255,255,0.06)',
                      color: selectedSubtitleId === null ? '#f87171' : 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: selectedSubtitleId === null ? 700 : 500
                    }}
                  >
                    <span>إيقاف الترجمة (Off)</span>
                    {selectedSubtitleId === null && <Check size={14} color="#f87171" />}
                  </button>

                  {/* Embedded Subtitle Tracks */}
                  {subtitleTracks.length > 0 && (
                    <div style={{ marginTop: '0.4rem' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                        الترجمات المدمجة بالحلقة (Embedded):
                      </div>
                      {subtitleTracks.map((sub) => {
                        const isSelected = selectedSubtitleId === `embedded-${sub.index}`;
                        return (
                          <button
                            key={sub.index}
                            type="button"
                            onClick={() => {
                              applySubtitle({
                                id: `embedded-${sub.index}`,
                                label: sub.label,
                                langCode: sub.language,
                                vttUrl: sub.vttUrl
                              });
                              setIsSubtitleMenuOpen(false);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              width: '100%',
                              padding: '0.45rem 0.65rem',
                              borderRadius: '8px',
                              background: isSelected ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.04)',
                              border: isSelected ? '1px solid #fbbf24' : '1px solid rgba(255,255,255,0.06)',
                              color: isSelected ? '#fff' : 'var(--text-muted)',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              marginBottom: '0.25rem',
                              fontWeight: isSelected ? 700 : 500
                            }}
                          >
                            <span>{sub.label}</span>
                            {isSelected && <Check size={14} color="#fbbf24" />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Custom / Uploaded / Online Subtitles */}
                  {customSubtitles.length > 0 && (
                    <div style={{ marginTop: '0.4rem' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                        الترجمات المضافة:
                      </div>
                      {customSubtitles.map((sub) => {
                        const isSelected = selectedSubtitleId === sub.id;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => {
                              applySubtitle(sub);
                              setIsSubtitleMenuOpen(false);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              width: '100%',
                              padding: '0.45rem 0.65rem',
                              borderRadius: '8px',
                              background: isSelected ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.04)',
                              border: isSelected ? '1px solid #fbbf24' : '1px solid rgba(255,255,255,0.06)',
                              color: isSelected ? '#fff' : 'var(--text-muted)',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              marginBottom: '0.25rem',
                              fontWeight: isSelected ? 700 : 500
                            }}
                          >
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' }}>
                              {sub.label}
                            </span>
                            {isSelected && <Check size={14} color="#fbbf24" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Subtitle Action Buttons */}
                <div style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {/* Upload from Local Device */}
                  <button
                    type="button"
                    onClick={() => subtitleFileInputRef.current?.click()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.45rem 0.65rem',
                      borderRadius: '8px',
                      background: 'rgba(6, 182, 212, 0.12)',
                      border: '1px solid rgba(6, 182, 212, 0.3)',
                      color: 'var(--accent-cyan-light)',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      fontWeight: 600
                    }}
                  >
                    <Upload size={14} />
                    <span>+ إضافة ملف ترجمة من جهازك (.srt / .vtt)</span>
                  </button>

                  {/* Search Online */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsSubtitleMenuOpen(false);
                      setIsSubtitleSearchModalOpen(true);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.45rem 0.65rem',
                      borderRadius: '8px',
                      background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(217, 119, 6, 0.2))',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      color: '#fbbf24',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      fontWeight: 600
                    }}
                  >
                    <Search size={14} />
                    <span>🔍 بحث عن ترجمة أونلاين (Subsource / OpenSubtitles)</span>
                  </button>
                </div>

                {/* Subtitle Sync Timing Adjuster */}
                {selectedSubtitleId && (
                  <div style={{ marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.74rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>توقيت الترجمة:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <button
                        type="button"
                        onClick={() => handleAdjustSubtitleDelay(-0.5)}
                        style={{ padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.72rem' }}
                      >
                        -0.5s
                      </button>
                      <span style={{ fontWeight: 700, color: '#fbbf24', minWidth: '35px', textAlign: 'center' }}>
                        {subtitleDelay > 0 ? `+${subtitleDelay}` : subtitleDelay}s
                      </span>
                      <button
                        type="button"
                        onClick={() => handleAdjustSubtitleDelay(+0.5)}
                        style={{ padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.72rem' }}
                      >
                        +0.5s
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Picture-in-Picture Button */}
          {isPipSupported && (
            <button
              type="button"
              className="btn-icon"
              onClick={togglePictureInPicture}
              title="صورة داخل صورة (Picture-in-Picture)"
              aria-label="صورة داخل صورة"
            >
              <Airplay size={18} />
            </button>
          )}

          {/* Fullscreen Button */}
          <button 
            type="button" 
            className="btn-icon" 
            onClick={toggleFullscreen}
            title="ملء الشاشة (F)"
            aria-label="ملء الشاشة"
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>
      </div>
    </div>

    {/* Hidden Local Subtitle File Input */}
    <input
      type="file"
      ref={subtitleFileInputRef}
      style={{ display: 'none' }}
      accept=".srt,.vtt"
      onChange={handleUploadSubtitle}
    />

    {/* Online Subtitle Search Modal */}
    <SubtitleSearchModal
      isOpen={isSubtitleSearchModalOpen}
      onClose={() => setIsSubtitleSearchModalOpen(false)}
      initialQuery={channel?.name || ''}
      onApplySubtitle={(sub) => {
        setCustomSubtitles(prev => [...prev, sub]);
        applySubtitle(sub);
      }}
    />
  </div>
  );
}

export default VideoPlayer;
