import multer from 'multer';
import path from 'path';
import { config } from '../config/index.js';

// Memory storage is safest and ensures zero lingering files on disk
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.m3u', '.m3u8', '.txt'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('نوع الملف غير مدعوم. مسموح فقط بملفات .m3u و .m3u8 و .txt'));
  }
};

export const m3uUpload = multer({
  storage,
  limits: {
    fileSize: config.maxUploadSizeBytes
  },
  fileFilter
});
