import { NextResponse, type NextRequest } from "next/server";

// On a phone, EarlyEye is the guard's app. The security desk's dashboard is for the
// control-room screen and laptops, so phones opening a dashboard page go to /guard.
// ?desk=1 (remembered in a cookie) opens the dashboard on a phone anyway.
const PHONE = /iPhone|iPod|Android.+Mobile|Mobile.+Firefox|Windows Phone|webOS|BlackBerry/i;

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  if (url.searchParams.get("desk") === "1") {
    const res = NextResponse.next();
    res.cookies.set("ee-desk", "1", { path: "/", maxAge: 60 * 60 * 24 * 7, sameSite: "lax" });
    return res;
  }
  if (req.cookies.get("ee-desk")?.value === "1") return NextResponse.next();
  if (!PHONE.test(req.headers.get("user-agent") ?? "")) return NextResponse.next();
  const to = url.clone();
  to.pathname = "/guard";
  to.search = "";
  return NextResponse.redirect(to);
}

export const config = {
  matcher: ["/", "/cameras", "/plan", "/incidents", "/proof"],
};
