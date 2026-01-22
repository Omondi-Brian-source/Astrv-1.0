// file: apps/web/src/app/api/analyze/route.ts

import { NextResponse } from "next/server";

import { generateGeminiReply } from "../../../lib/geminiClient";
import { rateLimitUser } from "../../../lib/rateLimiter";
import { getSupabaseAdminClient } from "../../../lib/supabaseClient";
import {
  authAndSubscription,
  type AuthenticatedRequest,
} from "../../../middleware/authAndSubscription";

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

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
    }
  );
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

function handleAuthError(error: unknown) {
  const errorCode = (error as Error)?.message ?? "forbidden";

  switch (errorCode) {
    case "missing_token":
      return errorResponse(401, "unauthorized", "Missing authorization token");
    case "unauthorized":
      return errorResponse(401, "unauthorized", "Invalid session token");
    case "subscription_inactive":
      return errorResponse(
        403,
        "subscription_inactive",
        "No active subscription for this team."
      );
    case "seat_limit_reached":
      return errorResponse(
        403,
        "seat_limit_reached",
        "All subscription seats are currently in use."
      );
    default:
      return errorResponse(403, "forbidden", "Access denied");
  }
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

async function logUsage(teamId: string, tokens: number | undefined) {
  if (!tokens) return;

  const adminClient = getSupabaseAdminClient();
  const usageDate = new Date().toISOString().slice(0, 10);

  try {
    const { data, error } = await adminClient
      .from("usage_aggregates")
      .select("tokens_used, requests_count")
      .eq("usage_date", usageDate)
      .eq("team_id", teamId)
      .maybeSingle();

    if (error) {
      return;
    }

    if (!data) {
      await adminClient.from("usage_aggregates").insert({
        usage_date: usageDate,
        team_id: teamId,
        tokens_used: tokens,
        requests_count: 1,
      });
      return;
    }

    await adminClient
      .from("usage_aggregates")
      .update({
        tokens_used: (data.tokens_used ?? 0) + tokens,
        requests_count: (data.requests_count ?? 0) + 1,
      })
      .eq("usage_date", usageDate)
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

  let authedRequest: AuthenticatedRequest;
  try {
    authedRequest = await authAndSubscription(request);
  } catch (error) {
    return handleAuthError(error);
  }

  const auth = authedRequest.auth;
  if (!auth) {
    return errorResponse(500, "auth_context_missing", "Authentication failed.");
  }

  const adminClient = getSupabaseAdminClient();
  const rateLimitResult = await rateLimitUser(
    adminClient,
    auth.user.id,
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

    await logUsage(auth.team.id, geminiResponse.totalTokens);

    return NextResponse.json({ reply: geminiResponse.text });
  } catch (error) {
    return errorResponse(
      502,
      "ai_error",
      "The AI service is unavailable. Please try again later."
    );
  }
}
