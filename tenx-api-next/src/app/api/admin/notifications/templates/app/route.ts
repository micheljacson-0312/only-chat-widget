import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user || user.role !== 'Admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const templates = await prisma.appTemplate.findMany();
    return NextResponse.json(templates);
  } catch (error) { return NextResponse.json({ error: 'Error' }, { status: 500 }); }
}
