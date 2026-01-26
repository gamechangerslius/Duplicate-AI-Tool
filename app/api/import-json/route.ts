import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isUserAdmin } from "@/utils/supabase/admin";

export const runtime = "nodejs";

// Create admin client for storage operations
function createAdminClient(reqId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  console.log(`[${reqId}] 🔑 Checking admin client config...`);
  console.log(`[${reqId}] NEXT_PUBLIC_SUPABASE_URL exists:`, Boolean(url));
  console.log(`[${reqId}] SUPABASE_SERVICE_ROLE_KEY exists:`, Boolean(serviceKey));
  
  if (!url) {
    console.log(`[${reqId}] ❌ NEXT_PUBLIC_SUPABASE_URL is not set!`);
    throw new Error("NEXT_PUBLIC_SUPABASE_URL environment variable is not set");
  }
  if (!serviceKey) {
    console.log(`[${reqId}] ❌ SUPABASE_SERVICE_ROLE_KEY is not set!`);
    throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is not set");
  }
  
  try {
    const { createClient: create } = require("@supabase/supabase-js");
    const client = create(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      db: {
        schema: 'public'
      }
    });
    console.log(`[${reqId}] ✅ Admin client created successfully with service role key`);
    return client;
  } catch (err: any) {
    console.log(`[${reqId}] ❌ Failed to create admin client:`, err?.message);
    throw new Error(`Failed to create admin client: ${err?.message}`);
  }
}

function safeJsonStringify(v: any) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export async function POST(req: Request) {
  const reqId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  try {
    // ---- Read body ----
    const body = await req.json().catch(() => ({}));
    const { items, businessId, maxAds } = body ?? {};

    console.log(`\n[${reqId}] ===== /api/import-json POST =====`);
    console.log(`[${reqId}] businessId:`, businessId);
    console.log(`[${reqId}] items count:`, Array.isArray(items) ? items.length : "not-array");
    console.log(`[${reqId}] maxAds limit:`, maxAds || 50);

    if (!Array.isArray(items) || items.length === 0) {
      console.log(`[${reqId}] ❌ Validation failed: items is not a non-empty array`);
      return NextResponse.json(
        { message: "Field 'items' must be a non-empty array" },
        { status: 400 }
      );
    }

    // ---- Auth + business ownership ----
    const supabase = await createClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();

    console.log(`[${reqId}] userErr:`, userErr?.message ?? null);
    console.log(`[${reqId}] userId:`, user?.id ?? null);

    if (!user) {
      console.log(`[${reqId}] ❌ Unauthorized`);
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin or owns this business
    const userIsAdmin = await isUserAdmin(user.id);
    console.log(`[${reqId}] userIsAdmin:`, userIsAdmin);

    let hasAccess = false;

    if (userIsAdmin) {
      hasAccess = true;
      console.log(`[${reqId}] ✅ User is admin - has access to all businesses`);
    } else {
      const { data: biz, error: bizErr } = await supabase
        .from("businesses")
        .select("id")
        .eq("id", businessId)
        .eq("owner_id", user.id)
        .single();

      console.log(`[${reqId}] bizErr:`, bizErr?.message ?? null);
      console.log(`[${reqId}] biz found:`, Boolean(biz));

      if (!bizErr && biz) {
        hasAccess = true;
        console.log(`[${reqId}] ✅ User owns this business`);
      }
    }

    if (!hasAccess) {
      console.log(`[${reqId}] ❌ Forbidden: user does not have access to this business`);
      return NextResponse.json(
        { message: "You don't have access to this business" },
        { status: 403 }
      );
    }

    // Get business slug for saving creatives
    const { data: bizData, error: bizDataErr } = await supabase
      .from("businesses")
      .select("slug")
      .eq("id", businessId)
      .single();

    if (bizDataErr || !bizData?.slug) {
      console.log(`[${reqId}] ❌ Failed to get business slug:`, bizDataErr?.message);
      return NextResponse.json(
        { message: "Failed to get business slug", saved: 0 },
        { status: 500 }
      );
    }

    const businessSlug = bizData.slug;
    console.log(`[${reqId}] 📁 Business slug:`, businessSlug);

    // Limit items to maxAds
    const maxAdsLimit = Math.min(Math.max(maxAds || 50, 1), items.length);
    const itemsToProcess = items.slice(0, maxAdsLimit);
    console.log(`[${reqId}] Processing ${itemsToProcess.length} items (limit: ${maxAdsLimit})`);

    // Process and save each ad
    const savedAds: any[] = [];
    const errors: any[] = [];
    const totalItems = itemsToProcess.length;

    for (let i = 0; i < itemsToProcess.length; i++) {
      const item = itemsToProcess[i];
      try {
        console.log(`[${reqId}] 📊 Progress: ${i + 1}/${totalItems} (${Math.round(((i + 1) / totalItems) * 100)}%)`);
        
        // Extract data from JSON structure (same as Apify response)
        const adArchiveId = item.ad_archive_id || item.adArchiveId;
        const snapshot = item.snapshot || item;

        console.log(`[${reqId}] 🔍 Processing item:`, {
          adArchiveId,
          hasSnapshot: Boolean(snapshot),
          hasVideos: Boolean(snapshot.videos?.length),
        });

        if (!adArchiveId) {
          errors.push({ reason: "missing_ad_archive_id" });
          continue;
        }

        // ---- Check if ad already exists BEFORE processing ----
        const { data: existing, error: checkErr } = await supabase
          .from("ads")
          .select("ad_archive_id")
          .eq("ad_archive_id", adArchiveId)
          .maybeSingle();

        console.log(`[${reqId}] 🔍 Ad exists in DB:`, Boolean(existing));

        // If ad exists, check if image exists in storage
        if (existing) {
          console.log(`[${reqId}] 🔍 Ad ${adArchiveId} already exists - checking for image...`);
          
          const adminClient = createAdminClient(reqId);
          const { data: files, error: listErr } = await adminClient.storage
            .from("creatives")
            .list(businessSlug, {
              search: adArchiveId
            });

          const imageExists = files && files.length > 0;
          console.log(`[${reqId}] 🖼️ Image exists in storage:`, imageExists);

          if (imageExists) {
            console.log(`[${reqId}] ✅ Skipping ${adArchiveId} - already in DB with image`);
            savedAds.push({ ad_archive_id: adArchiveId, skipped: true });
            continue; // Skip this ad completely
          } else {
            console.log(`[${reqId}] ⚠️ Ad exists but no image - will re-upload`);
          }
        }

        // ---- Download and upload media (videos + preview OR images) ----
        let storagePath: string | null = null;
        let videoStoragePath: string | null = null;
        let hasMedia = false;
        const adminClient = createAdminClient(reqId);

        // Check if this is a VIDEO ad
        const isVideo = snapshot.videos && Array.isArray(snapshot.videos) && snapshot.videos.length > 0;

        if (isVideo) {
          console.log(`[${reqId}] 🎬 Processing VIDEO ad`);
          const video = snapshot.videos[0];
          const videoUrl = video.video_hd_url || video.video_sd_url || video.url;
          const previewUrl = video.video_preview_image_url;

          // 1. Download and upload VIDEO file
          if (videoUrl) {
            try {
              console.log(`[${reqId}] 🔽 Downloading video from:`, String(videoUrl).substring(0, 100) + "...");
              const videoResponse = await fetch(videoUrl);
              
              if (videoResponse.ok) {
                const videoBuffer = await videoResponse.arrayBuffer();
                console.log(`[${reqId}] 📦 Video buffer size:`, videoBuffer.byteLength, "bytes");

                if (videoBuffer.byteLength > 0) {
                  const videoExt = 'mp4';
                  videoStoragePath = `${businessSlug}/${adArchiveId}.${videoExt}`;
                  
                  const { error: videoUploadErr } = await adminClient.storage
                    .from("creatives")
                    .upload(videoStoragePath, new Uint8Array(videoBuffer), { upsert: true, contentType: 'video/mp4' });

                  if (videoUploadErr) {
                    console.log(`[${reqId}] ❌ Video upload failed:`, videoUploadErr.message);
                  } else {
                    console.log(`[${reqId}] ✅ Video uploaded:`, videoStoragePath);
                    hasMedia = true;
                  }
                }
              }
            } catch (videoErr: any) {
              console.log(`[${reqId}] ❌ Video download error:`, videoErr?.message);
            }
          }

          // 2. Download and upload PREVIEW IMAGE
          if (previewUrl) {
            try {
              console.log(`[${reqId}] 🔽 Downloading preview from:`, String(previewUrl).substring(0, 100) + "...");
              const previewResponse = await fetch(previewUrl);
              
              if (previewResponse.ok) {
                const previewBuffer = await previewResponse.arrayBuffer();
                console.log(`[${reqId}] 📦 Preview buffer size:`, previewBuffer.byteLength, "bytes");

                if (previewBuffer.byteLength > 0) {
                  const contentType = previewResponse.headers.get('content-type') || 'image/jpeg';
                  let ext = 'jpg';
                  if (contentType.includes('png')) ext = 'png';
                  else if (contentType.includes('webp')) ext = 'webp';
                  
                  storagePath = `${businessSlug}/${adArchiveId}_preview.${ext}`;
                  
                  const { error: previewUploadErr } = await adminClient.storage
                    .from("creatives")
                    .upload(storagePath, new Uint8Array(previewBuffer), { upsert: true, contentType });

                  if (previewUploadErr) {
                    console.log(`[${reqId}] ❌ Preview upload failed:`, previewUploadErr.message);
                  } else {
                    console.log(`[${reqId}] ✅ Preview uploaded:`, storagePath);
                    hasMedia = true;
                  }
                }
              }
            } catch (previewErr: any) {
              console.log(`[${reqId}] ❌ Preview download error:`, previewErr?.message);
            }
          }
        } else {
          // This is an IMAGE ad
          console.log(`[${reqId}] 🖼️ Processing IMAGE ad`);
          let imageUrl = null;

          // Priority 1: images array
          if (snapshot.images && Array.isArray(snapshot.images) && snapshot.images.length > 0) {
            const imgData = snapshot.images[0];
            if (typeof imgData === 'string') {
              imageUrl = imgData;
            } else if (imgData && typeof imgData === 'object') {
              imageUrl = imgData.resized_image_url || imgData.url || imgData.image_url;
            }
          }

          // Priority 2: cards array
          if (!imageUrl && snapshot.cards && Array.isArray(snapshot.cards) && snapshot.cards.length > 0) {
            const card = snapshot.cards[0];
            if (typeof card === 'string') {
              imageUrl = card;
            } else if (card && typeof card === 'object') {
              imageUrl = card.resized_image_url || card.original_image_url || card.image_url || card.url;
            }
          }

          if (imageUrl) {
            try {
              console.log(`[${reqId}] 🔽 Downloading image from:`, String(imageUrl).substring(0, 100) + "...");
              const imgResponse = await fetch(imageUrl);
              
              if (imgResponse.ok) {
                const imgBuffer = await imgResponse.arrayBuffer();
                console.log(`[${reqId}] 📦 Image buffer size:`, imgBuffer.byteLength, "bytes");

                if (imgBuffer.byteLength > 0) {
                  const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
                  let ext = 'jpg';
                  if (contentType.includes('png')) ext = 'png';
                  else if (contentType.includes('webp')) ext = 'webp';
                  else if (contentType.includes('gif')) ext = 'gif';
                  
                  storagePath = `${businessSlug}/${adArchiveId}.${ext}`;
                  
                  const { error: imgUploadErr } = await adminClient.storage
                    .from("creatives")
                    .upload(storagePath, new Uint8Array(imgBuffer), { upsert: true, contentType });

                  if (imgUploadErr) {
                    console.log(`[${reqId}] ❌ Image upload failed:`, imgUploadErr.message);
                  } else {
                    console.log(`[${reqId}] ✅ Image uploaded:`, storagePath);
                    hasMedia = true;
                  }
                }
              }
            } catch (imgErr: any) {
              console.log(`[${reqId}] ❌ Image download error:`, imgErr?.message);
            }
          }
        }

        // Only save ad if we uploaded at least some media
        if (!hasMedia) {
          console.log(`[${reqId}] ❌ Skipping ad ${adArchiveId} - no media uploaded`);
          errors.push({ ad_archive_id: adArchiveId, reason: "no_media_uploaded" });
          continue;
        }

        // ---- Save ad to database ----
        const adData: any = {
          business_id: businessId,
          ad_archive_id: adArchiveId,
          page_name: snapshot.page_name || "",
          title: snapshot.title || null,
          text: snapshot.body?.text || snapshot.text || null,
          caption: snapshot.caption || null,
          url: snapshot.link_url || snapshot.url || null,
          competitor_niche: null,
          display_format: isVideo ? "VIDEO" : "IMAGE",
          start_date_formatted: item.start_date_formatted || null,
          end_date_formatted: item.end_date_formatted || null,
          cards_json: snapshot.cards ? JSON.stringify(snapshot.cards) : null,
          creative_json_full: JSON.stringify(item),
          storage_path: storagePath,
          created_at: new Date().toISOString(),
          vector_group: null,
          duplicates_count: 0,
        };
        
        if (videoStoragePath) {
          adData.video_storage_path = videoStoragePath;
        }

        // Upsert the ad
        let insertErr = null;
        if (checkErr && checkErr.code !== "PGRST116") {
          insertErr = checkErr;
        } else if (existing) {
          const { error: updateErr } = await supabase
            .from("ads")
            .update(adData)
            .eq("ad_archive_id", adArchiveId);
          insertErr = updateErr;
        } else {
          const { error: insertError } = await supabase
            .from("ads")
            .insert([adData]);
          insertErr = insertError;
        }

        if (insertErr) {
          console.log(`[${reqId}] ❌ Insert/update error for ${adArchiveId}:`, insertErr.message);
          errors.push({ ad_archive_id: adArchiveId, reason: "db_save_failed" });
          continue;
        }

        console.log(`[${reqId}] ✅ Saved ad:`, adArchiveId);
        savedAds.push(adArchiveId);
      } catch (err: any) {
        console.log(`[${reqId}] ❌ Exception processing item:`, err?.message);
        errors.push({ reason: err?.message || "unknown error" });
      }
    }

    console.log(`[${reqId}] 📊 Summary: ${savedAds.length} saved, ${errors.length} errors`);
    console.log(`[${reqId}] ✅ Import complete`);

    return NextResponse.json({
      message: `Imported ${savedAds.length} ads from JSON`,
      saved: savedAds.length,
      errors: errors.length,
      errorDetails: errors.slice(0, 10),
    });
  } catch (err: any) {
    console.log(`[req] 💥 Exception:`, err?.message);
    return NextResponse.json(
      { message: err?.message || "Internal server error", saved: 0 },
      { status: 500 }
    );
  }
}
