import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '10');
    const search = searchParams.get('search') || '';

    const where = {
      OR: [
        { locationName: { contains: search } },
        { locationAddress: { contains: search } },
      ],
    };

    const [items, total] = await Promise.all([
      prisma.location.findMany({
        where,
        include: { locationType: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.location.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        items: items.map((l: any) => ({
            ...l,
            locationTypeName: l.locationType.locationTypeName
        })),
        totalRecords: total,
        page,
        pageSize,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const item = await prisma.location.create({
      data: {
        locationName: body.locationName,
        locationTypeId: body.locationTypeId,
        locationAddress: body.locationAddress,
        isActive: body.isActive ?? true,
      },
    });
    return NextResponse.json({ success: true, data: item });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
