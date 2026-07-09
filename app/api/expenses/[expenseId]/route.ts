import type { Prisma, SplitType } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ expenseId: string }>;
};

type UpdateExpenseInput = {
  title?: string;
  amount?: number;
  paidBy?: string;
  receiptImageDataUrl?: string | null;
  shares?: {
    person?: string;
    splitType?: SplitType;
    value?: number;
  }[];
};

const MAX_RECEIPT_IMAGE_DATA_URL_LENGTH = 7_000_000;

export async function PATCH(request: Request, context: RouteContext) {
  const { expenseId } = await context.params;
  let payload: UpdateExpenseInput;

  try {
    payload = (await request.json()) as UpdateExpenseInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const hasTitleUpdate = payload.title !== undefined;
  const hasAmountUpdate = payload.amount !== undefined;
  const hasPaidByUpdate = payload.paidBy !== undefined;
  const hasReceiptUpdate = payload.receiptImageDataUrl !== undefined;
  const hasSharesUpdate = payload.shares !== undefined;

  if (!hasTitleUpdate && !hasAmountUpdate && !hasPaidByUpdate && !hasReceiptUpdate && !hasSharesUpdate) {
    return NextResponse.json({ error: "Provide at least one field to update." }, { status: 400 });
  }

  const title = payload.title?.trim();
  const paidBy = payload.paidBy?.trim();
  let amount: number | undefined;
  if (hasAmountUpdate) {
    amount = Number(payload.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Amount must be greater than 0." }, { status: 400 });
    }
  }
  const receiptImageDataUrl =
    payload.receiptImageDataUrl === null ? null : payload.receiptImageDataUrl?.trim();
  const shares = payload.shares ?? [];

  if (hasTitleUpdate && !title) {
    return NextResponse.json({ error: "Expense title is required." }, { status: 400 });
  }

  if (hasPaidByUpdate && !paidBy) {
    return NextResponse.json({ error: "Paid by is required." }, { status: 400 });
  }

  if (typeof receiptImageDataUrl === "string" && receiptImageDataUrl.length > 0) {
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

  if (hasSharesUpdate) {
    if (shares.length === 0) {
      return NextResponse.json(
        { error: "At least one share is required." },
        { status: 400 },
      );
    }

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
  }

  try {
    const updatedExpense = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        ...(hasTitleUpdate ? { title } : {}),
        ...(hasAmountUpdate ? { amount } : {}),
        ...(hasPaidByUpdate ? { paidBy } : {}),
        ...(hasReceiptUpdate ? { receiptImageDataUrl } : {}),
        ...(hasSharesUpdate
          ? {
              shares: {
                deleteMany: {},
                create: normalizedShares,
              },
            }
          : {}),
      },
      include: {
        shares: {
          orderBy: { person: "asc" },
        },
      },
    });

    return NextResponse.json(updatedExpense);
  } catch {
    return NextResponse.json({ error: "Expense not found." }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { expenseId } = await context.params;

  try {
    await prisma.expense.delete({
      where: { id: expenseId },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Expense not found." }, { status: 404 });
  }
}
