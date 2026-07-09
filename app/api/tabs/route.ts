import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function summarizeTab(tab: {
  id: string;
  name: string;
  createdAt: Date;
  squaredUp: boolean;
  expenses: { amount: unknown }[];
  _count: { expenses: number };
}) {
  const totalAmount = tab.expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);

  return {
    id: tab.id,
    name: tab.name,
    createdAt: tab.createdAt,
    squaredUp: tab.squaredUp,
    expenseCount: tab._count.expenses,
    totalAmount: totalAmount.toFixed(2),
  };
}

export async function GET() {
  const tabs = await prisma.tab.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      expenses: {
        select: {
          amount: true,
        },
      },
      _count: {
        select: {
          expenses: true,
        },
      },
    },
  });

  return NextResponse.json(tabs.map(summarizeTab));
}

export async function POST(request: Request) {
  let payload: { name?: string };

  try {
    payload = (await request.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = payload.name?.trim();

  if (!name) {
    return NextResponse.json({ error: "Tab name is required." }, { status: 400 });
  }

  const existingTab = await prisma.tab.findUnique({
    where: { name },
    select: { id: true },
  });

  if (existingTab) {
    return NextResponse.json({ error: "A tab with that name already exists." }, { status: 409 });
  }

  const tab = await prisma.tab.create({
    data: { name },
    include: {
      expenses: {
        select: {
          amount: true,
        },
      },
      _count: {
        select: {
          expenses: true,
        },
      },
    },
  });

  return NextResponse.json(summarizeTab(tab), { status: 201 });
}
