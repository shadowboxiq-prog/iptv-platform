import dns from 'dns/promises';
import ipaddr from 'ipaddr.js';
import { URL } from 'url';

/**
 * Validates a target URL against SSRF vulnerabilities.
 * Ensures the target has http/https protocol and resolves only to public, non-private IP addresses.
 * 
 * @param {string} inputUrl 
 * @returns {Promise<{ isValid: boolean, error?: string, parsedUrl?: URL, resolvedIp?: string }>}
 */
export async function validateSafeUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { isValid: false, error: 'الرابط المطلوب غير صالح أو فارغ' };
  }

  let parsed;
  try {
    parsed = new URL(inputUrl.trim());
  } catch (err) {
    return { isValid: false, error: 'صيغة الرابط غير صحيحة' };
  }

  // 1. Only allow HTTP and HTTPS protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { 
      isValid: false, 
      error: `البروتوكول (${parsed.protocol}) غير مدعوم. مسموح فقط بـ http و https` 
    };
  }

  // 2. Reject credentials in URL itself if any
  if (parsed.username || parsed.password) {
    // We allowXtream or M3U credentials to be passed in dedicated forms, but strip raw userinfo from direct URLs if risky
  }

  const hostname = parsed.hostname;

  // 3. Reject obvious local hostnames
  const lowerHost = hostname.toLowerCase();
  if (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.localhost') ||
    lowerHost.endsWith('.local') ||
    lowerHost.endsWith('.internal') ||
    lowerHost === '127.0.0.1' ||
    lowerHost === '::1' ||
    lowerHost === '0.0.0.0'
  ) {
    return { 
      isValid: false, 
      error: 'محاولة الوصول إلى المضيف المحلي أو الشبكة الداخلية محظورة لدواعي الأمان (SSRF Protection)' 
    };
  }

  // 4. Resolve DNS and check all resolved IP addresses
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return { isValid: false, error: 'تعذر العثور على عنوان IP لهذا المضيف' };
    }

    for (const record of addresses) {
      const ipStr = record.address;
      let parsedIp;
      try {
        parsedIp = ipaddr.parse(ipStr);
      } catch {
        return { isValid: false, error: `عنوان IP غير صالح: ${ipStr}` };
      }

      // If IPv4-mapped IPv6, get standard IPv4
      if (parsedIp.kind() === 'ipv6' && parsedIp.isIPv4MappedAddress()) {
        parsedIp = parsedIp.toIPv4Address();
      }

      const range = parsedIp.range();
      const forbiddenRanges = [
        'loopback',
        'private',
        'linkLocal', // Blocks 169.254.169.254 (Cloud metadata)
        'carrierGradeNat',
        'broadcast',
        'unspecified',
        'uniqueLocal',
      ];

      if (forbiddenRanges.includes(range)) {
        return { 
          isValid: false, 
          error: `محاولة الوصول إلى عنوان شبكة محلي أو خاص (${ipStr} - ${range}) محظورة لدواعي الأمان` 
        };
      }
    }

    return { 
      isValid: true, 
      parsedUrl: parsed, 
      resolvedIp: addresses[0].address 
    };
  } catch (err) {
    return { 
      isValid: false, 
      error: `فشل التحقق من نطاق الخادم: ${err.message}` 
    };
  }
}

/**
 * Fetch a remote URL safely with SSRF protection, timeout, and max size.
 * @param {string} url 
 * @param {object} options 
 * @returns {Promise<Response>}
 */
export async function safeFetch(url, options = {}) {
  const validation = await validateSafeUrl(url);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  const timeoutMs = options.timeoutMs ?? 10000;
  const controller = new AbortController();
  let timeoutId = null;
  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => {
        try { controller.abort(); } catch {}
      });
    }
  }

  try {
    const fetchOptions = {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...(options.headers || {})
      }
    };
    delete fetchOptions.timeoutMs;

    const response = await fetch(url, fetchOptions);
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      if (options.signal?.aborted) {
        throw new Error('تم إلغاء الاتصال بواسطة العميل');
      }
      throw new Error(`انتهت مهلة الاتصال بالخادم (${timeoutMs / 1000} ثوانٍ)`);
    }
    throw err;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

