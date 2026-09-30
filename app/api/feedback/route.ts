import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { setVote } from "@/lib/queries";

const Body = z.object({
  itemId: z.number().int().positive(),
  vote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

export async function POST(request: NextRequest) {
  // Proxy already guards /api, but check here too so a matcher change can't expose writes.
  if (!(await isValidSession(request.cookies.get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await setVote(getSql(), parsed.data.itemId, parsed.data.vote);
  return NextResponse.json({ ok: true });
}
