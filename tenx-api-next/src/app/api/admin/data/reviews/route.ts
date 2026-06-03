import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user || user.role !== 'Admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const minRating = searchParams.get('minRating') ? parseInt(searchParams.get('minRating')!) : undefined;
    const maxRating = searchParams.get('maxRating') ? parseInt(searchParams.get('maxRating')!) : undefined;

    const where: any = {};
    if (minRating !== undefined) where.rating = { gte: minRating };
    if (maxRating !== undefined) {
      where.rating = { ...where.rating, lte: maxRating };
    }

    const [items, total] = await Promise.all([
      prisma.consultantReview.findMany({
        where,
        include: {
          consultant: { include: { user: true } },
          customer: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.consultantReview.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        items: items.map(r => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt,
          consultantName: r.consultant.user.username || r.consultant.user.email,
          reviewerName: r.customer.user.username || r.customer.user.email,
        })),
        totalRecords: total,
        page,
        pageSize,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 });
  }
}
