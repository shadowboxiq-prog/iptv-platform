import crypto from 'crypto';

/**
 * Sanitize plain text string to prevent XSS / control character injection.
 */
function sanitizeString(str) {
  if (!str) return '';
  return String(str)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script blocks and content
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove style blocks
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
    .replace(/<[^>]*>/g, '') // Strip remaining HTML tags
    .trim();
}

/**
 * Generate a deterministic ID based on channel attributes when external id is missing.
 */
function generateDeterministicId(name, streamUrl) {
  return crypto.createHash('sha256')
    .update(`${name.toLowerCase().trim()}|${streamUrl.trim()}`)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Parse an M3U or M3U8 string content into structured channel objects.
 * 
 * @param {string} content 
 * @returns {{ channels: Array<{ externalId: string, name: string, category: string, logoUrl: string, streamUrl: string, description: string }>, warnings: string[] }}
 */
export function parseM3U(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('محتوى قائمة M3U غير صالح أو فارغ');
  }

  const lines = content.split(/\r?\n/);
  const channels = [];
  const warnings = [];

  // Check if starts with #EXTM3U or has #EXTINF lines
  let hasExtM3uHeader = false;
  let currentExtInf = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    if (rawLine.startsWith('#EXTM3U')) {
      hasExtM3uHeader = true;
      continue;
    }

    if (rawLine.startsWith('#EXTINF:')) {
      currentExtInf = rawLine;
      continue;
    }

    // Skip other comment lines
    if (rawLine.startsWith('#')) {
      continue;
    }

    // This line is presumably the stream URL
    if (currentExtInf) {
      const streamUrl = rawLine;

      // Extract attributes from #EXTINF line
      // Example: #EXTINF:-1 tvg-id="cnn.us" tvg-name="CNN" tvg-logo="http://..." group-title="News",CNN HD
      const tvgIdMatch = currentExtInf.match(/tvg-id="([^"]*)"/i);
      const tvgNameMatch = currentExtInf.match(/tvg-name="([^"]*)"/i);
      const tvgLogoMatch = currentExtInf.match(/tvg-logo="([^"]*)"/i);
      const groupTitleMatch = currentExtInf.match(/group-title="([^"]*)"/i);

      // Channel name is after the last comma
      const commaIndex = currentExtInf.lastIndexOf(',');
      let channelName = '';
      if (commaIndex !== -1) {
        channelName = currentExtInf.substring(commaIndex + 1).trim();
      }
      if (!channelName && tvgNameMatch) {
        channelName = tvgNameMatch[1].trim();
      }
      if (!channelName) {
        channelName = `قناة ${channels.length + 1}`;
      }

      channelName = sanitizeString(channelName);
      const category = sanitizeString(groupTitleMatch ? groupTitleMatch[1] : 'عام') || 'عام';
      const logoUrl = tvgLogoMatch ? sanitizeString(tvgLogoMatch[1]) : '';
      const rawExtId = tvgIdMatch ? tvgIdMatch[1].trim() : '';

      // Validate stream URL
      if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://')) {
        const externalId = rawExtId || generateDeterministicId(channelName, streamUrl);

        channels.push({
          externalId,
          name: channelName,
          category,
          logoUrl,
          streamUrl: streamUrl.trim(),
          description: `مستوردة من قائمة M3U (${category})`
        });
      } else {
        warnings.push(`تم تجاهل الرابط غير الصالح في السطر ${i + 1}`);
      }

      currentExtInf = null; // Reset for next channel
    }
  }

  if (channels.length === 0 && !hasExtM3uHeader) {
    throw new Error('الملف لا يحتوي على صيغة M3U/EXTINF صالحة');
  }

  return { channels, warnings };
}
