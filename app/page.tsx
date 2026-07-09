"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";

type SplitType = "PERCENT" | "AMOUNT";

type ParticipantShare = {
  id: string;
  name: string;
  splitType: SplitType;
  value: number;
};

type SavedParticipant = {
  id: string;
  name: string;
  createdAt: string;
};

type Expense = {
  id: string;
  title: string;
  amount: string;
  paidBy: string;
  receiptImageDataUrl: string | null;
  createdAt: string;
  shares: {
    id: string;
    person: string;
    splitType: SplitType;
    percentage: string | null;
    amount: string | null;
  }[];
};

type PersonBalance = {
  person: string;
  getsBackCents: number;
  owedCents: number;
  netCents: number;
};

type Settlement = {
  from: string;
  to: string;
  amountCents: number;
};

type TabSummary = {
  id: string;
  name: string;
  createdAt: string;
  squaredUp: boolean;
  expenseCount: number;
  totalAmount: string;
};

type ImportResponse = {
  error?: string;
  importedTabs?: { id: string; name: string }[];
};

function cloneShares(shares: ParticipantShare[]) {
  return shares.map((share) => ({ ...share }));
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const toCents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const MAX_RECEIPT_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPT_DATA_URL_LENGTH = 4_000_000;
const MAX_RECEIPT_DIMENSION_PX = 1800;
const RECEIPT_JPEG_QUALITY = 0.82;

const formatCurrency = (amountCents: number) => currencyFormatter.format(amountCents / 100);

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;

      if (typeof result !== "string") {
        reject(new Error("Unable to read the receipt image."));
        return;
      }

      resolve(result);
    };
    reader.onerror = () => reject(new Error("Unable to read the receipt image."));
    reader.readAsDataURL(file);
  });
}

function isHeicFile(file: File) {
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

function isSupportedReceiptFile(file: File) {
  return file.type.startsWith("image/") || isHeicFile(file);
}

function renameFileExtension(name: string, extension: string) {
  return name.replace(/\.[^/.]+$/, extension);
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to process this receipt image."));
    image.src = src;
  });
}

function dataUrlToBlob(dataUrl: string) {
  const [header, base64Data] = dataUrl.split(",", 2);
  const mimeType = header.match(/^data:([^;]+);base64$/)?.[1];

  if (!mimeType || !base64Data) {
    throw new Error("Unable to open this receipt image.");
  }

  const binary = window.atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

async function convertHeicToJpeg(file: File) {
  const { default: heic2any } = await import("heic2any");
  const conversionResult = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: RECEIPT_JPEG_QUALITY,
  });
  const convertedBlob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;

  if (!(convertedBlob instanceof Blob)) {
    throw new Error("Unable to convert HEIC image. Please try another photo.");
  }

  return new File([convertedBlob], renameFileExtension(file.name, ".jpg"), {
    type: "image/jpeg",
  });
}

async function compressReceiptImage(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(objectUrl);
    const scale = Math.min(
      1,
      MAX_RECEIPT_DIMENSION_PX / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to process this receipt image.");
    }

    context.drawImage(image, 0, 0, width, height);

    const compressedBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Unable to process this receipt image."));
            return;
          }

          resolve(blob);
        },
        "image/jpeg",
        RECEIPT_JPEG_QUALITY,
      );
    });

    return new File([compressedBlob], renameFileExtension(file.name, ".jpg"), {
      type: "image/jpeg",
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareReceiptUpload(file: File) {
  if (!isSupportedReceiptFile(file)) {
    throw new Error("Only image files are supported for receipts.");
  }

  if (file.size > MAX_RECEIPT_SIZE_BYTES) {
    throw new Error("Receipt image is too large. Please use an image under 5 MB.");
  }

  const convertedFile = isHeicFile(file) ? await convertHeicToJpeg(file) : file;
  const compressedFile = await compressReceiptImage(convertedFile);
  const dataUrl = await readFileAsDataUrl(compressedFile);

  if (dataUrl.length > MAX_RECEIPT_DATA_URL_LENGTH) {
    throw new Error("Receipt image is still too large after processing. Please choose a smaller photo.");
  }

  return {
    dataUrl,
    fileName: compressedFile.name,
  };
}

function getShareAmountCents(expenseAmount: number, share: Expense["shares"][number]) {
  if (share.splitType === "PERCENT") {
    return toCents((expenseAmount * Number(share.percentage ?? 0)) / 100);
  }

  return toCents(Number(share.amount ?? 0));
}

function buildSettlementSummary(expenses: Expense[]) {
  const balancesByPerson = new Map<string, { getsBackCents: number; owedCents: number }>();

  for (const expense of expenses) {
    const paidBy = expense.paidBy.trim();
    const expenseAmount = Number(expense.amount);

    for (const share of expense.shares) {
      const person = share.person.trim();

      if (!person || !paidBy) {
        continue;
      }

      const shareAmountCents = getShareAmountCents(expenseAmount, share);
      const payerBalance = balancesByPerson.get(paidBy) ?? { getsBackCents: 0, owedCents: 0 };
      payerBalance.getsBackCents += shareAmountCents;
      balancesByPerson.set(paidBy, payerBalance);

      const participantBalance = balancesByPerson.get(person) ?? { getsBackCents: 0, owedCents: 0 };
      participantBalance.owedCents += shareAmountCents;
      balancesByPerson.set(person, participantBalance);
    }
  }

  const balances: PersonBalance[] = Array.from(balancesByPerson.entries())
    .map(([person, balance]) => ({
      person,
      getsBackCents: balance.getsBackCents,
      owedCents: balance.owedCents,
      netCents: balance.getsBackCents - balance.owedCents,
    }))
    .sort((left, right) => right.netCents - left.netCents);

  const creditors = balances
    .filter((balance) => balance.netCents > 0)
    .map((balance) => ({ person: balance.person, remainingCents: balance.netCents }));
  const debtors = balances
    .filter((balance) => balance.netCents < 0)
    .map((balance) => ({ person: balance.person, remainingCents: Math.abs(balance.netCents) }));
  const settlements: Settlement[] = [];

  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amountCents = Math.min(creditor.remainingCents, debtor.remainingCents);

    if (amountCents > 0) {
      settlements.push({
        from: debtor.person,
        to: creditor.person,
        amountCents,
      });
    }

    creditor.remainingCents -= amountCents;
    debtor.remainingCents -= amountCents;

    if (creditor.remainingCents === 0) {
      creditorIndex += 1;
    }

    if (debtor.remainingCents === 0) {
      debtorIndex += 1;
    }
  }

  return { balances, settlements };
}

function describeBalance(balance: PersonBalance) {
  if (balance.netCents > 0) {
    return `${balance.person} is owed ${formatCurrency(balance.getsBackCents)} by other people in this tab and owes ${formatCurrency(
      balance.owedCents,
    )} back to others, so ${balance.person} should get back ${formatCurrency(balance.netCents)}.`;
  }

  if (balance.netCents < 0) {
    return `${balance.person} is owed ${formatCurrency(balance.getsBackCents)} by other people in this tab and owes ${formatCurrency(
      balance.owedCents,
    )} back to others, so ${balance.person} still owes ${formatCurrency(Math.abs(balance.netCents))}.`;
  }

  return `${balance.person} is owed ${formatCurrency(balance.getsBackCents)} by other people in this tab and owes ${formatCurrency(
    balance.owedCents,
  )}, so ${balance.person} is already squared up.`;
}

function evenlySplitPercentages(count: number) {
  if (count <= 0) {
    return [] as number[];
  }

  const baseHundredths = Math.floor(10000 / count);
  const remainderHundredths = 10000 - baseHundredths * count;

  return Array.from({ length: count }, (_value, index) =>
    (baseHundredths + (index < remainderHundredths ? 1 : 0)) / 100,
  );
}

function buildEqualShares(names: string[]) {
  const cleanNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  const percentages = evenlySplitPercentages(cleanNames.length);

  return cleanNames.map((name, index) => ({
    id: `${Date.now()}-${index}-${name}`,
    name,
    splitType: "PERCENT" as const,
    value: percentages[index] ?? 0,
  }));
}

function buildEqualShareUpdates(names: string[]): Array<{ name: string; splitType: SplitType; value: number }> {
  const cleanNames = names.map((name) => name.trim()).filter(Boolean);
  const percentages = evenlySplitPercentages(cleanNames.length);

  return cleanNames.map((name, index) => ({
    name,
    splitType: "PERCENT" as const,
    value: percentages[index] ?? 0,
  }));
}

const createParticipant = (index: number): ParticipantShare => ({
  id: `${Date.now()}-${index}`,
  name: "",
  splitType: "PERCENT",
  value: index === 0 ? 100 : 50,
});

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [receiptImageDataUrl, setReceiptImageDataUrl] = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState("");
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editPaidBy, setEditPaidBy] = useState("");
  const [editParticipants, setEditParticipants] = useState<ParticipantShare[]>([]);
  const [editReceiptImageDataUrl, setEditReceiptImageDataUrl] = useState<string | null>(null);
  const [editReceiptFileName, setEditReceiptFileName] = useState("");
  const [expenseActionLoading, setExpenseActionLoading] = useState(false);
  const [savedParticipants, setSavedParticipants] = useState<SavedParticipant[]>([]);
  const [newParticipantName, setNewParticipantName] = useState("");
  const [participantActionLoading, setParticipantActionLoading] = useState(false);
  const [participantToAdd, setParticipantToAdd] = useState("");
  const [editParticipantToAdd, setEditParticipantToAdd] = useState("");
  const [participants, setParticipants] = useState<ParticipantShare[]>([createParticipant(0)]);
  const [participantsBeforeSplitWithEveryone, setParticipantsBeforeSplitWithEveryone] = useState<ParticipantShare[] | null>(null);
  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);

  const participantNames = useMemo(
    () => participants.map((person) => person.name.trim()).filter(Boolean),
    [participants],
  );
  const savedParticipantNames = useMemo(
    () => savedParticipants.map((person) => person.name),
    [savedParticipants],
  );
  const editParticipantNames = useMemo(
    () => editParticipants.map((person) => person.name.trim()).filter(Boolean),
    [editParticipants],
  );
  const availableParticipantsToAdd = useMemo(
    () =>
      savedParticipants
        .map((person) => person.name)
        .filter((name) => !participantNames.includes(name)),
    [savedParticipants, participantNames],
  );
  const availableEditParticipantsToAdd = useMemo(
    () =>
      savedParticipants
        .map((person) => person.name)
        .filter((name) => !editParticipantNames.includes(name)),
    [savedParticipants, editParticipantNames],
  );
  const currentParticipantToAdd =
    participantToAdd && availableParticipantsToAdd.includes(participantToAdd)
      ? participantToAdd
      : (availableParticipantsToAdd[0] ?? "");
  const currentEditParticipantToAdd =
    editParticipantToAdd && availableEditParticipantsToAdd.includes(editParticipantToAdd)
      ? editParticipantToAdd
      : (availableEditParticipantsToAdd[0] ?? "");
  const settlementSummary = useMemo(() => buildSettlementSummary(expenses), [expenses]);
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, tabs],
  );
  const activeEventName = activeTab?.name ?? "Bach Party";

  async function loadTabs() {
    const response = await fetch("/api/tabs", { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Unable to load tabs.");
    }

    let data = (await response.json()) as TabSummary[];

    if (data.length === 0) {
      const createResponse = await fetch("/api/tabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bach Party" }),
      });

      if (!createResponse.ok) {
        throw new Error("Unable to create default event.");
      }

      const created = (await createResponse.json()) as TabSummary;
      data = [created];
    }

    setTabs(data);
    setActiveTabId(data[0].id);
    return data;
  }

  async function loadExpenses(tabId: string) {
    const response = await fetch(`/api/expenses?tabId=${encodeURIComponent(tabId)}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Unable to load expenses.");
    }

    const data = (await response.json()) as Expense[];
    setExpenses(data);
  }

  async function loadParticipants() {
    const response = await fetch("/api/participants", { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Unable to load participants.");
    }

    const data = (await response.json()) as SavedParticipant[];
    setSavedParticipants(data);

    setParticipants((currentShares) => {
      if (currentShares.length === 1 && currentShares[0]?.name.trim() === "") {
        const defaults = buildEqualShares(data.map((person) => person.name));

        if (defaults.length > 0) {
          return defaults;
        }
      }

      return currentShares;
    });
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      Promise.all([loadTabs(), loadParticipants()]).catch(() => {
        setStatus("Could not load tabs yet. Connect your database and try again.");
      });
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!activeTabId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      loadExpenses(activeTabId).catch(() => {
        setStatus("Could not load expenses for this tab.");
      });
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [activeTabId]);

  function updateParticipant(id: string, updates: Partial<ParticipantShare>) {
    setParticipantsBeforeSplitWithEveryone(null);
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === id ? { ...participant, ...updates } : participant,
      ),
    );
  }

  function addParticipant() {
    setParticipantsBeforeSplitWithEveryone(null);
    setParticipants((current) => [...current, createParticipant(current.length)]);
  }

  function removeParticipant(id: string) {
    setParticipantsBeforeSplitWithEveryone(null);
    setParticipants((current) => current.filter((participant) => participant.id !== id));
  }

  function toggleSplitWithEveryone() {
    if (participantsBeforeSplitWithEveryone) {
      setParticipants(cloneShares(participantsBeforeSplitWithEveryone));
      setParticipantsBeforeSplitWithEveryone(null);
      return;
    }

    const defaults = buildEqualShares(savedParticipantNames);
    setParticipantsBeforeSplitWithEveryone(cloneShares(participants));
    setParticipants(defaults.length > 0 ? defaults : [createParticipant(0)]);
  }

  function addParticipantFromRoster(name: string) {
    const cleanName = name.trim();

    if (!cleanName || participantNames.includes(cleanName)) {
      return;
    }

    setParticipantsBeforeSplitWithEveryone(null);
    setParticipants((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}-${cleanName}`,
        name: cleanName,
        splitType: "PERCENT",
        value: 0,
      },
    ]);
  }

  function splitCurrentParticipantsEqually() {
    setParticipantsBeforeSplitWithEveryone(null);
    setParticipants((current) => {
      const updates = buildEqualShareUpdates(current.map((participant) => participant.name));

      if (updates.length === 0) {
        return current;
      }

      return current.map((participant, index) => ({
        ...participant,
        splitType: updates[index]?.splitType ?? participant.splitType,
        value: updates[index]?.value ?? participant.value,
      }));
    });
  }

  async function handleCreateParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!newParticipantName.trim()) {
      return;
    }

    setStatus(null);
    setParticipantActionLoading(true);

    try {
      const response = await fetch("/api/participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newParticipantName }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to save participant.");
      }

      setNewParticipantName("");
      await loadParticipants();
      setStatus("Participant saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save participant.");
    } finally {
      setParticipantActionLoading(false);
    }
  }

  async function handleRenameParticipant(person: SavedParticipant) {
    const nextName = window.prompt("Rename participant", person.name)?.trim();

    if (!nextName || nextName === person.name) {
      return;
    }

    setStatus(null);
    setParticipantActionLoading(true);

    try {
      const response = await fetch(`/api/participants/${encodeURIComponent(person.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to rename participant.");
      }
      await loadParticipants();
      setStatus("Participant renamed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to rename participant.");
    } finally {
      setParticipantActionLoading(false);
    }
  }

  async function handleDeleteParticipant(person: SavedParticipant) {
    const confirmed = window.confirm(`Delete participant \"${person.name}\"?`);

    if (!confirmed) {
      return;
    }

    setStatus(null);
    setParticipantActionLoading(true);

    try {
      const response = await fetch(`/api/participants/${encodeURIComponent(person.id)}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to delete participant.");
      }
      await loadParticipants();
      setStatus("Participant deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete participant.");
    } finally {
      setParticipantActionLoading(false);
    }
  }

  async function handleReceiptUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      setReceiptImageDataUrl(null);
      setReceiptFileName("");
      return;
    }

    try {
      const preparedReceipt = await prepareReceiptUpload(file);
      setReceiptImageDataUrl(preparedReceipt.dataUrl);
      setReceiptFileName(preparedReceipt.fileName);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to read the receipt image.");
      event.target.value = "";
      setReceiptImageDataUrl(null);
      setReceiptFileName("");
    }
  }

  function startEditingExpense(expense: Expense) {
    setEditingExpenseId(expense.id);
    setEditTitle(expense.title);
    setEditAmount(expense.amount);
    setEditPaidBy(expense.paidBy);
    setEditParticipants(
      expense.shares.map((share, index) => ({
        id: `${expense.id}-${index}`,
        name: share.person,
        splitType: share.splitType,
        value: Number(share.splitType === "PERCENT" ? share.percentage : share.amount) || 0,
      })),
    );
    setEditReceiptImageDataUrl(expense.receiptImageDataUrl);
    setEditReceiptFileName("");
    setStatus(null);
  }

  function cancelEditingExpense() {
    setEditingExpenseId(null);
    setEditTitle("");
    setEditAmount("");
    setEditPaidBy("");
    setEditParticipants([]);
    setEditReceiptImageDataUrl(null);
    setEditReceiptFileName("");
  }

  function updateEditParticipant(id: string, updates: Partial<ParticipantShare>) {
    setEditParticipants((current) =>
      current.map((participant) =>
        participant.id === id ? { ...participant, ...updates } : participant,
      ),
    );
  }

  function addEditParticipant() {
    setEditParticipants((current) => [...current, createParticipant(current.length)]);
  }

  function addEditParticipantFromRoster(name: string) {
    const cleanName = name.trim();

    if (!cleanName || editParticipantNames.includes(cleanName)) {
      return;
    }

    setEditParticipants((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}-${cleanName}`,
        name: cleanName,
        splitType: "PERCENT",
        value: 0,
      },
    ]);
  }

  function splitEditParticipantsEqually() {
    setEditParticipants((current) => {
      const updates = buildEqualShareUpdates(current.map((participant) => participant.name));

      if (updates.length === 0) {
        return current;
      }

      return current.map((participant, index) => ({
        ...participant,
        splitType: updates[index]?.splitType ?? participant.splitType,
        value: updates[index]?.value ?? participant.value,
      }));
    });
  }

  function removeEditParticipant(id: string) {
    setEditParticipants((current) => current.filter((participant) => participant.id !== id));
  }

  async function handleEditReceiptUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const preparedReceipt = await prepareReceiptUpload(file);
      setEditReceiptImageDataUrl(preparedReceipt.dataUrl);
      setEditReceiptFileName(preparedReceipt.fileName);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to read the receipt image.");
      event.target.value = "";
    }
  }

  async function handleSaveExpenseEdit(expenseId: string) {
    setStatus(null);
    setExpenseActionLoading(true);

    try {
      const response = await fetch(`/api/expenses/${encodeURIComponent(expenseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          amount: Number(editAmount),
          paidBy: editPaidBy,
          receiptImageDataUrl: editReceiptImageDataUrl,
          shares: editParticipants
            .map((participant) => ({
              person: participant.name,
              splitType: participant.splitType,
              value: participant.value,
            }))
            .filter((participant) => participant.person.trim()),
        }),
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to update expense.");
      }

      cancelEditingExpense();
      setStatus("Expense updated.");
      await Promise.all([loadTabs(), loadExpenses(activeTabId)]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to update expense.");
    } finally {
      setExpenseActionLoading(false);
    }
  }

  async function handleDeleteExpense(expense: Expense) {
    const confirmed = window.confirm(`Delete "${expense.title}"? This cannot be undone.`);

    if (!confirmed) {
      return;
    }

    setStatus(null);
    setExpenseActionLoading(true);

    try {
      const response = await fetch(`/api/expenses/${encodeURIComponent(expense.id)}`, {
        method: "DELETE",
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to delete expense.");
      }

      if (editingExpenseId === expense.id) {
        cancelEditingExpense();
      }

      setStatus("Expense deleted.");
      await Promise.all([loadTabs(), loadExpenses(activeTabId)]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete expense.");
    } finally {
      setExpenseActionLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    setLoading(true);

    try {
      if (!activeTabId) {
        throw new Error("Create a tab before adding expenses.");
      }

      const payload = {
        tabId: activeTabId,
        title,
        amount: Number(amount),
        paidBy,
        receiptImageDataUrl,
        shares: participants
          .map((participant) => ({
            person: participant.name,
            splitType: participant.splitType,
            value: participant.value,
          }))
          .filter((participant) => participant.person.trim()),
      };

      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to save expense.");
      }

      setTitle("");
      setAmount("");
      setPaidBy("");
      setReceiptImageDataUrl(null);
      setReceiptFileName("");
      setParticipantsBeforeSplitWithEveryone(null);
      const defaults = buildEqualShares(savedParticipantNames);
      setParticipants(defaults.length > 0 ? defaults : [createParticipant(0)]);
      setStatus("Expense saved.");
      await Promise.all([loadTabs(), loadExpenses(activeTabId)]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save expense.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    setStatus(null);
    setTransferLoading(true);

    try {
      const response = await fetch("/api/transfer", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Unable to export data.");
      }

      const result = await response.json();
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `bach-party-splitter-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.URL.revokeObjectURL(url);
      setStatus("Export downloaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to export data.");
    } finally {
      setTransferLoading(false);
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setStatus(null);
    setTransferLoading(true);

    try {
      const response = await fetch("/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await file.text(),
      });

      const result = (await response.json()) as ImportResponse;

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to import data.");
      }

      await loadTabs();

      if (result.importedTabs?.[0]) {
        setExpenses([]);
        setActiveTabId(result.importedTabs[0].id);
      }

      setStatus(
        `Imported ${result.importedTabs?.length ?? 0} tab${result.importedTabs?.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to import data.");
    } finally {
      event.target.value = "";
      setTransferLoading(false);
    }
  }

  function handleViewReceipt(receiptDataUrl: string) {
    try {
      const receiptBlob = dataUrlToBlob(receiptDataUrl);
      const receiptUrl = window.URL.createObjectURL(receiptBlob);
      const receiptWindow = window.open(receiptUrl, "_blank", "noopener,noreferrer");

      if (!receiptWindow) {
        window.URL.revokeObjectURL(receiptUrl);
        throw new Error("Allow pop-ups to view receipt images.");
      }

      window.setTimeout(() => {
        window.URL.revokeObjectURL(receiptUrl);
      }, 60_000);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to open this receipt image.");
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.sectionHeader}>
          <div>
            <h1>Bach Party Splitter</h1>
            <p className={styles.subhead}>
              One shared board for receipts, splits, and the final who-owes-who summary.
            </p>
          </div>
        </div>

        <article className={styles.summaryCard}>
          <h4>Current event</h4>
          <p className={styles.subhead}>
            {activeEventName} · {expenses.length} expense{expenses.length === 1 ? "" : "s"}
          </p>
        </article>

        <div className={styles.transferRow}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleExport}
            disabled={transferLoading || tabs.length === 0}
          >
            {transferLoading ? "Working..." : "Export data"}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => fileInputRef.current?.click()}
            disabled={transferLoading}
          >
            {transferLoading ? "Working..." : "Import data"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className={styles.hiddenInput}
            onChange={handleImport}
          />
        </div>

        <p className={styles.subhead}>
          Export from your local app, then import that JSON into the deployed app to copy data into
          production.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Settle up</h2>
            <p className={styles.subhead}>
              Running totals for {activeEventName}. This updates whenever expenses change.
            </p>
          </div>
        </div>

        {!activeTab ? (
          <p className={styles.subhead}>Preparing your event board...</p>
        ) : expenses.length === 0 ? (
          <p className={styles.subhead}>No expenses yet.</p>
        ) : (
          <>
            <article className={styles.summaryCard}>
              <h4>Settle up</h4>
              {settlementSummary.settlements.length === 0 ? (
                <p className={styles.subhead}>Everyone is already squared up.</p>
              ) : (
                <ul className={styles.summaryList}>
                  {settlementSummary.settlements.map((settlement) => (
                    <li key={`${settlement.from}-${settlement.to}-${settlement.amountCents}`}>
                      <span>
                        {settlement.from} → {settlement.to}
                      </span>
                      <strong>{formatCurrency(settlement.amountCents)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className={styles.explanationCard}>
              <h4>How this was calculated</h4>
              <p className={styles.subhead}>
                Each saved share means <strong>the listed person owes that amount to the payer</strong>.
                The numbers below are the running total for this tab after subtracting what each person is
                owed back from what they owe out.
              </p>

              <ul className={styles.explanationList}>
                {settlementSummary.balances.map((balance) => (
                  <li key={balance.person}>{describeBalance(balance)}</li>
                ))}
              </ul>
            </article>
          </>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Add expenses</h2>
            <p className={styles.subhead}>
              Everything below is scoped to {activeEventName}.
            </p>
          </div>
        </div>

        <article className={styles.summaryCard}>
          <div className={styles.sectionHeader}>
            <h3>Participants</h3>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={toggleSplitWithEveryone}
              disabled={!activeTab || savedParticipantNames.length === 0}
            >
              {participantsBeforeSplitWithEveryone ? "Undo split with everyone" : "Split with everyone"}
            </button>
          </div>

          <form className={styles.inlineForm} onSubmit={handleCreateParticipant}>
            <label className={styles.inlineLabel}>
              Add participant
              <input
                value={newParticipantName}
                onChange={(event) => setNewParticipantName(event.target.value)}
                placeholder="Name"
                disabled={participantActionLoading}
              />
            </label>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={participantActionLoading || !newParticipantName.trim()}
            >
              {participantActionLoading ? "Saving..." : "Save participant"}
            </button>
          </form>

          {savedParticipants.length === 0 ? (
            <p className={styles.subhead}>No saved participants yet.</p>
          ) : (
            <div className={styles.participants}>
              {savedParticipants.map((person) => (
                <div className={styles.participantCard} key={person.id}>
                  <strong>{person.name}</strong>

                  <div className={styles.tabActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => handleRenameParticipant(person)}
                      disabled={participantActionLoading}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => handleDeleteParticipant(person)}
                      disabled={participantActionLoading}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <datalist id="saved-participants-list">
          {savedParticipants.map((person) => (
            <option key={person.id} value={person.name} />
          ))}
        </datalist>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label>
            Expense name
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              placeholder="Groceries"
              disabled={!activeTab}
            />
          </label>

          <label>
            Total amount
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
              placeholder="120.00"
              disabled={!activeTab}
            />
          </label>

          <label>
            Paid by
            <input
              value={paidBy}
              onChange={(event) => setPaidBy(event.target.value)}
              list="saved-participants-list"
              required
              placeholder={participantNames[0] ?? "Name"}
              disabled={!activeTab}
            />
          </label>

          <label>
            Receipt image (optional)
            <input
              type="file"
              accept="image/*,.heic,.heif"
              onChange={handleReceiptUpload}
              disabled={!activeTab || loading}
            />
          </label>

          {receiptImageDataUrl && (
            <div className={styles.receiptPreview}>
              <p className={styles.subhead}>Attached receipt: {receiptFileName || "Image selected"}</p>
              <Image
                src={receiptImageDataUrl}
                alt="Selected receipt preview"
                width={220}
                height={220}
                className={styles.receiptImage}
              />
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setReceiptImageDataUrl(null);
                  setReceiptFileName("");
                }}
                disabled={!activeTab || loading}
              >
                Remove receipt
              </button>
            </div>
          )}

          <div className={styles.sectionHeader}>
            <h2>Who owes who what</h2>
            <div className={styles.rowActions}>
              <button type="button" onClick={splitCurrentParticipantsEqually} disabled={!activeTab}>
                Split equally
              </button>
              <button type="button" onClick={addParticipant} disabled={!activeTab}>
                + Person
              </button>
            </div>
          </div>

          <div className={styles.rosterPickerRow}>
            <label className={styles.inlineLabel}>
              Add from participant list
              <select
                value={currentParticipantToAdd}
                onChange={(event) => setParticipantToAdd(event.target.value)}
                disabled={!activeTab || availableParticipantsToAdd.length === 0}
              >
                {availableParticipantsToAdd.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={!activeTab || !currentParticipantToAdd}
              onClick={() => addParticipantFromRoster(currentParticipantToAdd)}
            >
              Add to this expense
            </button>
          </div>

          <div className={styles.participants}>
            {participants.map((participant, index) => (
              <div className={styles.participantCard} key={participant.id}>
                <label>
                  Person
                  <input
                    value={participant.name}
                    list="saved-participants-list"
                    onChange={(event) =>
                      updateParticipant(participant.id, { name: event.target.value })
                    }
                    placeholder={`Person ${index + 1}`}
                    required={index === 0}
                    disabled={!activeTab}
                  />
                </label>

                <div className={styles.quickButtons}>
                  <button
                    type="button"
                    className={
                      participant.splitType === "PERCENT" && participant.value === 100
                        ? styles.active
                        : ""
                    }
                    onClick={() =>
                      updateParticipant(participant.id, { splitType: "PERCENT", value: 100 })
                    }
                    disabled={!activeTab}
                  >
                    100%
                  </button>
                  <button
                    type="button"
                    className={
                      participant.splitType === "PERCENT" && participant.value === 50
                        ? styles.active
                        : ""
                    }
                    onClick={() =>
                      updateParticipant(participant.id, { splitType: "PERCENT", value: 50 })
                    }
                    disabled={!activeTab}
                  >
                    50%
                  </button>
                  <button
                    type="button"
                    className={
                      participant.splitType === "PERCENT" &&
                      participant.value !== 100 &&
                      participant.value !== 50
                        ? styles.active
                        : ""
                    }
                    onClick={() => updateParticipant(participant.id, { splitType: "PERCENT" })}
                    disabled={!activeTab}
                  >
                    Custom %
                  </button>
                  <button
                    type="button"
                    className={participant.splitType === "AMOUNT" ? styles.active : ""}
                    onClick={() => updateParticipant(participant.id, { splitType: "AMOUNT" })}
                    disabled={!activeTab}
                  >
                    Custom $
                  </button>
                </div>

                <label>
                  {participant.splitType === "PERCENT" ? "Percentage" : "Amount"}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    max={participant.splitType === "PERCENT" ? "100" : undefined}
                    value={participant.value}
                    onChange={(event) =>
                      updateParticipant(participant.id, {
                        value: Number(event.target.value || 0),
                      })
                    }
                    disabled={!activeTab}
                  />
                </label>

                {participants.length > 1 && (
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => removeParticipant(participant.id)}
                    disabled={!activeTab}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          <button type="submit" disabled={loading || !activeTab} className={styles.submitButton}>
            {loading ? "Saving..." : "Add expense"}
          </button>
        </form>

        {status && <p className={styles.status}>{status}</p>}
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Recent expenses</h2>
            <p className={styles.subhead}>
              Running totals and recent expenses for {activeEventName}.
            </p>
          </div>
        </div>

        {!activeTab ? (
          <p className={styles.subhead}>Preparing your event board...</p>
        ) : expenses.length === 0 ? (
          <p className={styles.subhead}>No expenses yet.</p>
        ) : (
          <>
            <ul className={styles.expenseList}>
              {expenses.map((expense) => (
                <li key={expense.id}>
                  <div className={styles.expenseHeader}>
                    <strong>{expense.title}</strong>
                    <span>${expense.amount}</span>
                  </div>
                  <p>Paid by {expense.paidBy}</p>
                  <div className={styles.expenseActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => startEditingExpense(expense)}
                      disabled={expenseActionLoading}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => handleDeleteExpense(expense)}
                      disabled={expenseActionLoading}
                    >
                      Delete
                    </button>
                  </div>

                  {editingExpenseId === expense.id && (
                    <div className={styles.inlineEditCard}>
                      <label>
                        Expense name
                        <input
                          value={editTitle}
                          onChange={(event) => setEditTitle(event.target.value)}
                          disabled={expenseActionLoading}
                        />
                      </label>

                      <label>
                        Total amount
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={editAmount}
                          onChange={(event) => setEditAmount(event.target.value)}
                          disabled={expenseActionLoading}
                        />
                      </label>

                      <label>
                        Paid by
                        <input
                          value={editPaidBy}
                          list="saved-participants-list"
                          onChange={(event) => setEditPaidBy(event.target.value)}
                          disabled={expenseActionLoading}
                        />
                      </label>

                      <div className={styles.sectionHeader}>
                        <h3>Edit split</h3>
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={splitEditParticipantsEqually}
                            disabled={expenseActionLoading}
                          >
                            Split equally
                          </button>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={addEditParticipant}
                            disabled={expenseActionLoading}
                          >
                            + Person
                          </button>
                        </div>
                      </div>

                      <div className={styles.rosterPickerRow}>
                        <label className={styles.inlineLabel}>
                          Add from participant list
                          <select
                            value={currentEditParticipantToAdd}
                            onChange={(event) => setEditParticipantToAdd(event.target.value)}
                            disabled={
                              expenseActionLoading || availableEditParticipantsToAdd.length === 0
                            }
                          >
                            {availableEditParticipantsToAdd.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          disabled={expenseActionLoading || !currentEditParticipantToAdd}
                          onClick={() => addEditParticipantFromRoster(currentEditParticipantToAdd)}
                        >
                          Add to split
                        </button>
                      </div>

                      <div className={styles.participants}>
                        {editParticipants.map((participant, index) => (
                          <div className={styles.participantCard} key={participant.id}>
                            <label>
                              Person
                              <input
                                value={participant.name}
                                list="saved-participants-list"
                                onChange={(event) =>
                                  updateEditParticipant(participant.id, { name: event.target.value })
                                }
                                placeholder={`Person ${index + 1}`}
                                required={index === 0}
                                disabled={expenseActionLoading}
                              />
                            </label>

                            <div className={styles.quickButtons}>
                              <button
                                type="button"
                                className={
                                  participant.splitType === "PERCENT" && participant.value === 100
                                    ? styles.active
                                    : ""
                                }
                                onClick={() =>
                                  updateEditParticipant(participant.id, {
                                    splitType: "PERCENT",
                                    value: 100,
                                  })
                                }
                                disabled={expenseActionLoading}
                              >
                                100%
                              </button>
                              <button
                                type="button"
                                className={
                                  participant.splitType === "PERCENT" && participant.value === 50
                                    ? styles.active
                                    : ""
                                }
                                onClick={() =>
                                  updateEditParticipant(participant.id, {
                                    splitType: "PERCENT",
                                    value: 50,
                                  })
                                }
                                disabled={expenseActionLoading}
                              >
                                50%
                              </button>
                              <button
                                type="button"
                                className={
                                  participant.splitType === "PERCENT" &&
                                  participant.value !== 100 &&
                                  participant.value !== 50
                                    ? styles.active
                                    : ""
                                }
                                onClick={() =>
                                  updateEditParticipant(participant.id, { splitType: "PERCENT" })
                                }
                                disabled={expenseActionLoading}
                              >
                                Custom %
                              </button>
                              <button
                                type="button"
                                className={participant.splitType === "AMOUNT" ? styles.active : ""}
                                onClick={() =>
                                  updateEditParticipant(participant.id, { splitType: "AMOUNT" })
                                }
                                disabled={expenseActionLoading}
                              >
                                Custom $
                              </button>
                            </div>

                            <label>
                              {participant.splitType === "PERCENT" ? "Percentage" : "Amount"}
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                max={participant.splitType === "PERCENT" ? "100" : undefined}
                                value={participant.value}
                                onChange={(event) =>
                                  updateEditParticipant(participant.id, {
                                    value: Number(event.target.value || 0),
                                  })
                                }
                                disabled={expenseActionLoading}
                              />
                            </label>

                            {editParticipants.length > 1 && (
                              <button
                                type="button"
                                className={styles.removeButton}
                                onClick={() => removeEditParticipant(participant.id)}
                                disabled={expenseActionLoading}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      <label>
                        Receipt image (optional)
                        <input
                          type="file"
                          accept="image/*,.heic,.heif"
                          onChange={handleEditReceiptUpload}
                          disabled={expenseActionLoading}
                        />
                      </label>

                      {editReceiptImageDataUrl && (
                        <div className={styles.receiptPreview}>
                          <p className={styles.subhead}>
                            Attached receipt: {editReceiptFileName || "Existing image"}
                          </p>
                          <Image
                            src={editReceiptImageDataUrl}
                            alt={`Receipt for ${expense.title}`}
                            width={220}
                            height={220}
                            className={styles.receiptImage}
                          />
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => {
                              setEditReceiptImageDataUrl(null);
                              setEditReceiptFileName("");
                            }}
                            disabled={expenseActionLoading}
                          >
                            Remove receipt
                          </button>
                        </div>
                      )}

                      <div className={styles.expenseActions}>
                        <button
                          type="button"
                          className={styles.submitButton}
                          onClick={() => handleSaveExpenseEdit(expense.id)}
                          disabled={expenseActionLoading}
                        >
                          {expenseActionLoading ? "Saving..." : "Save changes"}
                        </button>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={cancelEditingExpense}
                          disabled={expenseActionLoading}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {expense.receiptImageDataUrl && (
                    <div className={styles.receiptHistoryBlock}>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => handleViewReceipt(expense.receiptImageDataUrl!)}
                      >
                        View receipt image
                      </button>
                      <Image
                        src={expense.receiptImageDataUrl}
                        alt={`Receipt for ${expense.title}`}
                        width={180}
                        height={180}
                        className={styles.receiptImage}
                      />
                    </div>
                  )}
                  <ul>
                    {expense.shares.map((share) => (
                      <li key={share.id}>
                        {share.person}:{" "}
                        {share.splitType === "PERCENT" ? `${share.percentage}%` : `$${share.amount}`}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
