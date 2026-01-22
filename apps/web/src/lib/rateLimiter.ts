import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_LIMIT = 30;
const WINDOW_MS = 60_000;

type InMemoryBucket = {
  count: number;
  resetAt: number;
};

const inMemoryBuckets = new Map<string, InMemoryBucket>();

function getBucketKey(userId: string): string {
  return `analyze:${userId}`;
}

function checkInMemoryLimit(userId: string, limit: number): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const key = getBucketKey(userId);
  const now = Date.now();
  const existing = inMemoryBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + WINDOW_MS;
    inMemoryBuckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
  };
}

export async function rateLimitUser(
  client: SupabaseClient | null,
  userId: string,
  limit = DEFAULT_LIMIT
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  if (!client) {
    return checkInMemoryLimit(userId, limit);
  }

  const windowStart = new Date(Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS);

  try {
    const { data, error } = await client
      .from("rate_limits")
      .select("count")
      .eq("user_id", userId)
      .eq("window_start", windowStart.toISOString())
      .maybeSingle();

    if (error) {
      return checkInMemoryLimit(userId, limit);
    }

    if (!data) {
      const { error: insertError } = await client.from("rate_limits").insert({
        user_id: userId,
        window_start: windowStart.toISOString(),
        count: 1,
      });

      if (insertError) {
        return checkInMemoryLimit(userId, limit);
      }

      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: windowStart.getTime() + WINDOW_MS,
      };
    }

    if (data.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: windowStart.getTime() + WINDOW_MS,
      };
    }

    const { error: updateError } = await client
      .from("rate_limits")
      .update({ count: data.count + 1 })
      .eq("user_id", userId)
      .eq("window_start", windowStart.toISOString());

    if (updateError) {
      return checkInMemoryLimit(userId, limit);
    }

    return {
      allowed: true,
      remaining: limit - (data.count + 1),
      resetAt: windowStart.getTime() + WINDOW_MS,
    };
  } catch (error) {
    return checkInMemoryLimit(userId, limit);
  }
}
