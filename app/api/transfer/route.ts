import { Prisma, SplitType } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type ExportShare = {
  person?: string;
  splitType?: SplitType;
  percentage?: string | number | null;
  amount?: string | number | null;
};

type ExportExpense = {
  title?: string;
  amount?: string | number;
  paidBy?: string;
  receiptImageDataUrl?: string | null;
  createdAt?: string;
  shares?: ExportShare[];
};

type ExportTab = {
  name?: string;
  createdAt?: string;
  squaredUp?: boolean;
  expenses?: ExportExpense[];
};

type TransferPayload = {
  version?: number;
  exportedAt?: string;
  tabs?: ExportTab[];
};

function parseDecimal(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  try {
    return new Prisma.Decimal(value);
  } catch {
    return null;
  }
}

function parseDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

async function getAvailableTabName(
  tx: Prisma.TransactionClient,
  requestedName: string,
  reservedNames: Set<string>,
) {
  const baseName = requestedName.trim() || "Imported Tab";
  let candidate = baseName;
  let suffix = 2;

  while (reservedNames.has(candidate) || (await tx.tab.findUnique({ where: { name: candidate } }))) {
    candidate = `${baseName} (${suffix})`;
    suffix += 1;
  }

  reservedNames.add(candidate);
  return candidate;
}

export async function GET() {
  const tabs = await prisma.tab.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      expenses: {
        orderBy: { createdAt: "asc" },
        include: {
          shares: {
            orderBy: { person: "asc" },
          },
        },
      },
    },
  });

  return NextResponse.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    tabs: tabs.map((tab) => ({
      name: tab.name,
      createdAt: tab.createdAt.toISOString(),
      squaredUp: tab.squaredUp,
      expenses: tab.expenses.map((expense) => ({
        title: expense.title,
        amount: expense.amount.toString(),
        paidBy: expense.paidBy,
        receiptImageDataUrl: expense.receiptImageDataUrl,
        createdAt: expense.createdAt.toISOString(),
        shares: expense.shares.map((share) => ({
          person: share.person,
          splitType: share.splitType,
          percentage: share.percentage?.toString() ?? null,
          amount: share.amount?.toString() ?? null,
        })),
      })),
    })),
  });
}

export async function POST(request: Request) {
  let payload: TransferPayload;

  try {
    payload = (await request.json()) as TransferPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const tabs = payload.tabs ?? [];

  if (payload.version !== 1 || tabs.length === 0) {
    return NextResponse.json(
      { error: "Import file must be a Square Up export with at least one tab." },
      { status: 400 },
    );
  }

  try {
    const importedTabs = await prisma.$transaction(async (tx) => {
      const reservedNames = new Set<string>();
      const createdTabs: { id: string; name: string }[] = [];

      for (const tab of tabs) {
        const tabName = await getAvailableTabName(
          tx,
          tab.name?.trim() ?? "Imported Tab",
          reservedNames,
        );
        const expenses = tab.expenses ?? [];

        const createdTab = await tx.tab.create({
          data: {
            name: tabName,
            createdAt: parseDate(tab.createdAt),
            squaredUp: tab.squaredUp ?? false,
            expenses: {
              create: expenses.map((expense) => {
                const title = expense.title?.trim();
                const paidBy = expense.paidBy?.trim();
                const amount = parseDecimal(expense.amount);

                if (!title || !paidBy || !amount) {
                  throw new Error("Every imported expense needs a title, payer, and amount.");
                }

                const shares = (expense.shares ?? []).map((share) => {
                  const person = share.person?.trim();
                  const splitType = share.splitType;
                  const percentage = parseDecimal(share.percentage);
                  const shareAmount = parseDecimal(share.amount);

                  if (!person || !splitType) {
                    throw new Error("Every imported share needs a person and split type.");
                  }

                  if (splitType === "PERCENT") {
                    if (!percentage || percentage.lessThan(0) || percentage.greaterThan(100)) {
                      throw new Error("Imported percentages must be between 0 and 100.");
                    }

                    return {
                      person,
                      splitType,
                      percentage,
                      amount: null,
                    };
                  }

                  if (!shareAmount || shareAmount.lessThan(0)) {
                    throw new Error("Imported amounts must be zero or greater.");
                  }

                  return {
                    person,
                    splitType,
                    percentage: null,
                    amount: shareAmount,
                  };
                });

                if (shares.length === 0) {
                  throw new Error("Every imported expense needs at least one share.");
                }

                return {
                  title,
                  paidBy,
                  amount,
                  receiptImageDataUrl: expense.receiptImageDataUrl?.trim() || null,
                  createdAt: parseDate(expense.createdAt),
                  shares: {
                    create: shares,
                  },
                };
              }),
            },
          },
        });

        createdTabs.push({ id: createdTab.id, name: createdTab.name });
      }

      return createdTabs;
    });

    return NextResponse.json({ importedTabs }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to import data.",
      },
      { status: 400 },
    );
  }
}
