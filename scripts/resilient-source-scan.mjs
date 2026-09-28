export async function mapLimitedSettled(values, concurrency, mapper, options = {}) {
  if (!Array.isArray(values)) throw new TypeError("values phải là một mảng");
  if (typeof mapper !== "function") throw new TypeError("mapper phải là một hàm");

  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  const results = new Array(values.length);
  const failures = [];
  let cursor = 0;

  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await mapper(values[index], index);
      } catch (error) {
        results[index] = [];
        const failure = {
          index,
          value: values[index],
          message: String(error?.message || error),
        };
        failures.push(failure);
        if (typeof options.onRejected === "function") {
          await options.onRejected(failure, error);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  failures.sort((left, right) => left.index - right.index);
  return { results, failures };
}
