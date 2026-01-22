export type GeminiResponse = {
  text: string;
  totalTokens?: number;
};

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

export async function generateGeminiReply(
  prompt: string,
  options?: { timeoutMs?: number }
): Promise<GeminiResponse> {
  const apiKey = process.env.GEMINI_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_KEY environment variable");
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 512,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      usageMetadata?: { totalTokenCount?: number };
    };

    const text =
      payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    return {
      text,
      totalTokens: payload.usageMetadata?.totalTokenCount,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Gemini API request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
