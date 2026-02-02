import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isUserAdmin } from "@/utils/supabase/admin";

export const runtime = "nodejs";

// Table: apify_links
// Columns: id (uuid), business_id (uuid), user_id (uuid), url (text), max_ads (int), created_at (timestamptz)

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const businessId = url.searchParams.get("businessId") || undefined;
    const scope = (url.searchParams.get("scope") || "mine").toLowerCase(); // mine|business

    const supa = await createClient();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    if (!businessId) return NextResponse.json({ message: "Missing businessId" }, { status: 400 });

    const isAdmin = await isUserAdmin(user.id);

    let query = supa
      .from("apify_links")
      .select("id, url, max_ads")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });

    if (scope !== "business" || !isAdmin) {
      query = query.eq("user_id", user.id);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ message: error.message }, { status: 500 });

    const rows = (data || []).map((r: any) => ({ id: r.id, url: r.url, maxAds: r.max_ads ?? 50 }));
    return NextResponse.json({ items: rows, count: rows.length });
  } catch (e: any) {
    return NextResponse.json({ message: e?.message || "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { businessId, links } = body ?? {};
    const supa = await createClient();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    if (!businessId || !Array.isArray(links)) return NextResponse.json({ message: "Missing businessId or links" }, { status: 400 });

    // Replace user's list for this business: delete then insert
    await supa.from("apify_links").delete().eq("business_id", businessId).eq("user_id", user.id);

    const now = new Date().toISOString();
    const payload = links
      .map((l: any) => ({
        business_id: businessId,
        user_id: user.id,
        url: String(l?.url || "").trim(),
        max_ads: Number(l?.maxAds ?? l?.max_ads ?? 50) || 50,
        created_at: now
      }))
      .filter((p: any) => p.url);

    if (payload.length) {
      const { error } = await supa.from("apify_links").insert(payload);
      if (error) return NextResponse.json({ message: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: "Saved", count: payload.length });
  } catch (e: any) {
    return NextResponse.json({ message: e?.message || "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id") || undefined;
    const businessId = url.searchParams.get("businessId") || undefined;
    const all = (url.searchParams.get("all") || "0").toLowerCase();
    const allBusiness = (url.searchParams.get("allBusiness") || "0").toLowerCase();

    const supa = await createClient();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const isAdmin = await isUserAdmin(user.id);

    if (id) {
      // Delete single row by id (own row or admin)
      let q = supa.from("apify_links").delete().eq("id", id);
      if (!isAdmin) q = q.eq("user_id", user.id);
      const { error } = await q;
      if (error) return NextResponse.json({ message: error.message }, { status: 500 });
      return NextResponse.json({ message: "Deleted" });
    }

    if (businessId) {
      if (allBusiness === '1' || allBusiness === 'true') {
        if (!isAdmin) return NextResponse.json({ message: "Forbidden" }, { status: 403 });
        const { error } = await supa.from("apify_links").delete().eq("business_id", businessId);
        if (error) return NextResponse.json({ message: error.message }, { status: 500 });
        return NextResponse.json({ message: "Deleted all for business" });
      }
      if (all === '1' || all === 'true') {
        const { error } = await supa.from("apify_links").delete().eq("business_id", businessId).eq("user_id", user.id);
        if (error) return NextResponse.json({ message: error.message }, { status: 500 });
        return NextResponse.json({ message: "Deleted all for user" });
      }
    }

    return NextResponse.json({ message: "No-op" });
  } catch (e: any) {
    return NextResponse.json({ message: e?.message || "Internal error" }, { status: 500 });
  }
}
