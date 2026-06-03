import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user || user.role !== 'Admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const userId = searchParams.get('userId');
    const action = searchParams.get('action');

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          ...(userId ? { userId } : {}),
          ...(action ? { action: { contains: action } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: true },
      }),
      prisma.auditLog.count({
        where: {
          ...(userId ? { userId } : {}),
          ...(action ? { action: { contains: action } } : {}),
        },
      }),
    ]);

    return NextResponse.json({
      items: items.map(log => ({
        ...log,
        userName: log.user?.username || log.user?.email,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) { return NextResponse.json({ error: 'Error' }, { status: 500 }); }
}
