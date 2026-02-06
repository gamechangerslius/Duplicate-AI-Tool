import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isUserAdmin } from "@/utils/supabase/admin";
import { supabase } from "@/lib/supabase";
import ExcelJS from "exceljs";

// Increase timeout for large exports (max 300s on Vercel)
export const maxDuration = 300;

function parseBool(v: any) { return String(v).toLowerCase() === 'true'; }

function getPublicStorageUrl(path: string | null | undefined) {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/creatives/${path}`;
}

function toCSV(rows: Record<string, any>[], opts?: { delimiter?: 'comma' | 'semicolon'; columns?: string[]; headers?: Record<string, string> }): string {
  if (!rows.length) return "";
  const delimiterChar = opts?.delimiter === 'comma' ? ',' : ';';
  const cols = (opts?.columns && opts.columns.length) ? opts.columns : Object.keys(rows[0]);
  const headers = cols.map(c => (opts?.headers?.[c] ?? c));
  const escape = (v: any) => {
    if (v === null || v === undefined) return "";
    // Convert to string
    let s = typeof v === 'string' ? v : JSON.stringify(v);
    // Remove line breaks, tabs, and control characters
    s = s.replace(/[\r\n\t]+/g, ' '); // Replace breaks with space
    s = s.replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // Remove control chars
    // Remove multiple spaces
    s = s.replace(/\s+/g, ' ').trim();
    // Escape quotes for CSV
    const cleaned = s.replace(/"/g, '""');
    return `"${cleaned}"`;
  };
  const headerLine = headers.join(delimiterChar);
  const body = rows.map(r => cols.map(c => escape(r[c])).join(delimiterChar)).join('\n');
  return `${headerLine}\n${body}`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const businessId = url.searchParams.get('businessId') || undefined;
  const pageName = url.searchParams.get('pageName') || undefined;
  const startDate = url.searchParams.get('startDate') || undefined;
  const endDate = url.searchParams.get('endDate') || undefined;
  const displayFormat = url.searchParams.get('displayFormat') || undefined;
  const aiDescription = url.searchParams.get('aiDescription') || undefined;
  const minDuplicates = url.searchParams.get('minDuplicates');
  const maxDuplicates = url.searchParams.get('maxDuplicates');
  const format = (url.searchParams.get('format') || 'csv').toLowerCase();
  const delimiterQ = (url.searchParams.get('delimiter') || 'semicolon').toLowerCase();
  const delimiter: 'comma' | 'semicolon' = delimiterQ === 'comma' ? 'comma' : 'semicolon';
  const limitQ = url.searchParams.get('limit');
  // Если limit не указан, экспортируем все (999999), иначе используем переданное значение
  const maxRows = limitQ ? Math.max(1, Number(limitQ) || 999999) : 999999;
  const batchSize = 1000; // Supabase max limit per request

  try {
    const supa = await createClient();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

    // Access control: admin or owner of business
    let hasAccess = false;
    const userIsAdmin = await isUserAdmin(user.id);
    if (userIsAdmin) hasAccess = true;
    if (!hasAccess && businessId) {
      const { data: biz } = await supa.from('businesses').select('id').eq('id', businessId).eq('owner_id', user.id).maybeSingle();
      hasAccess = !!biz;
    }
    if (!hasAccess) return NextResponse.json({ message: "You don't have access to this business" }, { status: 403 });
    if (!businessId) return NextResponse.json({ message: "Missing businessId" }, { status: 400 });

    // Filter by duplicates range via vector_group in groups table FIRST (faster than ads table)
    let allowedGroups: number[] | null = null;
    if (minDuplicates || maxDuplicates) {
      const minVal = Number(minDuplicates || '0');
      const maxVal = Number(maxDuplicates || '999999');
      const { data: groups, error: groupsError } = await supabase
        .from('ads_groups_test')
        .select('vector_group')
        .eq('business_id', businessId)
        .gte('items', minVal)
        .lte('items', maxVal);
      
      if (groupsError) {
        return NextResponse.json({ message: groupsError.message }, { status: 500 });
      }
      
      allowedGroups = (groups || []).map(g => Number(g.vector_group)).filter(n => Number.isFinite(n));
      if (!allowedGroups.length) {
        // no groups in range => empty set
        return NextResponse.json({ message: 'No data for selected range', items: [] }, { status: 200 });
      }
    }

    // Build ads query with minimal columns first, then select * only for needed rows
    const buildAdsQuery = () => {
      let q = supabase
        .from('ads')
        .select('*', { count: 'exact' })
        .eq('business_id', businessId);

      if (pageName) q = q.eq('page_name', pageName);
      if (displayFormat) q = q.eq('display_format', displayFormat);
      if (startDate) q = q.gte('start_date_formatted', startDate);
      if (endDate) q = q.lte('end_date_formatted', endDate);
      if (aiDescription) q = q.ilike('ai_description', `%${aiDescription}%`);
      if (allowedGroups?.length) q = q.in('vector_group', allowedGroups);

      return q.order('created_at', { ascending: true });
    };

    let ads: any[] = [];
    let totalCount = 0;
    
    for (let from = 0; from < maxRows; from += batchSize) {
      const to = Math.min(from + batchSize - 1, maxRows - 1);
      const { data: batch, error, count } = await buildAdsQuery().range(from, to);
      
      if (error) {
        return NextResponse.json({ 
          message: error.message || 'Database query timeout. Try exporting fewer results or narrower filters.',
          code: error.code
        }, { status: 500 });
      }
      
      if (count !== null && from === 0) totalCount = count;
      
      if (!batch || batch.length === 0) break;
      ads = ads.concat(batch);
      if (batch.length < batchSize) break;
    }

    // После загрузки ads, отфильтруй их:
    if (allowedGroups?.length) {
      const allowedSet = new Set(allowedGroups);
      ads = ads.filter(ad => allowedSet.has(Number(ad.vector_group)));
    }

    // Build group metadata map: items count, representative id, group AI description
    const vectorGroups = Array.from(new Set((ads || [])
      .map((a: any) => Number(a.vector_group))
      .filter(v => Number.isFinite(v) && v !== -1)));

    const groupsMap = new Map<number, { items: number; repId?: string; ai_description?: string }>();
    let repIds: string[] = [];
    
    if (vectorGroups.length) {
      try {
        const { data: groupRows, error: groupError } = await supabase
          .from('ads_groups_test')
          .select('vector_group, items, rep_ad_archive_id, ai_description')
          .eq('business_id', businessId)
          .in('vector_group', vectorGroups);
        
        if (groupError) throw groupError;
        
        (groupRows || []).forEach((g: any) => {
          groupsMap.set(Number(g.vector_group), {
            items: Number(g.items) || 0,
            repId: g.rep_ad_archive_id || undefined,
            ai_description: g.ai_description || undefined
          });
        });
        
        repIds = Array.from(new Set(Array.from(groupsMap.values()).map(v => v.repId).filter(Boolean))) as string[];
      } catch (err: any) {
        console.warn('Error fetching group metadata:', err?.message);
      }
    }

    // Fetch representative ad texts if available (in smaller batches to avoid timeout)
    let repTextMap = new Map<string, string>();
    if (repIds.length) {
      try {
        // Batch representative fetches in smaller chunks (max 100 per query)
        for (let i = 0; i < repIds.length; i += 100) {
          const chunk = repIds.slice(i, i + 100);
          const { data: reps, error: repError } = await supabase
            .from('ads')
            .select('ad_archive_id, text')
            .in('ad_archive_id', chunk);
          
          if (repError) throw repError;
          (reps || []).forEach((r: any) => repTextMap.set(String(r.ad_archive_id), r.text || ''));
        }
      } catch (err: any) {
        console.warn('Error fetching representative ad texts:', err?.message);
      }
    }

    // Column order and friendly headers
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

    const rows = (ads || []).map((ad: any) => {
      // Determine media URLs
      const publicImageUrl = getPublicStorageUrl(ad.storage_path);
      const publicVideoUrl = getPublicStorageUrl(ad.video_storage_path);
      // Try extract HD link from creative_json_full snapshot
      let media_hd_url: string | null = null;
      try {
        const snap = ad.creative_json_full?.snapshot || ad.snapshot || {};
        const v = Array.isArray(snap.videos) ? snap.videos[0] : null;
        const i = Array.isArray(snap.images) ? snap.images[0] : null;
        media_hd_url = v?.video_hd_url || v?.video_sd_url || i?.url || snap.cards?.[0]?.url || null;
      } catch {}

      const meta_ad_url = ad.meta_ad_url || ad.ad_library_url || (ad.ad_archive_id ? `https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}` : null);

      const groupInfo = groupsMap.get(Number(ad.vector_group));
      const repText = groupInfo?.repId ? repTextMap.get(groupInfo.repId) || null : null;
      const groupDescription = groupInfo?.ai_description || ad.ai_description || null;

      return {
        ad_archive_id: ad.ad_archive_id,
        business_id: ad.business_id,
        page_name: ad.page_name,
        display_format: ad.display_format,
        vector_group: ad.vector_group,
        duplicates_count: (groupInfo?.items ?? (ad.items || ad.group_items)) || undefined,
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
        ai_description: ad.ai_description,
        meta_ad_url,
        image_public_url: publicImageUrl,
        video_public_url: publicVideoUrl,
        media_hd_url
      } as Record<string, any>;
    });

    if (format === 'json') {
      return new Response(JSON.stringify({ items: rows, count: rows.length }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });
    }

    const isEmptyValue = (v: any) => v === null || v === undefined || v === '';
    const nonEmptyColumns = columnOrder.filter(col => rows.some(r => !isEmptyValue(r[col])));

    // Create Excel workbook using ExcelJS
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Ads');

    // Add headers
    const headerRow = nonEmptyColumns.map(col => headerMap[col] || col);
    worksheet.addRow(headerRow);
    
    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    // Add data rows
    for (const row of rows) {
      const dataRow = nonEmptyColumns.map(col => {
        const val = (row as any)[col];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      });
      worksheet.addRow(dataRow);
    }

    // Set column widths and wrap text
    worksheet.columns = nonEmptyColumns.map((col, idx) => ({
      width: Math.min(50, Math.max(15, headerMap[col]?.length || 20)),
      alignment: { wrapText: true, vertical: 'top' }
    }));

    // Generate Excel file
    const buffer = await workbook.xlsx.writeBuffer();
    const uint8array = new Uint8Array(buffer as any);
    const filename = `ads_export_${businessId}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;

    return new Response(uint8array, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=${filename}`,
        'Cache-Control': 'no-cache'
      }
    });
  } catch (e: any) {
    console.error('Export error:', e);
    const message = e?.message || 'Internal error during export';
    const isDatabaseTimeout = message.includes('timeout') || message.includes('ECONNREFUSED') || message.includes('statement timeout');
    
    return NextResponse.json({ 
      message: isDatabaseTimeout 
        ? 'Export timeout - try with fewer results, narrower date range, or fewer filters'
        : message,
      error: process.env.NODE_ENV === 'development' ? e?.toString() : undefined
    }, { status: 500 });
  }
}
