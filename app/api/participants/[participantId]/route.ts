import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ participantId: string }>;
};

type ParticipantPayload = {
  name?: string;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { participantId } = await context.params;
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
      NOT: { id: participantId },
    },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({ error: "That participant already exists." }, { status: 409 });
  }

  try {
    const participant = await prisma.participant.update({
      where: { id: participantId },
      data: { name },
    });

    return NextResponse.json(participant);
  } catch {
    return NextResponse.json({ error: "Participant not found." }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { participantId } = await context.params;

  try {
    await prisma.participant.delete({ where: { id: participantId } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Participant not found." }, { status: 404 });
  }
}
