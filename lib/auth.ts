import { NextRequest, NextResponse } from "next/server";

/**
 * SEC-02: bearer-token guard for admin/cron routes.
 * - Production: requires `Authorization: Bearer <ADMIN_BEARER_TOKEN>`.
 * - Development: open (demo convenience), warns once in server logs.
 */
let warned = false;

export function requireAdmin(req: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== "production") {
    if (!warned) {
      warned = true;
      console.warn("[auth] dev mode: admin routes unauthenticated");
    }
    return null;
  }
  const token = process.env.ADMIN_BEARER_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Server misconfigured: ADMIN_BEARER_TOKEN not set" }, { status: 500 });
  }
  const got = req.headers.get("authorization");
  if (got !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Client helper value (set NEXT_PUBLIC_ADMIN_BEARER_TOKEN for demo dashboard). */
export function adminHeaders(): Record<string, string> {
  const t = process.env.NEXT_PUBLIC_ADMIN_BEARER_TOKEN;
  return t ? { Authorization: `Bearer ${t}` } : {};
}
