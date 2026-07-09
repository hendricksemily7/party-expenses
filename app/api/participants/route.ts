import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type ParticipantPayload = {
  name?: string;
};

export async function GET() {
  const participants = await prisma.participant.findMany({
    orderBy: { name: "asc" },
  });

  return NextResponse.json(participants);
}

export async function POST(request: Request) {
  let payload: ParticipantPayload;

  try {
    payload = (await request.json()) as ParticipantPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = payload.name?.trim();

  if (!name) {
    return NextResponse.json({ error: "Participant name is required." }, { status: 400 });
  }

  const existing = await prisma.participant.findFirst({
    where: {
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({ error: "That participant already exists." }, { status: 409 });
  }

  const participant = await prisma.participant.create({
    data: { name },
  });

  return NextResponse.json(participant, { status: 201 });
}
