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

type RouteContext = {
  params: Promise<{ tabId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { tabId } = await context.params;
  let payload: { name?: string; squaredUp?: boolean };

  try {
    payload = (await request.json()) as { name?: string; squaredUp?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const nextName = payload.name?.trim();
  const hasNameUpdate = payload.name !== undefined;
  const hasSquaredUpUpdate = payload.squaredUp !== undefined;

  if (!hasNameUpdate && !hasSquaredUpUpdate) {
    return NextResponse.json(
      { error: "Provide a tab name and/or squared-up state." },
      { status: 400 },
    );
  }

  if (hasNameUpdate && !nextName) {
    return NextResponse.json({ error: "Tab name is required." }, { status: 400 });
  }

  if (nextName) {
    const existingTab = await prisma.tab.findUnique({
      where: { name: nextName },
      select: { id: true },
    });

    if (existingTab && existingTab.id !== tabId) {
      return NextResponse.json({ error: "A tab with that name already exists." }, { status: 409 });
    }
  }

  const tab = await prisma.tab.update({
    where: { id: tabId },
    data: {
      ...(nextName ? { name: nextName } : {}),
      ...(hasSquaredUpUpdate ? { squaredUp: payload.squaredUp } : {}),
    },
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

  return NextResponse.json(summarizeTab(tab));
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { tabId } = await context.params;

  await prisma.tab.delete({
    where: { id: tabId },
  });

  return NextResponse.json({ success: true });
}
