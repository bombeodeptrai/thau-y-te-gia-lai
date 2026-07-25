(() => {
  "use strict";

  let coverageDays = 0;

  function investorFromSummary(summaryText) {
    return String(summaryText || "")
      .replace(/^\s*10\s+gói\s+gần\s+nhất\s+đã\s+có\s+kết\s+quả\s+tại\s+/i, "")
      .replace(/^\s*\d+\s+gói\s+gần\s+nhất\s+đã\s+có\s+kết\s+quả\s+tại\s+/i, "")
      .replace(/^\s*Không\s+tìm\s+thấy\s+gói\s+đã\s+có\s+kết\s+quả\s+tại\s+/i, "")
      .replace(/\s+trong\s+3\s+năm\s*$/i, "")
      .trim();
  }

  function updateSection(section) {
    const heading = section.querySelector(".competitor-heading h4");
    if (heading) {
      heading.textContent = "Đối chiếu tối đa 10 gói tại đơn vị và 10 gói tương tự trong khu vực";
    }

    const firstSummaryBox = section.querySelector(".competitor-summary-grid > div:first-child strong");
    const count = Math.max(0, Number(firstSummaryBox?.textContent) || 0);
    const details = section.querySelector(".competitor-details");
    const summary = details?.querySelector(":scope > summary");
    if (!summary) return;

    const investor = investorFromSummary(summary.textContent) || "đơn vị này";
    summary.textContent = count > 0
      ? `${count} gói gần nhất đã có kết quả tại ${investor} trong 3 năm`
      : `Không tìm thấy gói đã có kết quả tại ${investor} trong 3 năm`;

    if (count > 0) return;
    const empty = details.querySelector(".competitor-empty");
    if (!empty) return;

    empty.textContent = coverageDays >= 3 * 365
      ? "Trong dữ liệu công khai đã quét đủ 3 năm, chưa tìm thấy gói có kết quả phù hợp tại đơn vị này."
      : `Bộ dữ liệu lịch sử hiện mới phủ ${coverageDays || "một phần"} ngày; hệ thống đang tiếp tục bổ sung dữ liệu 3 năm.`;
  }

  function updateAll() {
    document.querySelectorAll(".competitor-intelligence").forEach(updateSection);
  }

  async function loadCoverage() {
    try {
      const response = await fetch(`./data/competitor-intelligence.json?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      coverageDays = Number(payload.coverageDays) || 0;
    } catch {
      coverageDays = 0;
    } finally {
      updateAll();
    }
  }

  function init() {
    void loadCoverage();
    updateAll();
    new MutationObserver(updateAll).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
