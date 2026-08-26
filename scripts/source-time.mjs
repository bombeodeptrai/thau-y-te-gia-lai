const SOURCE_TIME_ZONE = "Asia/Ho_Chi_Minh";

const sourceTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SOURCE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// Trường publicDate của API muasamcong là giờ Việt Nam không kèm múi giờ.
// Gửi Date.toISOString() (UTC) làm mốc range sẽ làm lọt các gói mới tối đa 7 giờ.
export function formatMuasamcongDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Mốc thời gian muasamcong không hợp lệ");

  const parts = Object.fromEntries(
    sourceTimeFormatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${milliseconds}`;
}

export function muasamcongDateRange(now, lookbackMs) {
  const end = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(end.getTime())) throw new TypeError("Mốc kết thúc muasamcong không hợp lệ");
  return {
    from: formatMuasamcongDateTime(new Date(end.getTime() - lookbackMs)),
    to: formatMuasamcongDateTime(end),
  };
}

