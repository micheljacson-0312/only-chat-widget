import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');

    const authUser = await getAuthUser().catch(() => null);

    const profile = await prisma.consultantProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      return NextResponse.json({ error: 'Consultant not found' }, { status: 404 });
    }

    const [items, total] = await Promise.all([
      prisma.consultantReview.findMany({
        where: { consultantId: profile.id },
        include: {
          customer: {
            include: { user: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.consultantReview.count({
        where: { consultantId: profile.id },
      }),
    ]);

    const averageRating = total > 0
      ? (await prisma.consultantReview.aggregate({
          where: { consultantId: profile.id },
          _avg: { rating: true },
        }))._avg.rating || 0
      : 0;

    const ratingBreakdownRaw = await prisma.consultantReview.groupBy({
      by: ['rating'],
      where: { consultantId: profile.id },
      _count: { rating: true },
    });

    const ratingBreakdown = ratingBreakdownRaw.map(g => ({
      stars: g.rating,
      count: g._count.rating,
    }));

    return NextResponse.json({
      success: true,
      data: {
        items: items.map(r => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt,
          reviewerName: r.customer.user.username || r.customer.user.email,
          reviewerAvatar: r.customer.avatarUrl,
          isMyReview: authUser ? r.customer.userId === authUser.id : false,
        })),
        totalRecords: total,
        page,
        pageSize,
        averageRating: Number(averageRating.toFixed(1)),
        ratingBreakdown,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const authUser = await getAuthUser();
    if (!authUser || authUser.role !== 'Client') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId } = await params;
    const { rating, comment } = await request.json();

    if (rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be 1-5' }, { status: 400 });
    }

    const consultant = await prisma.consultantProfile.findUnique({
      where: { userId },
    });

    if (!consultant) {
      return NextResponse.json({ error: 'Consultant not found' }, { status: 404 });
    }

    const myProfile = await prisma.customerProfile.findUnique({
      where: { userId: authUser.id },
    });

    if (!myProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 });
    }

    // Must be connected
    const connection = await prisma.clientConnection.findFirst({
      where: {
        consultantId: consultant.id,
        customerId: myProfile.id,
        status: 'Accepted',
      },
    });

    if (!connection) {
      return NextResponse.json({ error: 'Must be connected to review' }, { status: 403 });
    }

    const existingReview = await prisma.consultantReview.findFirst({
      where: {
        consultantId: consultant.id,
        customerId: myProfile.id,
      },
    });

    if (existingReview) {
      return NextResponse.json({ error: 'Already reviewed' }, { status: 400 });
    }

    const review = await prisma.consultantReview.create({
      data: {
        consultantId: consultant.id,
        customerId: myProfile.id,
        rating,
        comment,
      },
    });

    return NextResponse.json({ success: true, data: { id: review.id } });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 });
  }
}
