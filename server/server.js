import { createApp } from './app.js';
import { config } from './config/index.js';
import { db } from './db/index.js';
import { seedDemoData } from './scripts/seedDemo.js';

const app = createApp();

// Auto-seed demo data if channels table is empty
try {
  const channelCount = db.prepare('SELECT COUNT(*) as count FROM channels').get().count;
  if (channelCount === 0) {
    seedDemoData();
  }
} catch (err) {
  console.warn('Initial demo check error:', err.message);
}

app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`  🚀 منصة البث المباشر (IPTV Manager & Player) قيد العمل`);
  console.log(`  🌐 الرابط المحلي: http://localhost:${config.port}`);
  console.log(`  📱 رابط الشبكة المحلية: http://0.0.0.0:${config.port}`);
  console.log(`  🔒 حماية SSRF وتشفير AES-256-GCM مفعلة`);
  console.log(`======================================================\n`);
});

// Protect server process from abrupt client stream disconnects or undici parser abort assertions
process.on('uncaughtException', (err) => {
  if (
    err.code === 'ERR_ASSERTION' ||
    err.code === 'ECONNRESET' ||
    err.code === 'EPIPE' ||
    err.name === 'AbortError' ||
    err.message?.includes('assert(!this.paused)')
  ) {
    // Expected client disconnection during streaming or seeking
    return;
  }
  console.error('Uncaught server exception:', err);
});

process.on('unhandledRejection', (reason) => {
  if (
    reason?.name === 'AbortError' ||
    reason?.message?.includes('aborted') ||
    reason?.message?.includes('تم إلغاء')
  ) {
    return;
  }
  console.error('Unhandled server rejection:', reason);
});
