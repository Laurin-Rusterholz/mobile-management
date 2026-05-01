import { getStore } from "@netlify/blobs";

const STORE_NAME = "app-data";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, If-Match",
  "Access-Control-Expose-Headers": "ETag, Last-Modified",
};

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "PUT") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return new Response(JSON.stringify({ error: "Missing key parameter" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const body = await request.text();
    if (!body) {
      return new Response(JSON.stringify({ error: "Empty body" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const store = getStore({ name: STORE_NAME, consistency: "strong" });

    // If-Match check (conflict detection)
    const ifMatch = request.headers.get("if-match");
    if (ifMatch) {
      const existing = await store.getWithMetadata(key, { type: "text" });
      const currentEtag = existing?.etag || existing?.metadata?.etag;
      if (existing && existing.data != null && currentEtag && currentEtag !== ifMatch) {
        return new Response(JSON.stringify({
          error: "Precondition failed",
          message: "ETag mismatch — server has newer version",
          currentEtag,
        }), {
          status: 412,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json", "ETag": currentEtag },
        });
      }
    }

    // Generate new ETag
    const newEtag = `"${Date.now()}-${Math.random().toString(36).slice(2, 8)}"`;

    await store.set(key, body, {
      metadata: { etag: newEtag, updatedAt: new Date().toISOString() },
    });

    return new Response(JSON.stringify({ ok: true, etag: newEtag }), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "ETag": newEtag,
      },
    });
  } catch (err) {
    console.error("blob-put error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
};

export const config = { path: "/.netlify/functions/blob-put" };
