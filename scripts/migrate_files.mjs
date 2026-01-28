import { createClient } from '@supabase/supabase-js';
import pLimit from 'p-limit'; // npm install p-limit

// ===== КОНФИГУРАЦИЯ =====
const SOURCE = {
  url: 'https://hgolrkxfyucoohsvnkxo.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhnb2xya3hmeXVjb29oc3Zua3hvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0ODg1NDUzMCwiZXhwIjoyMDY0NDMwNTMwfQ.q44Ze20EwQ7I-3PbvXhkYu_AXm5ngfhdbJxLdoTH458', // Service Role Key обязателен
  buckets: ['test9bucket_photo', 'test10public_preview', 'test8public']
};

const TARGET = {
  url: 'https://hkpyhgouhgspopowwkcj.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrcHloZ291aGdzcG9wb3d3a2NqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTUzOTk3NywiZXhwIjoyMDgxMTE1OTc3fQ.x7j7DCMSMi0uBh-HcHQZOlzsKnw9SklFQ6woxwQnx4s',
  bucket: 'creatives',
  table: 'ads'
};

const limit = pLimit(10); // Лимит одновременных загрузок
const sourceClient = createClient(SOURCE.url, SOURCE.key);
const targetClient = createClient(TARGET.url, TARGET.key);

/**
 * Хелпер для получения всех файлов из бакета (с поддержкой папок)
 */
async function listAllFiles(client, bucket) {
  const allFiles = [];
  async function scan(folder = '') {
    const { data, error } = await client.storage.from(bucket).list(folder, { limit: 1000 });
    if (error) return;
    for (const item of data) {
      if (item.id === null) await scan(`${folder}${item.name}/`); // Рекурсия для папок
      else allFiles.push(`${folder}${item.name}`);
    }
  }
  await scan();
  return allFiles;
}

async function migrate() {
  console.log('🚀 Запуск миграции медиа-файлов...');

  // 1. Кешируем бизнесы (Slug нужен для формирования пути)
  const { data: bizData } = await targetClient.from('businesses').select('id, slug');
  const bizMap = new Map(bizData.map(b => [b.id, b.slug]));

  // 2. Индексируем исходные бакеты (где что лежит)
  console.log('🔍 Индексация старых бакетов...');
  const sourceFileMap = new Map(); // ad_archive_id -> Array<{bucket, path, isVideo}>

  for (const bucket of SOURCE.buckets) {
    const files = await listAllFiles(sourceClient, bucket);
    files.forEach(filePath => {
      const fileName = filePath.split('/').pop();
      const idMatch = fileName.match(/\d+/); // Ищем цифры ID в названии файла
      if (idMatch) {
        const id = idMatch[0];
        if (!sourceFileMap.has(id)) sourceFileMap.set(id, []);
        sourceFileMap.get(id).push({
          bucket,
          path: filePath,
          isVideo: /\.(mp4|mov|webm|avi|mkv)$/i.test(fileName),
          ext: fileName.split('.').pop()
        });
      }
    });
  }

  // 3. Получаем список объявлений, требующих проверки
  const { data: ads } = await targetClient
    .from(TARGET.table)
    .select('ad_archive_id, business_id, storage_path, video_storage_path');

  console.log(`📊 Обработка ${ads.length} объявлений...`);

  const tasks = ads.map(ad => limit(async () => {
    const slug = bizMap.get(ad.business_id);
    if (!slug || !ad.ad_archive_id) return;

    const sourceFiles = sourceFileMap.get(ad.ad_archive_id) || [];
    const updateData = {};

    for (const file of sourceFiles) {
      // Решаем, в какую колонку писать
      const dbColumn = file.isVideo ? 'video_storage_path' : 'storage_path';
      
      // Если в БД путь уже есть — пропускаем (или удалите проверку, если нужно перезаписать)
      if (ad[dbColumn]) continue;

      const targetPath = `${slug}/${ad.ad_archive_id}.${file.ext}`;

      try {
        // 1. Скачиваем из источника
        const { data: fileBlob, error: dlErr } = await sourceClient.storage
          .from(file.bucket)
          .download(file.path);

        if (dlErr) throw dlErr;

        // 2. Загружаем в новый бакет (creatives)
        const { error: upErr } = await targetClient.storage
          .from(TARGET.bucket)
          .upload(targetPath, fileBlob, {
            contentType: file.isVideo ? `video/${file.ext}` : `image/${file.ext}`,
            upsert: true
          });

        if (upErr) throw upErr;

        // 3. Запоминаем путь для обновления БД
        updateData[dbColumn] = targetPath;
        console.log(`✅ [${ad.ad_archive_id}] Перенесено: ${targetPath}`);

      } catch (err) {
        console.error(`❌ Ошибка переноса ${ad.ad_archive_id}: ${err.message}`);
      }
    }

    // 4. Обновляем БД (одним запросом для обоих путей)
    if (Object.keys(updateData).length > 0) {
      const { error: dbErr } = await targetClient
        .from(TARGET.table)
        .update(updateData)
        .eq('ad_archive_id', ad.ad_archive_id);
      
      if (dbErr) console.error(`❌ Ошибка БД для ${ad.ad_archive_id}:`, dbErr.message);
    }
  }));

  await Promise.all(tasks);
  console.log('🏁 Миграция завершена успешно!');
}

migrate();