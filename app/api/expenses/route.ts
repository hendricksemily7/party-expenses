import type { Prisma, SplitType } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type ShareInput = {
  person?: string;
  splitType?: SplitType;
  value?: number;
};

type ExpenseInput = {
  tabId?: string;
  title?: string;
  amount?: number;
  paidBy?: string;
  receiptImageDataUrl?: string;
  shares?: ShareInput[];
};

const MAX_RECEIPT_IMAGE_DATA_URL_LENGTH = 7_000_000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tabId = searchParams.get("tabId")?.trim();

  const expenses = await prisma.expense.findMany({
    where: tabId ? { tabId } : undefined,
    orderBy: { createdAt: "desc" },
    include: { shares: { orderBy: { person: "asc" } } },
  });

  return NextResponse.json(expenses);
}

export async function POST(request: Request) {
  let payload: ExpenseInput;

  try {
    payload = (await request.json()) as ExpenseInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const title = payload.title?.trim();
  const tabId = payload.tabId?.trim();
  const paidBy = payload.paidBy?.trim();
  const receiptImageDataUrl = payload.receiptImageDataUrl?.trim();
  const amount = Number(payload.amount);
  const shares = payload.shares ?? [];

  if (!tabId || !title || !paidBy || !Number.isFinite(amount) || amount <= 0 || shares.length === 0) {
    return NextResponse.json(
      { error: "Tab, title, paid by, amount, and at least one share are required." },
      { status: 400 },
    );
  }

  if (receiptImageDataUrl) {
    const isImageDataUrl = /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(receiptImageDataUrl);

    if (!isImageDataUrl) {
      return NextResponse.json(
        { error: "Receipt must be a valid image file." },
        { status: 400 },
      );
    }

    if (receiptImageDataUrl.length > MAX_RECEIPT_IMAGE_DATA_URL_LENGTH) {
      return NextResponse.json(
        { error: "Receipt image is too large. Please use an image under 5 MB." },
        { status: 400 },
      );
    }
  }

  const normalizedShares: Prisma.ExpenseShareCreateWithoutExpenseInput[] = [];

  for (const share of shares) {
    const person = share.person?.trim();
    const splitType = share.splitType;
    const value = Number(share.value);

    if (!person || !splitType || !Number.isFinite(value) || value < 0) {
      return NextResponse.json(
        { error: "Each share needs a person, split type, and non-negative value." },
        { status: 400 },
      );
    }

    if (splitType === "PERCENT" && value > 100) {
      return NextResponse.json(
        { error: "Percentage values cannot be above 100." },
        { status: 400 },
      );
    }

    normalizedShares.push({
      person,
      splitType,
      percentage: splitType === "PERCENT" ? value : null,
      amount: splitType === "AMOUNT" ? value : null,
    });
  }

  const expense = await prisma.expense.create({
    data: {
      tabId,
      title,
      paidBy,
      amount,
      receiptImageDataUrl: receiptImageDataUrl ?? null,
      shares: { create: normalizedShares },
    },
    include: { shares: { orderBy: { person: "asc" } } },
  });

  return NextResponse.json(expense, { status: 201 });
}
