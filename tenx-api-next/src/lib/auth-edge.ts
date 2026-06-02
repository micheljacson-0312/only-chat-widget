import { jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set');
}

const secretKey = new TextEncoder().encode(JWT_SECRET);

export interface EdgeTokenPayload {
  userId: string;
  role: string;
  locationId?: string;
  connection?: string;
  fiscalYearId?: string;
}

/**
 * Edge-runtime safe JWT verification using `jose` (Web Crypto).
 * `jsonwebtoken` relies on Node's `crypto`/`Buffer` and cannot run in
 * Next.js middleware (Edge runtime), so middleware MUST use this helper.
 */
export async function verifyAccessTokenEdge(
  token: string
): Promise<EdgeTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
    });
    return payload as unknown as EdgeTokenPayload;
  } catch {
    return null;
  }
}
