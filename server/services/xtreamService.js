import { safeFetch } from './ssrfService.js';

function normalizeUrl(endpoint) {
  if (!endpoint) throw new Error('عنوان خادم Xtream مطلوب');
  let clean = endpoint.trim().replace(/\/+$/, '');
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = 'http://' + clean;
  }
  return clean;
}

/**
 * Test Xtream connection and retrieve basic server/user profile.
 */
export async function testXtreamConnection(endpoint, username, password) {
  const baseUrl = normalizeUrl(endpoint);
  const targetUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

  try {
    const res = await safeFetch(targetUrl, { timeoutMs: 8000 });
    if (!res.ok) {
      return { 
        ok: false, 
        error: `استجاب خادم المزود برمز خطأ (${res.status} ${res.statusText})` 
      };
    }

    const data = await res.json();
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'استجابة المزود ليست بصيغة Xtream API المعروفة' };
    }

    if (data.user_info) {
      if (data.user_info.auth === 0) {
        return { ok: false, error: 'بيانات الدخول غير صحيحة أو تم رفض المصادقة من المزود' };
      }
      if (data.user_info.status && data.user_info.status.toLowerCase() !== 'active') {
        return { 
          ok: false, 
          error: `حساب المزود غير نشط (الحالة: ${data.user_info.status})` 
        };
      }

      // Safe metadata without sensitive keys
      const info = {
        status: data.user_info.status || 'Active',
        expDate: data.user_info.exp_date ? new Date(parseInt(data.user_info.exp_date, 10) * 1000).toISOString() : null,
        activeCons: data.user_info.active_cons || 0,
        maxCons: data.user_info.max_connections || 'غير محدد',
        serverTime: data.server_info?.time_now || null
      };

      return { ok: true, info };
    }

    return { ok: false, error: 'استجابة خادم Xtream لا تتضمن معلومات المستخدم المطلوبة' };
  } catch (err) {
    return { ok: false, error: `فشل الاتصال بخادم Xtream: ${err.message}` };
  }
}

/**
 * Fetch categories and live channels from Xtream Codes provider.
 */
export async function fetchXtreamChannels(endpoint, username, password) {
  const baseUrl = normalizeUrl(endpoint);

  // 1. Fetch Categories
  const catUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_categories`;
  const catMap = new Map();

  try {
    const catRes = await safeFetch(catUrl, { timeoutMs: 12000 });
    if (catRes.ok) {
      const categories = await catRes.json();
      if (Array.isArray(categories)) {
        for (const cat of categories) {
          if (cat.category_id && cat.category_name) {
            catMap.set(String(cat.category_id), String(cat.category_name).trim());
          }
        }
      }
    }
  } catch (err) {
    console.warn('Could not fetch Xtream categories, continuing with default categories:', err.message);
  }

  // 2. Fetch Live Streams
  const streamsUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
  const streamsRes = await safeFetch(streamsUrl, { timeoutMs: 20000 });

  if (!streamsRes.ok) {
    throw new Error(`فشل جلب قنوات Xtream (${streamsRes.status} ${streamsRes.statusText})`);
  }

  const streams = await streamsRes.json();
  if (!Array.isArray(streams)) {
    throw new Error('قائمة قنوات Xtream غير صالحة أو غير متوفرة');
  }

  const channels = streams.map(item => {
    const categoryName = item.category_id ? (catMap.get(String(item.category_id)) || 'عام') : 'عام';
    const streamId = String(item.stream_id || item.num || '');
    
    // Construct authorized upstream stream URL (will be encrypted on storage)
    const streamUrl = `${baseUrl}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.m3u8`;

    return {
      externalId: streamId,
      name: String(item.name || `قناة ${streamId}`).trim(),
      category: categoryName,
      logoUrl: item.stream_icon ? String(item.stream_icon).trim() : '',
      streamUrl,
      description: `Xtream Live Stream #${streamId}`
    };
  });

  return channels;
}
