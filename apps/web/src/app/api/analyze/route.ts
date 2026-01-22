// file: apps/web/src/app/api/analyze/route.ts

import { NextResponse } from "next/server";

import { generateGeminiReply } from "../../../lib/geminiClient";
import { rateLimitUser } from "../../../lib/rateLimiter";
import { getSupabaseAdminClient } from "../../../lib/supabaseClient";

export const runtime = "nodejs";

const MAX_MESSAGES = 30;

type ChatMessage = {
  author: string;
  text: string;
};

type AnalyzeRequestBody = {
  messages: ChatMessage[];
  tone: string;
  length?: string;
};

type AuthContext = {
  userId: string;
  teamId: string;
};

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
    }
  );
}

function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function sanitizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function validateRequest(body: AnalyzeRequestBody) {
  if (!Array.isArray(body.messages) || body.messages.length < 1) {
    return "messages must be a non-empty array";
  }

  if (body.messages.length > MAX_MESSAGES) {
    return `messages cannot exceed ${MAX_MESSAGES} items`;
  }

  if (typeof body.tone !== "string" || !body.tone.trim()) {
    return "tone must be a valid string";
  }

  for (const message of body.messages) {
    if (!message || typeof message.text !== "string") {
      return "each message must include text";
    }

    if (!sanitizeText(message.text)) {
      return "message text cannot be empty";
    }
  }

  return null;
}

async function authenticateRequest(token: string): Promise<AuthContext> {
  const adminClient = getSupabaseAdminClient();
  const { data, error } = await adminClient.auth.getUser(token);

  if (error || !data?.user) {
    throw new Error("unauthorized");
  }

  const userId = data.user.id;

  const { data: teamMember, error: teamError } = await adminClient
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (teamError) {
    throw new Error("forbidden");
  }

  let teamId = teamMember?.team_id as string | undefined;

  if (!teamId) {
    const { data: fallbackMember } = await adminClient
      .from("team_members")
      .select("team_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    teamId = fallbackMember?.team_id as string | undefined;
  }

  if (!teamId) {
    throw new Error("forbidden");
  }

  const { data: subscription, error: subscriptionError } = await adminClient
    .from("subscriptions")
    .select("id")
    .eq("team_id", teamId)
    .in("status", ["active", "trialing"])
    .maybeSingle();

  if (subscriptionError || !subscription) {
    throw new Error("forbidden");
  }

  const { data: seat, error: seatError } = await adminClient
    .from("seats")
    .select("id")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (seatError) {
    throw new Error("forbidden");
  }

  if (!seat) {
    const { data: fallbackSeat } = await adminClient
      .from("seats")
      .select("id")
      .eq("team_id", teamId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (!fallbackSeat) {
      throw new Error("forbidden");
    }
  }

  return { userId, teamId };
}

function buildPrompt(messages: ChatMessage[], tone: string, length?: string) {
  const sanitizedMessages = messages
    .map((message) => {
      const author = sanitizeText(message.author || "Unknown");
      const text = sanitizeText(message.text);
      return `- ${author}: ${text}`;
    })
    .join("\n");

  const lengthHint = length?.trim() ? `Preferred length: ${length.trim()}.` : "";

  return [
    "You are an AI assistant helping a human chat operator draft ONE reply.",
    "Use the following rules:",
    "- Respect the requested tone and length.",
    "- Do not escalate the tone beyond the user intent.",
    "- Ask at most one question.",
    "- Return only the reply content, no extra commentary.",
    `Tone: ${sanitizeText(tone)}.`,
    lengthHint,
    "Chat context (most recent last):",
    sanitizedMessages,
  ]
    .filter(Boolean)
    .join("\n");
}

async function logUsage(
  userId: string,
  teamId: string,
  tokens: number | undefined
) {
  if (!tokens) return;

  const adminClient = getSupabaseAdminClient();
  const usageDate = new Date().toISOString().slice(0, 10);

  try {
    const { data, error } = await adminClient
      .from("usage_metrics")
      .select("tokens")
      .eq("usage_date", usageDate)
      .eq("user_id", userId)
      .eq("team_id", teamId)
      .maybeSingle();

    if (error) {
      return;
    }

    if (!data) {
      await adminClient.from("usage_metrics").insert({
        usage_date: usageDate,
        user_id: userId,
        team_id: teamId,
        tokens,
      });
      return;
    }

    await adminClient
      .from("usage_metrics")
      .update({ tokens: (data.tokens ?? 0) + tokens })
      .eq("usage_date", usageDate)
      .eq("user_id", userId)
      .eq("team_id", teamId);
  } catch (error) {
    // Swallow usage logging errors to avoid impacting user response.
  }
}

export async function POST(request: Request) {
  let body: AnalyzeRequestBody;

  try {
    body = (await request.json()) as AnalyzeRequestBody;
  } catch (error) {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON");
  }

  const validationError = validateRequest(body);
  if (validationError) {
    return errorResponse(400, "invalid_request", validationError);
  }

  const token = parseBearerToken(request.headers.get("Authorization"));
  if (!token) {
    return errorResponse(401, "unauthorized", "Missing authorization token");
  }

  let authContext: AuthContext;
  try {
    authContext = await authenticateRequest(token);
  } catch (error) {
    if ((error as Error).message === "unauthorized") {
      return errorResponse(401, "unauthorized", "Invalid session token");
    }
    return errorResponse(403, "forbidden", "Access denied");
  }

  const adminClient = getSupabaseAdminClient();
  const rateLimitResult = await rateLimitUser(
    adminClient,
    authContext.userId,
    30
  );

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "rate_limited",
          message: "Too many requests, please try again later.",
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil(
            (rateLimitResult.resetAt - Date.now()) / 1000
          ).toString(),
        },
      }
    );
  }

  const prompt = buildPrompt(body.messages, body.tone, body.length);

  try {
    const geminiResponse = await generateGeminiReply(prompt, {
      timeoutMs: 15_000,
    });

    if (!geminiResponse.text) {
      return errorResponse(
        502,
        "empty_response",
        "The AI service returned an empty response."
      );
    }

    await logUsage(
      authContext.userId,
      authContext.teamId,
      geminiResponse.totalTokens
    );

    return NextResponse.json({ reply: geminiResponse.text });
  } catch (error) {
    return errorResponse(
      502,
      "ai_error",
      "The AI service is unavailable. Please try again later."
    );
  }
}
