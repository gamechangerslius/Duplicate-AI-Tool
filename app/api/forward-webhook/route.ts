import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

// Create admin client for storage operations (bypasses any restrictions)
function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  
  const { createClient: create } = require("@supabase/supabase-js");
  return create(url, serviceKey);
}

function safeJsonStringify(v: any) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function normalizeAndValidateUrls(rawLinks: any[]): { urls: string[]; rejected: any[] } {
  const rejected: any[] = [];
  const urls: string[] = [];

  for (const item of rawLinks) {
    // Accept either "string" or "{ url: string }"
    const candidate = item?.url ?? item;
    let s = String(candidate ?? "");

    // IMPORTANT: remove ALL whitespace inside the URL (fixes \n breaks from UI copy)
    s = s.trim().replace(/\s+/g, "");

    if (!s) {
      rejected.push({ reason: "empty", item });
      continue;
    }

    try {
      const u = new URL(s);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        rejected.push({ reason: "bad-protocol", item, normalized: s });
        continue;
      }
      urls.push(u.toString());
    } catch {
      rejected.push({ reason: "invalid-url", item, normalized: s });
    }
  }

  // unique
  const unique = Array.from(new Set(urls));
  return { urls: unique, rejected };
}

export async function POST(req: Request) {
  const reqId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  try {
    // ---- Read body ----
    const body = await req.json().catch(() => ({}));
    const { links, businessId } = body ?? {};

    console.log(`\n[${reqId}] ===== /api/forward-webhook POST =====`);
    console.log(`[${reqId}] body keys:`, body ? Object.keys(body) : null);
    console.log(`[${reqId}] businessId:`, businessId);
    console.log(
      `[${reqId}] links type:`,
      typeof links,
      "isArray:",
      Array.isArray(links),
      "length:",
      Array.isArray(links) ? links.length : null
    );
    console.log(`[${reqId}] links[0] raw:`, safeJsonStringify(Array.isArray(links) ? links[0] : undefined));

    if (!Array.isArray(links) || links.length === 0) {
      console.log(`[${reqId}] ❌ Validation failed: links is not a non-empty array`);
      return NextResponse.json({ message: "Field 'links' must be a non-empty array" }, { status: 400 });
    }

    // ---- Apify config ----
    const apifyToken = process.env.APIFY_TOKEN;
    const apifyActorId = process.env.APIFY_ACTOR_ID;

    console.log(`[${reqId}] APIFY_ACTOR_ID exists:`, Boolean(apifyActorId));
    console.log(`[${reqId}] APIFY_TOKEN exists:`, Boolean(apifyToken));

    if (!apifyToken || !apifyActorId) {
      console.log(`[${reqId}] ❌ Missing Apify config`);
      return NextResponse.json({ message: "Missing Apify configuration" }, { status: 500 });
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

    const { data: biz, error: bizErr } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .eq("owner_id", user.id)
      .single();

    console.log(`[${reqId}] bizErr:`, bizErr?.message ?? null);
    console.log(`[${reqId}] biz found:`, Boolean(biz));

    if (bizErr || !biz) {
      console.log(`[${reqId}] ❌ Forbidden: user does not own this business`);
      return NextResponse.json({ message: "You don't own this business" }, { status: 403 });
    }

    // ---- Normalize URLs (MOST IMPORTANT) ----
    const { urls, rejected } = normalizeAndValidateUrls(links);

    console.log(`[${reqId}] normalized urls count:`, urls.length);
    console.log(`[${reqId}] normalized urls sample:`, urls.slice(0, 3).map((u) => safeJsonStringify(u)));
    console.log(`[${reqId}] rejected count:`, rejected.length);
    if (rejected.length) console.log(`[${reqId}] rejected sample:`, rejected.slice(0, 3));

    if (urls.length === 0) {
      console.log(`[${reqId}] ❌ No valid URLs after normalization`);
      return NextResponse.json(
        {
          message: "No valid URLs after normalization",
          debug: { rejectedSample: rejected.slice(0, 5), linksSample: links.slice(0, 5) },
        },
        { status: 400 }
      );
    }

    // ---- Build Apify sync URL (encode Actor ID and token) ----
    const apifySyncUrl =
      `https://api.apify.com/v2/acts/${encodeURIComponent(apifyActorId)}` +
      `/run-sync-get-dataset-items?token=${encodeURIComponent(apifyToken)}&timeout=55`;

    // IMPORTANT: this actor requires input.urls
    const runInput = {
      urls: urls.map((u) => ({ url: u })), // 👈 важно
      includeAdsData: true,
      maxAds: 50,
    };


    console.log(`[${reqId}] 🚀 Apify URL:`, apifySyncUrl.replace(apifyToken, "****"));
    console.log(`[${reqId}] 📝 Apify input keys:`, Object.keys(runInput));
    console.log(`[${reqId}] 📝 Apify input.urls length:`, runInput.urls.length);
    console.log(`[${reqId}] 📝 Apify input.urls[0]:`, safeJsonStringify(runInput.urls[0]));

    // ---- Call Apify ----
    const response = await fetch(apifySyncUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runInput),
    });

    console.log(`[${reqId}] Apify response status:`, response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[${reqId}] ❌ Apify error body:`, errorText);
      return NextResponse.json(
        {
          message: "Apify error",
          status: response.status,
          apify: errorText,
          debug: { sentUrlsSample: urls.slice(0, 3), rejectedSample: rejected.slice(0, 3) },
        },
        { status: response.status }
      );
    }

    const resultsData = await response.json().catch(async () => {
      const t = await response.text();
      console.log(`[${reqId}] ⚠️ Apify returned non-JSON, body:`, t);
      throw new Error("Apify returned non-JSON response");
    });

    console.log(`[${reqId}] ✅ Apify items received:`, Array.isArray(resultsData) ? resultsData.length : "not-array");
    console.log(`[${reqId}] 📊 First item sample:`, safeJsonStringify(Array.isArray(resultsData) && resultsData[0] ? resultsData[0] : null));

    // ---- Parse Apify results and save to database ----
    if (!Array.isArray(resultsData) || resultsData.length === 0) {
      console.log(`[${reqId}] ℹ️ No results from Apify`);
      return NextResponse.json({ message: "No data from Apify", items: 0 });
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
        { message: "Failed to get business slug", items: 0 },
        { status: 500 }
      );
    }

    const businessSlug = bizData.slug;
    console.log(`[${reqId}] 📁 Business slug:`, businessSlug);

    // Process and save each ad
    const savedAds: any[] = [];
    const errors: any[] = [];

    for (const item of resultsData) {
      try {
        // Extract data from Apify response structure
        const adArchiveId = item.ad_archive_id;
        const snapshot = item.snapshot || {};

        console.log(`[${reqId}] 🔍 Processing item:`, { adArchiveId, hasSnapshot: Boolean(snapshot), hasVideos: Boolean(snapshot.videos?.length) });

        if (!adArchiveId) {
          errors.push({ reason: "missing_ad_archive_id" });
          continue;
        }

        const adData = {
          business_id: businessId,
          ad_archive_id: adArchiveId,
          page_name: snapshot.page_name || "",
          title: snapshot.title || null,
          text: snapshot.body?.text || null,
          caption: snapshot.caption || null,
          url: snapshot.link_url || null,
          competitor_niche: null,
          display_format: snapshot.display_format?.toUpperCase?.() === "VIDEO" ? "VIDEO" : "IMAGE",
          start_date_formatted: item.start_date_formatted || null,
          end_date_formatted: item.end_date_formatted || null,
          cards_json: snapshot.cards ? JSON.stringify(snapshot.cards) : null,
          created_at: new Date().toISOString(),
          vector_group: null,
          duplicates_count: 0,
        };

        // Upsert the ad - check if exists first
        const { data: existing, error: checkErr } = await supabase
          .from("ads")
          .select("ad_archive_id")
          .eq("ad_archive_id", adArchiveId)
          .maybeSingle();

        let insertErr = null;
        if (checkErr && checkErr.code !== 'PGRST116') {
          // Real error, not "no rows" error
          insertErr = checkErr;
        } else if (existing) {
          // Update existing
          const { error: updateErr } = await supabase
            .from("ads")
            .update(adData)
            .eq("ad_archive_id", adArchiveId);
          insertErr = updateErr;
        } else {
          // Insert new
          const { error: insertError } = await supabase
            .from("ads")
            .insert([adData]);
          insertErr = insertError;
        }

        if (insertErr) {
          console.log(`[${reqId}] ❌ Insert/update error for ${adArchiveId}:`, insertErr.message);
          errors.push({ ad_archive_id: adArchiveId, reason: insertErr.message });
          continue;
        }

        console.log(`[${reqId}] ✅ Saved ad: ${adArchiveId}`);
        savedAds.push({ ad_archive_id: adArchiveId });

        // ---- Save creative image ----
        let imageUrl = null;

        // Priority 1: videos array - extract preview image
        if (snapshot.videos && Array.isArray(snapshot.videos) && snapshot.videos.length > 0) {
          const video = snapshot.videos[0];
          imageUrl = video.video_preview_image_url;
          console.log(`[${reqId}] 🎬 Video preview URL:`, imageUrl ? "found" : "not found");
        }

        // Priority 2: images array
        if (!imageUrl && snapshot.images && Array.isArray(snapshot.images) && snapshot.images.length > 0) {
          imageUrl = snapshot.images[0];
          console.log(`[${reqId}] 🖼️ Image URL from array:`, imageUrl ? "found" : "not found");
        }

        console.log(`[${reqId}] 📥 Image URL to download:`, imageUrl ? "yes" : "no");

        if (imageUrl) {
          try {
            console.log(`[${reqId}] 🔽 Downloading image from:`, imageUrl.substring(0, 100) + "...");
            const imgResponse = await fetch(imageUrl);

            console.log(`[${reqId}] 📡 Image response status:`, imgResponse.status);

            if (imgResponse.ok) {
              const buffer = await imgResponse.arrayBuffer();
              console.log(`[${reqId}] 📦 Image buffer size:`, buffer.byteLength, "bytes");
              
              // Determine format
              const urlExt = new URL(imageUrl).pathname.split(".").pop()?.toLowerCase() || "jpg";
              const ext = ["jpg", "jpeg", "png", "webp", "gif"].includes(urlExt) ? urlExt : "jpg";
              
              const storagePath = `${businessSlug}/${adArchiveId}.${ext}`;
              console.log(`[${reqId}] 📤 Uploading to:`, storagePath);
              console.log(`[${reqId}] 📂 Business slug:`, businessSlug);
              console.log(`[${reqId}] 📦 Buffer type:`, buffer.constructor.name);
              
              // Use admin client for storage
              const adminClient = createAdminClient();
              if (!adminClient) {
                console.log(`[${reqId}] ❌ Could not create admin client`);
              } else {
                try {
                  const { data: uploadData, error: uploadErr } = await adminClient.storage
                    .from("creatives")
                    .upload(storagePath, new Uint8Array(buffer), { upsert: true, contentType: `image/${ext}` });

                  if (uploadErr) {
                    console.log(`[${reqId}] ⚠️ Upload error:`, JSON.stringify(uploadErr));
                  } else {
                    console.log(`[${reqId}] ✅ Image uploaded successfully:`, storagePath);
                    console.log(`[${reqId}] 📊 Upload response:`, JSON.stringify(uploadData));
                  }
                } catch (uploadCatchErr: any) {
                  console.log(`[${reqId}] ❌ Upload exception:`, uploadCatchErr?.message);
                }
              }
            } else {
              console.log(`[${reqId}] ⚠️ Image fetch failed with status:`, imgResponse.status);
            }
          } catch (imgErr: any) {
            console.log(`[${reqId}] ⚠️ Image download error for ${adArchiveId}:`, imgErr?.message);
          }
        }
      } catch (parseErr: any) {
        console.log(`[${reqId}] ❌ Error processing item:`, parseErr?.message);
        errors.push({ reason: "parse_error", error: parseErr?.message });
      }
    }

    console.log(`[${reqId}] 📈 Summary: saved=${savedAds.length}, errors=${errors.length}`);

    return NextResponse.json({
      message: "Processing complete",
      saved: savedAds.length,
      errors: errors.length,
      errorDetails: errors.slice(0, 10),
    });
  } catch (e: any) {
    console.log(`[${reqId}] 💥 Exception:`, e?.message);
    return NextResponse.json({ message: e?.message || "Internal Error", reqId }, { status: 500 });
  }
}
