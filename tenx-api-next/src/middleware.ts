import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAccessTokenEdge } from "@/lib/auth-edge";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // The Socket.IO handshake never sends an `Authorization: Bearer` header
  // (the token lives in `handshake.auth.token`), so it must bypass this
  // middleware entirely. Auth for the socket is enforced inside the handler.
  if (pathname.startsWith("/api/socket")) {
    return NextResponse.next();
  }

  const publicRoutes = [
    "/api/auth/login/step1",
    "/api/auth/login/step2",
    "/api/auth/refresh",
    "/api/auth/external-login",
    "/api/auth/forgot-password",
    "/api/auth/verify-reset-token",
    "/api/auth/reset-password",
    "/api/user/consultants"
  ];

  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);

  if (process.env.DEV_AUTH_BYPASS === "true") {
    if (pathname.startsWith("/api/admin")) {
      requestHeaders.set("x-user-id", process.env.DEV_ADMIN_USER_ID || "");
      requestHeaders.set("x-user-role", "Admin");
    } else if (pathname.startsWith("/api/consultant")) {
      requestHeaders.set("x-user-id", process.env.DEV_CONSULTANT_USER_ID || "");
      requestHeaders.set("x-user-role", "Consultant");
    } else if (pathname.startsWith("/api/user") || pathname.startsWith("/api/credits") || pathname.startsWith("/api/invoices")) {
      requestHeaders.set("x-user-id", process.env.DEV_USER_ID || "");
      requestHeaders.set("x-user-role", "User");
    }

    return NextResponse.next({
      request: {
        headers: requestHeaders
      }
    });
  }

  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 }
    );
  }

  const token = authHeader.split(" ")[1];
  const payload = await verifyAccessTokenEdge(token);

  if (!payload) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 }
    );
  }

  const role = String(payload.role || "").toLowerCase();

  if (pathname.startsWith("/api/admin") && !role.includes("admin")) {
    return NextResponse.json(
      { success: false, message: "Forbidden" },
      { status: 403 }
    );
  }

  if (
    pathname.startsWith("/api/consultant") &&
    !(role.includes("consultant") || role.includes("admin"))
  ) {
    return NextResponse.json(
      { success: false, message: "Forbidden" },
      { status: 403 }
    );
  }

  if (
    pathname.startsWith("/api/user") &&
    !(role.includes("user") || role.includes("client") || role.includes("admin") || role.includes("consultant"))
  ) {
    return NextResponse.json(
      { success: false, message: "Forbidden" },
      { status: 403 }
    );
  }

  requestHeaders.set("x-user-id", payload.userId);
  requestHeaders.set("x-user-role", payload.role || "");

  return NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
}

export const config = {
  matcher: "/api/:path*"
};
