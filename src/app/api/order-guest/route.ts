import { NextRequest, NextResponse } from "next/server";
import { submitGuestOrderWithDb } from "@/lib/order-guest";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }

  const result = await submitGuestOrderWithDb(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ queueNumber: result.queueNumber }, { status: 201 });
}
