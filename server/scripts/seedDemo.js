import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { encrypt } from '../services/cryptoService.js';
import { logAudit } from '../services/auditService.js';

export function seedDemoData() {
  console.log('--- جاري تجهيز البيانات التجريبية المصرحة والمجانية ---');

  const now = new Date().toISOString();

  // 1. Create a Demo M3U Source
  const m3uSourceId = uuidv4();
  db.prepare(`
    INSERT OR REPLACE INTO stream_sources (
      id, name, type, endpoint, credentials_encrypted, is_active,
      last_checked_at, last_checked_status, last_checked_message,
      last_sync_at, last_sync_status, imported_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, 1, ?, 'ok', 'بثوث تجريبية عامة مفتوحة المصدر', ?, 'success', 4, ?, ?)
  `).run(
    m3uSourceId,
    'مصدر تجريبي (بثوث مفتوحة المصدر ومصرحة)',
    'm3u',
    'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/open_demo.m3u',
    now,
    now,
    now,
    now
  );

  // 2. Sample Legal, Royalty-free Public HLS Streams
  // (Blender open projects, NASA public educational live/test streams, Akamai test streams)
  const demoChannels = [
    {
      id: uuidv4(),
      sourceId: m3uSourceId,
      externalId: 'demo-bbb-hls',
      name: 'قناة Big Buck Bunny (بث تجريبي)',
      description: 'بث تجريبي قانوني عالي الدقة مفتوح المصدر برخصة المشاع الإبداعي (Blender Foundation).',
      logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/320px-Big_buck_bunny_poster_big.jpg',
      category: 'ترفيه وتجارب',
      streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      backupStreamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      isActive: 1,
      sortOrder: 1
    },
    {
      id: uuidv4(),
      sourceId: m3uSourceId,
      externalId: 'demo-tos-hls',
      name: 'قناة Tears of Steel (خيال علمي مفتوح)',
      description: 'فيلم خيال علمي مفتوح المصدر تم إنتاجه بواسطة Blender Institute لأغراض اختبار جودة البث HLS.',
      logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Tears_of_Steel_poster.jpg/320px-Tears_of_Steel_poster.jpg',
      category: 'ترفيه وتجارب',
      streamUrl: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
      backupStreamUrl: '',
      isActive: 1,
      sortOrder: 2
    },
    {
      id: uuidv4(),
      sourceId: m3uSourceId,
      externalId: 'demo-sintel-hls',
      name: 'قناة Sintel (رسوم متحركة)',
      description: 'بث رسوم متحركة تجريبي مجاني مفتوح الحقوق لاختبار مشغل HLS على مختلف سرعات الإنترنت.',
      logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Sintel_poster.jpg/320px-Sintel_poster.jpg',
      category: 'أطفال ورسوم',
      streamUrl: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
      backupStreamUrl: '',
      isActive: 1,
      sortOrder: 3
    },
    {
      id: uuidv4(),
      sourceId: m3uSourceId,
      externalId: 'demo-nasa-public',
      name: 'قناة علوم وفضاء (بث تجريبي تعليمي)',
      description: 'بث تجريبي تعليمي عام لمحاكاة وتجارب البث الفضائي.',
      logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/300px-NASA_logo.svg.png',
      category: 'وثائقي وعلوم',
      streamUrl: 'https://test-streams.mux.dev/test_001/stream.m3u8',
      backupStreamUrl: '',
      isActive: 1,
      sortOrder: 4
    },
    {
      id: uuidv4(),
      sourceId: m3uSourceId,
      externalId: 'demo-agent327-hls',
      name: 'قناة عميل 327 (مغامرات ورسوم)',
      description: 'بث تجريبي لمشروع رسوم ثلاثية الأبعاد مفتوحة المصدر لاختبار نقاء الصوت والصورة في HLS.',
      logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Agent_327_Barbershop_Poster.jpg/320px-Agent_327_Barbershop_Poster.jpg',
      category: 'أفلام وخيال',
      streamUrl: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
      backupStreamUrl: '',
      isActive: 1,
      sortOrder: 5
    },
    {
      id: uuidv4(),
      sourceId: m3uSourceId,
      externalId: 'demo-cosmos-hls',
      name: 'قناة كوزموس (فنون بصرية)',
      description: 'بث تجريبي لاختبار أداء أجهزة التلفاز والمتصفحات مع جودات البث المتعددة.',
      logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Cosmos_Laundromat_Poster.jpg/320px-Cosmos_Laundromat_Poster.jpg',
      category: 'ترفيه وتجارب',
      streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      backupStreamUrl: '',
      isActive: 1,
      sortOrder: 6
    }
  ];

  const insertChannel = db.prepare(`
    INSERT OR REPLACE INTO channels (
      id, source_id, external_id, name, description, logo_url, category,
      playback_ref, backup_playback_ref, use_backup, is_active, sort_order,
      last_checked_at, last_checked_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'ok', ?, ?)
  `);

  for (const ch of demoChannels) {
    insertChannel.run(
      ch.id,
      ch.sourceId,
      ch.externalId,
      ch.name,
      ch.description,
      ch.logoUrl,
      ch.category,
      encrypt(ch.streamUrl),
      ch.backupStreamUrl ? encrypt(ch.backupStreamUrl) : null,
      ch.isActive,
      ch.sortOrder,
      now,
      now,
      now
    );
  }

  logAudit({
    adminUsername: 'النظام',
    action: 'SEED_DEMO_DATA',
    details: { message: 'تم إدراج بيانات وقنوات تجريبية قانونية مفتوحة المصدر' }
  });

  console.log(`✅ تم إدراج مصدر تجريبي و ${demoChannels.length} قنوات تجريبية مصرحة بنجاح!`);
}

// Run directly if invoked from CLI
if (process.argv[1]?.endsWith('seedDemo.js')) {
  seedDemoData();
}
