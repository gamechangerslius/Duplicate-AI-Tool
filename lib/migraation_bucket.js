import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- CONFIGURATION ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

const {
  NEXT_PUBLIC_SUPABASE_URL: URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY
} = process.env;

const supabase = createClient(URL, SERVICE_KEY || ANON_KEY);
const BUCKETS = [
  { old: 'blinkist2', business: 'blinkist' },
  { old: 'test2', business: 'holywater' },
];
const NEW_BUCKET = 'creatives';
const CONCURRENCY_LIMIT = 5; 

// --- UTILS ---

async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
}

/**
 * Рекурсивно получает список ВСЕХ файлов, игнорируя папку 'ads'
 */
async function getAllFiles(bucket, dir = '') {
  let files = [];
  let offset = 0;
  const limit = 1000;

  console.log(`  🔍 Сканирую директорию: ${dir || 'root'}...`);

  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(dir, { limit, offset, sortBy: { column: 'name', order: 'asc' } });

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const item of data) {
      // КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: Игнорируем всё, что называется 'ads'
      if (item.name === 'ads') {
        console.log(`  🚫 Игнорирую содержимое папки/файла: ${dir ? dir + '/' : ''}${item.name}`);
        continue;
      }

      const fullPath = dir ? `${dir}/${item.name}` : item.name;
      
      if (item.name === '.emptyKeep') continue;

      if (!item.id) { 
        // Если это папка, идем глубже
        const subDirFiles = await getAllFiles(bucket, fullPath);
        files.push(...subDirFiles);
      } else {
        files.push({ ...item, fullPath });
      }
    }

    if (data.length < limit) break;
    offset += limit;
  }
  return files;
}

// --- CORE LOGIC ---

async function migrateFile(oldBucket, fileInfo, business) {
  const ext = path.extname(fileInfo.name);
  const basename = path.basename(fileInfo.name, ext);
  const newPath = `${business}/${basename}${ext}`;

  try {
    // 1. Скачивание
    const { data: blob, error: dlError } = await retryWithBackoff(() => 
      supabase.storage.from(oldBucket).download(fileInfo.fullPath)
    );
    if (dlError) throw new Error(`Download error: ${dlError.message}`);

    // 2. Загрузка
    const { error: upError } = await retryWithBackoff(() =>
      supabase.storage.from(NEW_BUCKET).upload(newPath, blob, {
        upsert: true,
        contentType: fileInfo.metadata?.mimetype || 'image/png'
      })
    );
    if (upError) throw new Error(`Upload error: ${upError.message}`);

    process.stdout.write('.'); 
    return { success: true };
  } catch (err) {
    console.log(`\n  ❌ Ошибка файла ${fileInfo.fullPath}: ${err.message}`);
    return { success: false };
  }
}

async function migrateBucket({ old, business }) {
  console.log(`\n📦 Подготовка миграции: ${old} -> ${NEW_BUCKET}/${business}`);

  try {
    const allFiles = await getAllFiles(old);
    console.log(`✅ Список готов: ${allFiles.length} файлов пойдут в перенос.`);

    let successCount = 0;
    let errorCount = 0;

    console.log(`\n🚀 Перенос пошел (по ${CONCURRENCY_LIMIT} одновременно)...`);

    for (let i = 0; i < allFiles.length; i += CONCURRENCY_LIMIT) {
      const batch = allFiles.slice(i, i + CONCURRENCY_LIMIT);
      
      const results = await Promise.all(
        batch.map(file => migrateFile(old, file, business))
      );
      
      successCount += results.filter(r => r.success).length;
      errorCount += results.filter(r => !r.success).length;

      const progress = Math.min(i + CONCURRENCY_LIMIT, allFiles.length);
      if (progress % 20 === 0 || progress === allFiles.length) {
        console.log(`\n📊 Статус: ${progress}/${allFiles.length} (ОК: ${successCount}, Ошибок: ${errorCount})`);
      }
    }

    console.log(`\n🏁 Бакет ${old} обработан.`);
  } catch (err) {
    console.error(`\n💥 Ошибка в бакете ${old}:`, err.message);
  }
}

async function main() {
  console.log('--- СТАРТ РАБОТЫ ---');
  
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error('❌ Проблема с ключами доступа в .env.local');
    process.exit(1);
  }

  for (const bucket of BUCKETS) {
    await migrateBucket(bucket);
  }

  console.log('\n✨ Все операции завершены!');
}

main().catch(console.error);