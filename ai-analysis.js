(() => {
  "use strict";

  const defaults = {
    analysesUrl: "./data/ai-analyses.json",
    tenderDataUrl: "./data/tenders.json",
    detailsBaseUrl: "./data/details",
    capabilityUrl: "./data/kieu-viet-capability.json",
    liveEndpoint: "",
    hoverEnabled: true,
    hoverDelayMs: 650,
    requestTimeoutMs: 100000,
    localCacheHours: 24,
  };
  const config = { ...defaults, ...(window.KIEU_VIET_AI_CONFIG || {}) };
  const tenderById = new Map();
  const tenderByNotifyNo = new Map();
  const staticAnalyses = new Map();
  const liveAnalyses = new Map();
  const detailCache = new Map();
  const hoverTimers = new WeakMap();
  let activeTender = null;
  let modal = null;
  let dataReadyResolve;
  const dataReady = new Promise((resolve) => { dataReadyResolve = resolve; });

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function clamp(value, min = 0, max = 100) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function formatMoney(value) {
    const amount = Number(value) || 0;
    if (!amount) return "Chưa công bố";
    if (amount >= 1_000_000_000) {
      return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(amount / 1_000_000_000)} tỷ`;
    }
    if (amount >= 1_000_000) {
      return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(amount / 1_000_000)} triệu`;
    }
    return `${new Intl.NumberFormat("vi-VN").format(amount)} đ`;
  }

  function formatDate(value, withTime = false) {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return "Chưa công bố";
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(date);
  }

  async function fetchJson(url) {
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(`${url}${separator}v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function getSessionId() {
    const key = "kieu-viet-ai-session-id";
    let value = localStorage.getItem(key);
    if (!value) {
      value = globalThis.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, value);
    }
    return value;
  }

  function localCacheKey(notifyNo) {
    return `kieu-viet-ai-live:${notifyNo}`;
  }

  function loadLocalAnalysis(notifyNo) {
    try {
      const payload = JSON.parse(localStorage.getItem(localCacheKey(notifyNo)) || "null");
      if (!payload?.analysis || !payload.generatedAt) return null;
      const age = Date.now() - new Date(payload.generatedAt).getTime();
      if (!Number.isFinite(age) || age > Number(config.localCacheHours) * 3_600_000) {
        localStorage.removeItem(localCacheKey(notifyNo));
        return null;
      }
      return { ...payload.analysis, generatedAt: payload.generatedAt, source: "openai-live-endpoint" };
    } catch {
      return null;
    }
  }

  function saveLocalAnalysis(notifyNo, analysis) {
    const generatedAt = new Date().toISOString();
    localStorage.setItem(localCacheKey(notifyNo), JSON.stringify({ analysis, generatedAt }));
    liveAnalyses.set(notifyNo, { ...analysis, generatedAt, source: "openai-live-endpoint" });
  }

  function analysisForTender(tender) {
    if (!tender) return null;
    const notifyNo = String(tender.notifyNo || "");
    if (!liveAnalyses.has(notifyNo)) {
      const local = loadLocalAnalysis(notifyNo);
      if (local) liveAnalyses.set(notifyNo, local);
    }
    return liveAnalyses.get(notifyNo) || staticAnalyses.get(notifyNo) || null;
  }

  function preliminaryAnalysis(tender) {
    let overall = 42;
    let success = 28;
    const name = String(tender?.name || "").toLocaleLowerCase("vi-VN");
    const location = String(tender?.location || "").toLocaleLowerCase("vi-VN");
    const price = Number(tender?.price) || 0;
    const closeTime = new Date(tender?.closeDate || 0).getTime();
    const daysLeft = Number.isFinite(closeTime) ? (closeTime - Date.now()) / 86_400_000 : null;

    if (location.includes("gia lai") || location.includes("quy nhơn") || location.includes("pleiku")) {
      overall += 14;
      success += 8;
    }
    if (/thiết bị y tế|máy siêu âm|máy xét nghiệm|máy thở|nội soi/.test(name)) {
      overall += 10;
      success += 5;
    }
    if (/vật tư|hóa chất|hoá chất|sinh phẩm/.test(name)) {
      overall += 5;
      success += 2;
    }
    if (price && price <= 10_000_000_000) {
      overall += 7;
      success += 5;
    } else if (price > 50_000_000_000) {
      overall -= 10;
      success -= 8;
    }
    if (daysLeft !== null && daysLeft < 4) {
      overall -= 7;
      success -= 8;
    }
    if (tender?.status === "urgent") {
      overall -= 5;
      success -= 5;
    }

    overall = clamp(overall);
    success = clamp(success);
    const recommendation = overall >= 70
      ? "Tham gia có điều kiện"
      : overall >= 52
        ? "Theo dõi và làm rõ"
        : "Không khuyến nghị tham gia";

    return {
      overall_score: overall,
      success_probability: success,
      recommendation,
      confidence: "Thấp",
      executive_summary: "Đây là chấm điểm sơ bộ tại trình duyệt. Cần kết quả OpenAI và E-HSMT chính thức để đánh giá đầy đủ điều kiện năng lực, hãng, tài chính, tiến độ và khả năng cạnh tranh.",
      fit: {
        legal: 35,
        technical: clamp(overall - 4),
        commercial: price > 50_000_000_000 ? 25 : 48,
        schedule: daysLeft !== null && daysLeft < 4 ? 25 : 55,
        geography: location.includes("gia lai") ? 82 : 58,
        partnership: 48,
      },
      primary_equipment: [],
      strengths: ["Có lợi thế địa bàn và kinh nghiệm triển khai công trình y tế tại khu vực."],
      gaps: ["Chưa có phân tích AI đã đồng bộ cho gói này.", "Cần kiểm tra giấy ủy quyền hãng, hợp đồng tương tự, nhân sự kỹ thuật và năng lực tài chính."],
      risks: ["Kết quả sơ bộ không đọc toàn bộ E-HSMT và không thay thế thẩm định hồ sơ chính thức."],
      required_partners: ["Hãng hoặc nhà phân phối được ủy quyền phù hợp với thiết bị chủ đạo."],
      next_actions: ["Mở E-HSMT chính thức và rà soát tiêu chí đạt/không đạt.", "Xác định thiết bị chủ đạo, hãng phù hợp và thời gian giao hàng."],
      assumptions: ["Chưa xác minh hồ sơ năng lực chi tiết cho riêng gói thầu."],
      data_quality: "Sơ bộ – chưa có phản hồi OpenAI",
      disclaimer: "Chấm điểm tham khảo, không phải cam kết trúng thầu.",
      source: "local-heuristic",
    };
  }

  function recommendationClass(recommendation) {
    const value = String(recommendation || "").toLocaleLowerCase("vi-VN");
    if (value.includes("ưu tiên")) return "positive";
    if (value.includes("có điều kiện")) return "conditional";
    if (value.includes("theo dõi")) return "watch";
    return "negative";
  }

  function sourceLabel(analysis) {
    if (analysis?.source === "openai-live-endpoint") return "OpenAI trực tiếp";
    if (analysis?.source === "openai-responses-api") return "OpenAI · GitHub Actions";
    return "Đánh giá sơ bộ";
  }

  function previewMarkup(tender, analysis) {
    const isAi = analysis?.source !== "local-heuristic";
    const score = clamp(analysis?.overall_score);
    const probability = clamp(analysis?.success_probability);
    return `
      <div class="ai-preview-head">
        <span class="ai-spark">✦</span>
        <div><b>Chuyên viên đấu thầu Kiểu Việt</b><small>${escapeHtml(sourceLabel(analysis))}</small></div>
        <strong>${score}</strong>
      </div>
      <div class="ai-preview-recommendation ${recommendationClass(analysis?.recommendation)}">${escapeHtml(analysis?.recommendation || "Đang đánh giá")}</div>
      <p>${escapeHtml(analysis?.executive_summary || "")}</p>
      <div class="ai-preview-facts">
        <span>Khả năng thành công <b>${probability}%</b></span>
        <span>Độ tin cậy <b>${escapeHtml(analysis?.confidence || "Thấp")}</b></span>
      </div>
      ${isAi ? "" : '<div class="ai-preview-note">Chưa có kết quả AI đồng bộ; bấm nút để xem điều kiện cấu hình.</div>'}
      <button type="button" data-ai-open="${escapeHtml(tender.id)}">Xem phân tích đầy đủ →</button>`;
  }

  function scoreMetric(label, value) {
    const score = clamp(value);
    return `<div class="ai-fit-item"><div><span>${escapeHtml(label)}</span><b>${score}</b></div><i><em style="width:${score}%"></em></i></div>`;
  }

  function stringList(items, emptyText) {
    const values = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!values.length) return `<p class="ai-empty">${escapeHtml(emptyText)}</p>`;
    return `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function equipmentList(items) {
    const values = Array.isArray(items) ? items.filter((item) => item?.name) : [];
    if (!values.length) return '<p class="ai-empty">Chưa đủ dữ liệu để xác định thiết bị chủ đạo.</p>';
    return `<div class="ai-equipment-list">${values.map((item) => `
      <article>
        <div><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.importance || "Quan trọng")}</span></div>
        <strong>${clamp(item.fit)}%</strong>
        <p>${escapeHtml(item.note || "")}</p>
      </article>`).join("")}</div>`;
  }

  function fullAnalysisMarkup(tender, analysis) {
    const score = clamp(analysis?.overall_score);
    const probability = clamp(analysis?.success_probability);
    const fit = analysis?.fit || {};
    const isAi = analysis?.source !== "local-heuristic";
    return `
      <div class="ai-modal-summary">
        <div class="ai-score-ring" style="--score:${score}"><strong>${score}</strong><span>/100</span></div>
        <div class="ai-modal-copy">
          <span class="ai-source-chip">${escapeHtml(sourceLabel(analysis))}</span>
          <h3>${escapeHtml(analysis?.recommendation || "Đang đánh giá")}</h3>
          <p>${escapeHtml(analysis?.executive_summary || "")}</p>
          <div class="ai-success-line"><span>Khả năng thành công ước tính</span><b>${probability}%</b><i><em style="width:${probability}%"></em></i></div>
        </div>
      </div>
      <div class="ai-tender-context">
        <span><b>${escapeHtml(tender.notifyNo || "")}</b></span>
        <span>${escapeHtml(tender.investor || "")}</span>
        <span>${escapeHtml(formatMoney(tender.price))}</span>
        <span>Đóng ${escapeHtml(formatDate(tender.closeDate, true))}</span>
      </div>
      <section class="ai-section">
        <h4>Mức độ phù hợp với Kiểu Việt</h4>
        <div class="ai-fit-grid">
          ${scoreMetric("Pháp lý/năng lực", fit.legal)}
          ${scoreMetric("Kỹ thuật", fit.technical)}
          ${scoreMetric("Thương mại", fit.commercial)}
          ${scoreMetric("Tiến độ", fit.schedule)}
          ${scoreMetric("Địa bàn", fit.geography)}
          ${scoreMetric("Khả năng liên kết", fit.partnership)}
        </div>
      </section>
      <section class="ai-section">
        <h4>Thiết bị/vật tư chủ đạo</h4>
        ${equipmentList(analysis?.primary_equipment)}
      </section>
      <div class="ai-two-column">
        <section class="ai-section ai-positive-list"><h4>Điểm mạnh</h4>${stringList(analysis?.strengths, "Chưa xác định được điểm mạnh cụ thể.")}</section>
        <section class="ai-section ai-gap-list"><h4>Khoảng trống hồ sơ</h4>${stringList(analysis?.gaps, "Chưa xác định được khoảng trống.")}</section>
        <section class="ai-section ai-risk-list"><h4>Rủi ro chính</h4>${stringList(analysis?.risks, "Chưa xác định được rủi ro cụ thể.")}</section>
        <section class="ai-section"><h4>Đối tác cần có</h4>${stringList(analysis?.required_partners, "Chưa xác định yêu cầu liên kết.")}</section>
      </div>
      <section class="ai-section ai-actions"><h4>Việc cần làm trong 24–72 giờ</h4>${stringList(analysis?.next_actions, "Mở hồ sơ chính thức và rà soát tiêu chí đánh giá.")}</section>
      <details class="ai-assumptions"><summary>Dữ liệu, giả định và giới hạn</summary>
        <p><b>Chất lượng dữ liệu:</b> ${escapeHtml(analysis?.data_quality || "Chưa đánh giá")}</p>
        ${stringList(analysis?.assumptions, "Không có giả định được nêu.")}
      </details>
      <p class="ai-disclaimer">${escapeHtml(analysis?.disclaimer || "Phân tích mang tính tham khảo; E-HSMT chính thức là căn cứ cuối cùng.")}</p>
      ${isAi && analysis?.generatedAt ? `<p class="ai-generated-at">Tạo lúc ${escapeHtml(formatDate(analysis.generatedAt, true))}${analysis.model ? ` · ${escapeHtml(analysis.model)}` : ""}</p>` : ""}`;
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "ai-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="ai-modal-backdrop" data-ai-close></div>
      <section class="ai-modal-panel" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">
        <header>
          <div><span>✦ AI ĐẤU THẦU KIỂU VIỆT</span><h2 id="ai-modal-title">Phân tích gói thầu</h2></div>
          <button type="button" data-ai-close aria-label="Đóng">×</button>
        </header>
        <div class="ai-modal-body"></div>
        <footer>
          <span class="ai-live-status"></span>
          <button type="button" class="ai-refresh-button" data-ai-refresh hidden>Phân tích lại bằng AI</button>
          <button type="button" class="ai-close-button" data-ai-close>Đóng</button>
        </footer>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-ai-close]")) closeModal();
      const refresh = event.target.closest("[data-ai-refresh]");
      if (refresh && activeTender) void runLiveAnalysis(activeTender, refresh);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) closeModal();
    });
    return modal;
  }

  function openModal(tender) {
    activeTender = tender;
    const target = ensureModal();
    const analysis = analysisForTender(tender) || preliminaryAnalysis(tender);
    target.querySelector("#ai-modal-title").textContent = tender.name || "Phân tích gói thầu";
    target.querySelector(".ai-modal-body").innerHTML = fullAnalysisMarkup(tender, analysis);
    const refreshButton = target.querySelector("[data-ai-refresh]");
    refreshButton.hidden = !String(config.liveEndpoint || "").trim();
    target.querySelector(".ai-live-status").textContent = analysis.source === "local-heuristic"
      ? "AI chưa được đồng bộ. Cần thêm secret OPENAI_API_KEY hoặc cấu hình Web App."
      : "Phân tích hỗ trợ quyết định; hãy kiểm tra E-HSMT trước khi phê duyệt tham gia.";
    target.hidden = false;
    document.documentElement.classList.add("ai-modal-open");
    requestAnimationFrame(() => target.querySelector("[data-ai-close]")?.focus());
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.documentElement.classList.remove("ai-modal-open");
    activeTender = null;
  }

  async function loadDetail(tender) {
    const notifyNo = String(tender.notifyNo || "");
    if (detailCache.has(notifyNo)) return detailCache.get(notifyNo);
    try {
      const detail = await fetchJson(`${config.detailsBaseUrl}/${encodeURIComponent(notifyNo)}.json`);
      detailCache.set(notifyNo, detail);
      return detail;
    } catch {
      detailCache.set(notifyNo, null);
      return null;
    }
  }

  async function runLiveAnalysis(tender, button) {
    const endpoint = String(config.liveEndpoint || "").trim();
    if (!endpoint) return;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "AI đang phân tích…";
    const status = modal.querySelector(".ai-live-status");
    status.textContent = "Đang gửi dữ liệu gói thầu tới OpenAI qua backend bảo mật…";
    try {
      const detail = await loadDetail(tender);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(config.requestTimeoutMs) || 100000);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "analyzeTender",
          sessionId: getSessionId(),
          tender,
          detail,
        }),
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.ok || !payload.analysis) throw new Error(payload?.error || "Backend không trả kết quả AI");
      saveLocalAnalysis(String(tender.notifyNo || ""), payload.analysis);
      modal.querySelector(".ai-modal-body").innerHTML = fullAnalysisMarkup(tender, analysisForTender(tender));
      status.textContent = "Đã cập nhật phân tích trực tiếp từ OpenAI.";
      refreshVisiblePreview(tender);
    } catch (error) {
      status.textContent = `Chưa phân tích lại được: ${error.name === "AbortError" ? "quá thời gian chờ" : error.message}`;
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function rowTender(row) {
    const id = row.querySelector("[data-action='expand']")?.dataset.id
      || row.querySelector("[data-action='save']")?.dataset.id
      || row.dataset.aiTenderId;
    return tenderById.get(String(id || "")) || null;
  }

  function showPreview(row, tender) {
    const card = row.querySelector(".ai-hover-card");
    if (!card) return;
    const analysis = analysisForTender(tender) || preliminaryAnalysis(tender);
    card.innerHTML = previewMarkup(tender, analysis);
    card.dataset.open = "true";
    row.classList.add("ai-preview-open");
  }

  function hidePreview(row) {
    const timer = hoverTimers.get(row);
    if (timer) clearTimeout(timer);
    hoverTimers.delete(row);
    row.querySelector(".ai-hover-card")?.removeAttribute("data-open");
    row.classList.remove("ai-preview-open");
  }

  function refreshVisiblePreview(tender) {
    document.querySelectorAll(".tender-row.ai-preview-open").forEach((row) => {
      if (rowTender(row)?.notifyNo === tender.notifyNo) showPreview(row, tender);
    });
  }

  function enhanceRows() {
    const list = document.querySelector("#tender-list");
    if (!list) return;
    list.querySelectorAll(".tender-row").forEach((row) => {
      if (row.dataset.aiEnhanced === "true") return;
      const actions = row.querySelector(".tender-actions");
      const referenceButton = row.querySelector("[data-action='expand']") || row.querySelector("[data-action='save']");
      const id = referenceButton?.dataset.id;
      if (!actions || !id) return;
      row.dataset.aiEnhanced = "true";
      row.dataset.aiTenderId = id;

      const aiButton = document.createElement("button");
      aiButton.type = "button";
      aiButton.className = "ai-analysis-button";
      aiButton.dataset.aiOpen = id;
      aiButton.innerHTML = '<span>✦</span><span>Phân tích AI</span>';
      aiButton.title = "Chuyên viên đấu thầu Kiểu Việt phân tích mức độ phù hợp và khả năng thành công";
      actions.prepend(aiButton);

      const preview = document.createElement("aside");
      preview.className = "ai-hover-card";
      preview.setAttribute("aria-live", "polite");
      row.appendChild(preview);

      if (config.hoverEnabled && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        row.addEventListener("pointerenter", () => {
          const timer = setTimeout(async () => {
            await dataReady;
            const tender = rowTender(row);
            if (tender) showPreview(row, tender);
          }, Number(config.hoverDelayMs) || 650);
          hoverTimers.set(row, timer);
        });
        row.addEventListener("pointerleave", (event) => {
          if (event.relatedTarget && row.contains(event.relatedTarget)) return;
          hidePreview(row);
        });
      }
    });
  }

  async function loadData() {
    try {
      const [tenderPayload, analysisPayload] = await Promise.all([
        fetchJson(config.tenderDataUrl),
        fetchJson(config.analysesUrl).catch(() => ({ analyses: {} })),
      ]);
      for (const tender of tenderPayload.tenders || []) {
        tenderById.set(String(tender.id || ""), tender);
        tenderByNotifyNo.set(String(tender.notifyNo || ""), tender);
      }
      for (const [notifyNo, analysis] of Object.entries(analysisPayload.analyses || {})) {
        staticAnalyses.set(String(notifyNo), analysis);
      }
    } catch (error) {
      console.warn("Không tải được dữ liệu AI:", error);
    } finally {
      dataReadyResolve();
      enhanceRows();
    }
  }

  function bindEvents() {
    const list = document.querySelector("#tender-list");
    if (!list) return;
    list.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-ai-open]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      await dataReady;
      const tender = tenderById.get(String(button.dataset.aiOpen || ""));
      if (tender) openModal(tender);
    });
    const observer = new MutationObserver(enhanceRows);
    observer.observe(list, { childList: true, subtree: true });
  }

  function injectStylesheet() {
    if (document.querySelector('link[data-ai-analysis-style]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./ai-analysis.css";
    link.dataset.aiAnalysisStyle = "true";
    document.head.appendChild(link);
  }

  async function init() {
    injectStylesheet();
    ensureModal();
    bindEvents();
    enhanceRows();
    await loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    void init();
  }
})();
