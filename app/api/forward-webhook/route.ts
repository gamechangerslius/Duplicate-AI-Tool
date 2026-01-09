import { NextResponse } from "next/server";
import { createClient } from '@/utils/supabase/server'

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const links: unknown = body?.links;

    if (!Array.isArray(links) || links.length === 0) {
      return NextResponse.json(
        { message: "Поле 'links' должно быть непустым массивом" },
        { status: 400 }
      );
    }

    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { message: "WEBHOOK_URL не настроен на сервере" },
        { status: 500 }
      );
    }

    // Resolve client_id from authenticated user
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const client_id = user?.id || null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Always include client_id with links for the webhook
      body: JSON.stringify({ links, client_id }),
      signal: controller.signal,
    }).catch((e) => {
      throw new Error(e?.message || "Ошибка запроса к вебхуку");
    });

    clearTimeout(timeout);

    const contentType = resp.headers.get("content-type") || "";
    if (!resp.ok) {
      const message = contentType.includes("application/json")
        ? (await resp.json()).message || "Вебхук вернул ошибку"
        : await resp.text();
      return NextResponse.json({ message }, { status: resp.status });
    }

    if (contentType.includes("application/json")) {
      const data = await resp.json();
      return NextResponse.json(data, {
        status: 200,
        headers: {
          "Content-Disposition": `attachment; filename="webhook_result.json"`,
        },
      });
    }

    const text = await resp.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": contentType || "text/plain;charset=utf-8",
        "Content-Disposition": `attachment; filename="webhook_result.json"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { message: e?.message || "Неизвестная ошибка" },
      { status: 500 }
    );
  }
}
