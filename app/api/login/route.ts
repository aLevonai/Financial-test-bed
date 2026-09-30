import { NextResponse, type NextRequest } from "next/server";
import { appPassword, safeEqual, SESSION_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/auth";

/** Only same-site relative paths, so the login form can't be used as an open redirect. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const next = safeNext(form.get("next"));
  const password = appPassword();
  const attempt = form.get("password");

  if (!password) {
    return NextResponse.redirect(new URL("/login?error=config", request.url), 303);
  }
  if (typeof attempt !== "string" || !(await safeEqual(attempt, password))) {
    await new Promise((r) => setTimeout(r, 750)); // slow down guessing
    const back = new URL("/login", request.url);
    back.searchParams.set("error", "1");
    if (next !== "/") back.searchParams.set("next", next);
    return NextResponse.redirect(back, 303);
  }

  const res = NextResponse.redirect(new URL(next, request.url), 303);
  res.cookies.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
