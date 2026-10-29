import { safeFetch } from './ssrfService.js';

function normalizePortalUrl(endpoint) {
  if (!endpoint) throw new Error('عنوان Portal مطلوب');
  let clean = endpoint.trim().replace(/\/+$/, '');
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = 'http://' + clean;
  }
  return clean;
}

/**
 * Test Stalker Portal connection using authorized official Ministra / Stalker API handshake.
 */
export async function testStalkerConnection(endpoint, credentials = {}) {
  const baseUrl = normalizePortalUrl(endpoint);
  
  // Standard Ministra / Stalker API endpoint path
  let loadPhpUrl = `${baseUrl}/server/load.php?type=stb&action=handshake&JsHttpRequest=1-xml`;
  if (baseUrl.includes('/server/load.php')) {
    loadPhpUrl = `${baseUrl}?type=stb&action=handshake&JsHttpRequest=1-xml`;
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
  };

  if (credentials.token) {
    headers['Authorization'] = `Bearer ${credentials.token}`;
  }
  if (credentials.mac) {
    headers['Cookie'] = `mac=${encodeURIComponent(credentials.mac)}`;
  }

  try {
    const res = await safeFetch(loadPhpUrl, { headers, timeoutMs: 8000 });
    
    // Check if provider blocked access or requires proprietary bypass
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error: 'رفض مزود Stalker Portal المصادقة (401/403). يلزم التحقق من تسجيل الجهاز لدى المزود أو الحصول على رمز ترخيص رسمي.'
      };
    }

    const contentType = res.headers.get('content-type') || '';
    const bodyText = await res.text();

    // If server returned an HTML error page or cloudflare/anti-bot protection
    if (contentType.includes('text/html') && bodyText.toLowerCase().includes('cloudflare')) {
      return {
        ok: false,
        error: 'البوابة محمية بنظام كشف التصفح. يلزم واجهة API رسمية ومصرحة من المزود.'
      };
    }

    let parsedData = null;
    try {
      parsedData = JSON.parse(bodyText);
    } catch {
      // Not JSON, check for standard stalker response
    }

    if (parsedData && (parsedData.js || parsedData.data)) {
      return {
        ok: true,
        info: {
          handshake: 'ناجح',
          tokenRequired: !credentials.token,
          portalType: 'Ministra / Stalker API'
        }
      };
    }

    // If response was ok but not standard JSON
    if (res.ok) {
      return {
        ok: true,
        info: {
          handshake: 'تم التحقق من الوصول للبوابة',
          status: 'متصل'
        }
      };
    }

    return {
      ok: false,
      error: `استجاب خادم Portal برمز خطأ (${res.status} ${res.statusText})`
    };
  } catch (err) {
    return {
      ok: false,
      error: `فشل الاتصال ببوابة Stalker: ${err.message}`
    };
  }
}

/**
 * Fetch ITV channels from authorized Stalker Portal.
 */
export async function fetchStalkerChannels(endpoint, credentials = {}) {
  const baseUrl = normalizePortalUrl(endpoint);
  
  let itvUrl = `${baseUrl}/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
  if (baseUrl.includes('/server/load.php')) {
    itvUrl = `${baseUrl}?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
  };

  if (credentials.token) {
    headers['Authorization'] = `Bearer ${credentials.token}`;
  }
  if (credentials.mac) {
    headers['Cookie'] = `mac=${encodeURIComponent(credentials.mac)}`;
  }

  const res = await safeFetch(itvUrl, { headers, timeoutMs: 15000 });
  if (!res.ok) {
    throw new Error(`تعذر استيراد قنوات Stalker: استجاب الخادم برمز (${res.status})`);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('استجابة بوابة Stalker غير مفهومة أو تتطلب ترخيص API رسمي من المزود');
  }

  const items = data.js?.data || data.data || [];
  if (!Array.isArray(items)) {
    throw new Error('لا توجد قنوات متاحة أو تحتاج البوابة إلى تحديث جلسة المصادقة');
  }

  return items.map(ch => ({
    externalId: String(ch.id || ch.ch_id || ch.number),
    name: String(ch.name || `قناة ${ch.number || ''}`).trim(),
    category: ch.genres_str || ch.tv_genre_id || 'عام',
    logoUrl: ch.logo ? `${baseUrl}/` + ch.logo.replace(/^\/+/, '') : '',
    streamUrl: ch.cmd ? String(ch.cmd).replace(/^ffmpeg /, '').replace(/^auto /, '').trim() : '',
    description: `Stalker Channel #${ch.number || ch.id}`
  }));
}
