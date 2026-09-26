function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function readRescueRuntimeConfig(env = {}) {
  return {
    maxAttempts: boundedInteger(env.RESCUE_MAX_ATTEMPTS, 3, 1, 6),
    requestTimeoutMs: boundedInteger(env.RESCUE_REQUEST_TIMEOUT_MS, 15_000, 5_000, 30_000),
    maxRuntimeMs: boundedInteger(env.RESCUE_MAX_RUNTIME_MS, 20 * 60_000, 60_000, 40 * 60_000),
  };
}

export function createRescueRuntime(env = {}, now = () => Date.now()) {
  const config = readRescueRuntimeConfig(env);
  const startedAt = now();
  const deadlineAt = startedAt + config.maxRuntimeMs;
  const remainingMs = () => deadlineAt - now();

  const assertRemaining = (context = "quét dữ liệu") => {
    const remaining = remainingMs();
    if (remaining <= 0) {
      throw new Error(
        `Đã hết ngân sách ${Math.round(config.maxRuntimeMs / 60_000)} phút khi ${context}; giữ nguyên dữ liệu gần nhất`,
      );
    }
    return remaining;
  };

  const nextRequestTimeoutMs = (context = "gọi nguồn công khai") =>
    Math.max(1_000, Math.min(config.requestTimeoutMs, assertRemaining(context)));

  const assertCanWait = (waitMs, context = "chờ thử lại") => {
    if (remainingMs() <= waitMs) {
      throw new Error(`Không còn đủ ngân sách để ${context}; giữ nguyên dữ liệu gần nhất`);
    }
  };

  return {
    ...config,
    startedAt,
    deadlineAt,
    remainingMs,
    assertRemaining,
    nextRequestTimeoutMs,
    assertCanWait,
  };
}
