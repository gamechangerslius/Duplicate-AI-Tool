import { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isUserAdmin } from "@/utils/supabase/admin";
import { supabase } from "@/lib/supabase";
import ExcelJS from "exceljs";

export const maxDuration = 300;

interface ProgressMessage {
  type: 'progress' | 'complete' | 'error' | 'file-chunk';
  message: string;
  total?: number;
  current?: number;
  percentage?: number;
  filename?: string;
  chunk?: string;
  chunkIndex?: number;
  chunkTotal?: number;
}

function sendProgress(message: ProgressMessage): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

function getPublicStorageUrl(path: string | null | undefined) {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/creatives/${path}`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get('businessId') || undefined;
  const pageName = url.searchParams.get('pageName') || undefined;
  const startDate = url.searchParams.get('startDate') || undefined;
  const endDate = url.searchParams.get('endDate') || undefined;
  const displayFormat = url.searchParams.get('displayFormat') || undefined;
  // const aiDescription = url.searchParams.get('aiDescription') || undefined; // Фильтр отключен, так как поле в другой таблице
  const minDuplicates = url.searchParams.get('minDuplicates');
  const maxDuplicates = url.searchParams.get('maxDuplicates');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const supa = await createClient();
        const { data: { user } } = await supa.auth.getUser();
        if (!user) {
          controller.enqueue(encoder.encode(sendProgress({ type: 'error', message: 'Unauthorized' })));
          controller.close();
          return;
        }

        // Access control
        let hasAccess = false;
        const userIsAdmin = await isUserAdmin(user.id);
        if (userIsAdmin) hasAccess = true;
        if (!hasAccess && businessId) {
          const { data: biz } = await supa.from('businesses').select('id').eq('id', businessId).eq('owner_id', user.id).maybeSingle();
          hasAccess = !!biz;
        }
        if (!hasAccess) {
          controller.enqueue(encoder.encode(sendProgress({ type: 'error', message: 'No access to this business' })));
          controller.close();
          return;
        }
        if (!businessId) {
          controller.enqueue(encoder.encode(sendProgress({ type: 'error', message: 'Missing businessId' })));
          controller.close();
          return;
        }

        let allowedGroups: number[] | null = null;

        // 1. Filter by duplicates range (optimized)
        if (minDuplicates || maxDuplicates) {
          const minVal = Number(minDuplicates || '0');
          const maxVal = Number(maxDuplicates || '999999');
          const { data: groups, error: groupsError } = await supabase
            .from('ads_groups_test')
            .select('vector_group')
            .eq('business_id', businessId)
            .gte('items', minVal)
            .lte('items', maxVal);

          if (groupsError) throw groupsError;
          allowedGroups = (groups || []).map(g => Number(g.vector_group)).filter(n => Number.isFinite(n));
          
          if (!allowedGroups.length) {
            controller.enqueue(encoder.encode(sendProgress({ type: 'error', message: 'No data for selected range' })));
            controller.close();
            return;
          }
        }

        // --- OPTIMIZATION: Reduce batch size ---
        const batchSize = 200; 
        
        // --- OPTIMIZATION: Select specific columns only ---
        // Убрали 'items' и 'ai_description', так как они в ads_groups_test
        const selectedColumns = [
          'ad_archive_id', 'business_id', 'page_name', 'display_format', 
          'vector_group', 'created_at', 
          'start_date_formatted', 'end_date_formatted', 'title', 'text', 
          'concept', 'caption', 'link_url', 'publisher_platform', 
          'ad_library_url', 
          'storage_path', 'video_storage_path', 
        ].join(',');

        const buildAdsQuery = () => {
          let q = supabase
            .from('ads')
            .select(selectedColumns) 
            .eq('business_id', businessId);

          if (pageName) q = q.eq('page_name', pageName);
          if (displayFormat) q = q.eq('display_format', displayFormat);
          if (startDate) q = q.gte('start_date_formatted', startDate);
          if (endDate) q = q.lte('end_date_formatted', endDate);
          
          // ВАЖНО: Убрали фильтр aiDescription здесь, так как колонки нет в ads.
          // Если нужна фильтрация по описанию, её нужно делать на этапе выборки allowedGroups или пост-фильтрацией.
          
          return q.order('ad_archive_id', { ascending: true });
        };

        // 2. Get total count
        const buildCountQuery = () => {
          let q = supabase
            .from('ads')
            .select('*', { count: 'exact', head: true })
            .eq('business_id', businessId);

          if (pageName) q = q.eq('page_name', pageName);
          if (displayFormat) q = q.eq('display_format', displayFormat);
          if (startDate) q = q.gte('start_date_formatted', startDate);
          if (endDate) q = q.lte('end_date_formatted', endDate);

          return q.limit(0);
        };

        console.log('Fetching total count...');
        const { count: totalCount, error: countError } = await buildCountQuery();
        
        let estimatedTotal = totalCount || 0;
        if (countError) {
          console.warn('Count query timeout, using estimate');
          estimatedTotal = 5000;
        } else {
          console.log('Total count:', totalCount);
        }

        controller.enqueue(encoder.encode(sendProgress({
          type: 'progress',
          message: `Starting export...`,
          total: estimatedTotal,
          current: 0,
          percentage: 5
        })));

        // 3. Fetch Data in Batches
        let ads: any[] = [];
        let batchNum = 0;
        let lastAdArchiveId: string | number | null = null;

        while (true) {
          let q = buildAdsQuery().limit(batchSize);

          if (lastAdArchiveId !== null) {
            q = q.gt('ad_archive_id', lastAdArchiveId);
          }

          const { data: batch, error } = await q;

          if (error) {
            console.error(`Batch ${batchNum + 1} error:`, error);
            throw new Error(`Batch fetch failed: ${error.message}`);
          }

          if (!batch || batch.length === 0) break;

          ads = ads.concat(batch);
          batchNum++;
          
          const currentCount = ads.length;
          const progress = Math.min(Math.round((currentCount / (estimatedTotal || 1)) * 90) + 5, 99);
          
          if (batchNum % 2 === 0) {
             controller.enqueue(encoder.encode(sendProgress({
              type: 'progress',
              message: `Loaded ${currentCount} ads...`,
              total: estimatedTotal,
              current: currentCount,
              percentage: progress
            })));
          }

          const last = batch[batch.length - 1] as any;
          lastAdArchiveId = last?.ad_archive_id ?? null;
          
          if (!lastAdArchiveId) break;
        }

        // 4. Client-side filtering for vector groups
        if (allowedGroups?.length) {
            const allowedSet = new Set(allowedGroups);
            ads = ads.filter(ad => allowedSet.has(Number(ad.vector_group)));
        }

        controller.enqueue(encoder.encode(sendProgress({
          type: 'progress',
          message: `Processing metadata...`,
          total: ads.length,
          current: ads.length,
          percentage: 95
        })));

        // 5. Build Metadata (ads_groups_test)
        const vectorGroups = Array.from(new Set(ads
          .map((a: any) => Number(a.vector_group))
          .filter(v => Number.isFinite(v) && v !== -1)));

        const groupsMap = new Map<number, { items: number; repId?: string; ai_description?: string }>();
        let repIds: string[] = [];

        // Fetch Group Info (items, ai_description from ads_groups_test)
        if (vectorGroups.length) {
           const chunkSize = 200;
           for (let i = 0; i < vectorGroups.length; i += chunkSize) {
              const chunk = vectorGroups.slice(i, i + chunkSize);
              const { data: groupRows } = await supabase
                .from('ads_groups_test')
                .select('vector_group, items, rep_ad_archive_id, ai_description')
                .eq('business_id', businessId)
                .in('vector_group', chunk);
              
              (groupRows || []).forEach((g: any) => {
                groupsMap.set(Number(g.vector_group), {
                  items: Number(g.items) || 0,
                  repId: g.rep_ad_archive_id || undefined,
                  ai_description: g.ai_description || undefined // Берем описание отсюда
                });
              });
           }
           repIds = Array.from(new Set(Array.from(groupsMap.values()).map(v => v.repId).filter(Boolean))) as string[];
        }

        // Fetch Representative Text
        let repTextMap = new Map<string, string>();
        if (repIds.length) {
           const chunkSize = 100;
           for (let i = 0; i < repIds.length; i += chunkSize) {
             const chunk = repIds.slice(i, i + chunkSize);
             const { data: reps } = await supabase
               .from('ads')
               .select('ad_archive_id, text')
               .in('ad_archive_id', chunk);
             (reps || []).forEach((r: any) => repTextMap.set(String(r.ad_archive_id), r.text || ''));
           }
        }

        // 6. Build Workbook
        console.log('Building Excel workbook...');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Ads');

        const columnOrder = [
          'ad_archive_id','business_id','page_name','display_format','vector_group','duplicates_count',
          'created_at','start_date_formatted','end_date_formatted',
          'title','text','rep_ad_text','group_description','concept','caption','link_url','publisher_platform','ai_description',
          'meta_ad_url','image_public_url','video_public_url','media_hd_url'
        ];

        const headerMap: Record<string, string> = {
          ad_archive_id: 'Ad Archive ID',
          business_id: 'Business ID',
          page_name: 'Page Name',
          display_format: 'Format',
          vector_group: 'Creative Group',
          duplicates_count: 'Group Items',
          created_at: 'Created At',
          start_date_formatted: 'Start Date',
          end_date_formatted: 'End Date',
          title: 'Title',
          text: 'Text',
          caption: 'Caption',
          rep_ad_text: 'Representative Ad Text',
          group_description: 'Group Description',
          concept: 'Concept',
          link_url: 'Link URL',
          publisher_platform: 'Platform',
          ai_description: 'AI Description',
          meta_ad_url: 'Meta Ads URL',
          image_public_url: 'Image Public URL',
          video_public_url: 'Video Public URL',
          media_hd_url: 'HD Media URL'
        };

        const rows = ads.map((ad: any) => {
          const publicImageUrl = getPublicStorageUrl(ad.storage_path);
          const publicVideoUrl = getPublicStorageUrl(ad.video_storage_path);
          
          let media_hd_url: string | null = null;
          try {
            const snap = ad.snapshot || ad.creative_json_full?.snapshot || {}; 
            const v = Array.isArray(snap.videos) ? snap.videos[0] : null;
            const i = Array.isArray(snap.images) ? snap.images[0] : null;
            media_hd_url = v?.video_hd_url || v?.video_sd_url || i?.url || snap.cards?.[0]?.url || null;
          } catch {}

          const meta_ad_url = ad.meta_ad_url || ad.ad_library_url || (ad.ad_archive_id ? `https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}` : null);
          const groupInfo = groupsMap.get(Number(ad.vector_group));
          
          // Данные из ads_groups_test
          const repText = groupInfo?.repId ? repTextMap.get(groupInfo.repId) || null : null;
          const groupDescription = groupInfo?.ai_description || null; // Только из группы
          const itemsCount = groupInfo?.items || 0; // Только из группы

          return {
            ad_archive_id: ad.ad_archive_id,
            business_id: ad.business_id,
            page_name: ad.page_name,
            display_format: ad.display_format,
            vector_group: ad.vector_group,
            duplicates_count: itemsCount || undefined,
            created_at: ad.created_at,
            start_date_formatted: ad.start_date_formatted,
            end_date_formatted: ad.end_date_formatted,
            title: ad.title,
            text: ad.text,
            rep_ad_text: repText,
            group_description: groupDescription,
            concept: ad.concept || undefined,
            caption: ad.caption,
            link_url: ad.link_url,
            publisher_platform: ad.publisher_platform,
            ai_description: groupDescription, // Дублируем, если нужно в этом столбце
            meta_ad_url,
            image_public_url: publicImageUrl,
            video_public_url: publicVideoUrl,
            media_hd_url
          };
        });

        const nonEmptyColumns = columnOrder.filter(col => rows.some(r => r[col as keyof typeof r] !== null && r[col as keyof typeof r] !== undefined && r[col as keyof typeof r] !== ''));
        
        const headerRow = nonEmptyColumns.map(col => headerMap[col] || col);
        worksheet.addRow(headerRow);
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

        for (const row of rows) {
          const dataRow = nonEmptyColumns.map(col => {
            const val = row[col as keyof typeof row];
            if (val === null || val === undefined) return '';
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          });
          worksheet.addRow(dataRow);
        }

        worksheet.columns = nonEmptyColumns.map(col => ({
          width: Math.min(50, Math.max(15, headerMap[col]?.length || 20)),
          alignment: { wrapText: true, vertical: 'top' }
        }));

        const buffer = await workbook.xlsx.writeBuffer();
        const binary = Buffer.from(buffer as any);
        const filename = `ads_export_${businessId}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;

        const chunkSize = 256 * 1024; // 256KB
        const chunkTotal = Math.ceil(binary.length / chunkSize);
        controller.enqueue(encoder.encode(sendProgress({
          type: 'progress',
          message: `Streaming file... 0/${chunkTotal} chunks`,
          total: rows.length,
          current: rows.length,
          percentage: 99
        })));

        for (let i = 0; i < chunkTotal; i += 1) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, binary.length);
          const chunk = binary.subarray(start, end).toString('base64');
          controller.enqueue(encoder.encode(sendProgress({
            type: 'file-chunk',
            message: `Streaming file... ${i + 1}/${chunkTotal} chunks`,
            chunk,
            chunkIndex: i + 1,
            chunkTotal
          })));
        }

        controller.enqueue(encoder.encode(sendProgress({
          type: 'complete',
          message: `Export complete! ${rows.length} records.`,
          total: rows.length,
          current: rows.length,
          percentage: 100,
          filename
        })));
        controller.close();

      } catch (e: any) {
        console.error('Export error details:', e);
        
        let errorMsg = 'Export failed';
        const isTimeout = e?.code === '57014' || e?.message?.includes('timeout');
        
        if (isTimeout) {
          errorMsg = 'Database timeout. Trying to export too much data at once.';
        } else if (e?.message) {
          errorMsg = e.message;
        }
        
        controller.enqueue(encoder.encode(sendProgress({
          type: 'error',
          message: errorMsg
        })));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}