import { NextResponse } from 'next/server';

/**
 * Standard success envelope for single-object responses:
 *   { success: true, data: {...} }
 */
export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

/**
 * Standard success envelope for paginated list responses:
 *   { success: true, data: { items, totalRecords, page, pageSize } }
 */
export function okList<T>(
  items: T[],
  totalRecords: number,
  page: number,
  pageSize: number,
  status = 200
) {
  return NextResponse.json(
    { success: true, data: { items, totalRecords, page, pageSize } },
    { status }
  );
}

/**
 * Standard error envelope:
 *   { success: false, message }
 */
export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...extra }, { status });
}

export function unauthorized(message = 'Unauthorized') {
  return fail(message, 401);
}

export function forbidden(message = 'Forbidden') {
  return fail(message, 403);
}

export function notFound(message = 'Not found') {
  return fail(message, 404);
}

export function serverError(message = 'Internal Server Error') {
  return fail(message, 500);
}

/** Parse `page` / `pageSize` query params with sane defaults and bounds. */
export function parsePagination(url: string, defaultPageSize = 20) {
  const { searchParams } = new URL(url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get('pageSize') || String(defaultPageSize), 10) || defaultPageSize)
  );
  return { page, pageSize };
}
