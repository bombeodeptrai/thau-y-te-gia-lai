(() => {
  "use strict";

  const config = {
    tenderDataUrl: "./data/tenders.json",
    intelligenceUrl: "./data/competitor-intelligence.json",
    detailsBaseUrl: "./data/details",
    ...(window.KIEU_VIET_AI_CONFIG || {}),
  };

  const tenderById = new Map();
  const detailCache = new Map();
  let intelligence = { records: [] };
  let activeTenderId = "";
  let renderVersion = 0;
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });

  const STOP_WORDS = new Set([
    "mua", "sam", "goi", "thau", "cung", "cap", "nam", "lan", "phuc", "vu",
    "cho", "cua", "tai", "cac", "va", "theo", "thuoc", "trung", "tam", "benh",
    "vien", "tinh", "gia", "lai", "quy", "nhon", "bo", "sung", "hoat", "dong",
    "danh", "muc", "phan", "lo", "so", "voi", "tren", "duoi", "thuc", "hien",
  ]);

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("vi-VN")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
  }

  function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function tokens(value) {
    return new Set(
      normalize(value)
        .split(" ")
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
    );
  }

  function intersectionSize(left, right) {
    let count = 0;
    for (const value of left) if (right.has(value)) count += 1;
    return count;
  }

  function jaccard(left, right) {
    if (!left.size || !right.size) return 0;
    const intersection = intersectionSize(left, right);
    return intersection / Math.max(1, left.size + right.size - intersection);
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

  function formatDate(value) {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return "Chưa công bố";
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  }

  function recordTime(record) {
    return new Date(record?.decisionDate || record?.publicDate || 0).getTime() || 0;
  }

  function isRegional(record) {
    return /gia lai|pleiku|quy nhon|binh dinh|an khe|ayun pa/.test(
      normalize(`${record?.location || ""} ${record?.investor || ""}`),
    );
  }

  function ownCompany(name) {
    return /kieu viet/.test(normalize(name));
  }

  async function fetchJson(url) {
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(`${url}${separator}v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function loadDetail(tender) {
    const notifyNo = String(tender?.notifyNo || "");
    if (!notifyNo) return null;
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

  function currentItems(detail) {
    const technical = Array.isArray(detail?.technicalRequirements?.items)
      ? detail.technicalRequirements.items : [];
    const invited = Array.isArray(detail?.requirements?.items)
      ? detail.requirements.items : [];
    const awarded = Array.isArray(detail?.items) ? detail.items : [];
    const source = technical.length ? technical : (invited.length ? invited : awarded);
    return source.slice(0, 40).map((item) => ({
      name: String(item?.name || item?.lotName || "").replace(/\s+/g, " ").trim(),
      model: String(item?.model || item?.code || "").replace(/\s+/g, " ").trim(),
      brand: String(item?.brand || "").replace(/\s+/g, " ").trim(),
      specification: String(item?.specification || item?.otherRequirement || "")
        .replace(/\s+/g, " ").trim(),
    })).filter((item) => item.name || item.model || item.brand);
  }

  function equipmentText(equipment) {
    return (equipment || [])
      .map((item) => `${item.name || ""} ${item.model || ""} ${item.brand || ""} ${item.manufacturer || ""}`)
      .join(" ");
  }

  function similarityScore(tender, currentEquipment, record) {
    const titleScore = jaccard(tokens(tender?.name), tokens(record?.name));
    const equipmentScore = jaccard(
      tokens(currentEquipment.map((item) => `${item.name} ${item.model} ${item.brand}`).join(" ")),
      tokens(equipmentText(record?.equipment)),
    );
    const sameCategory = normalize(tender?.category) === normalize(record?.category) ? 1 : 0;
    const sameLocation = intersectionSize(tokens(tender?.location), tokens(record?.location)) > 0 ? 1 : 0;
    return clamp(
      titleScore * 48
      + equipmentScore * 30
      + sameCategory * 16
      + sameLocation * 6,
    );
  }

  function historyForTender(tender, detail) {
    const records = intelligence.records || [];
    const investorKey = normalize(tender?.investor);
    const currentEquipment = currentItems(detail);

    const sameInvestor = records
      .filter((record) => record.notifyNo !== tender.notifyNo && normalize(record.investor) === investorKey)
      .sort((left, right) => recordTime(right) - recordTime(left))
      .slice(0, 10);

    const similar = records
      .filter((record) => record.notifyNo !== tender.notifyNo)
      .filter((record) => isRegional(record))
      .filter((record) => normalize(record.investor) !== investorKey)
      .map((record) => ({ record, score: similarityScore(tender, currentEquipment, record) }))
      .filter((item) => item.score >= 18)
      .sort((left, right) => right.score - left.score || recordTime(right.record) - recordTime(left.record))
      .slice(0, 10);

    return { currentEquipment, sameInvestor, similar };
  }

  function competitorStats(tender, context) {
    const byName = new Map();
    const currentTerms = tokens([
      tender?.name,
      ...context.currentEquipment.map((item) => `${item.name} ${item.model} ${item.brand}`),
    ].join(" "));

    const ensure = (name) => {
      const key = normalize(name);
      if (!key || ownCompany(name)) return null;
      if (!byName.has(key)) {
        byName.set(key, {
          name,
          sameInvestorWins: 0,
          sameInvestorBids: 0,
          similarWins: 0,
          similarBids: 0,
          totalValue: 0,
          latestTime: 0,
          equipment: [],
          recordNos: new Set(),
        });
      }
      return byName.get(key);
    };

    const consume = (record, group) => {
      const winners = unique(record.winnerNames || []);
      for (const winner of winners) {
        const stat = ensure(winner);
        if (!stat) continue;
        if (!stat.recordNos.has(record.notifyNo)) {
          if (group === "same") stat.sameInvestorWins += 1;
          else stat.similarWins += 1;
          stat.totalValue += Number(record.winningPrice) || 0;
          stat.latestTime = Math.max(stat.latestTime, recordTime(record));
          stat.recordNos.add(record.notifyNo);
        }
        stat.equipment.push(...(record.equipment || []));
      }

      for (const participant of record.participants || []) {
        const stat = ensure(participant.name);
        if (!stat) continue;
        if (group === "same") stat.sameInvestorBids += 1;
        else stat.similarBids += 1;
      }
    };

    context.sameInvestor.forEach((record) => consume(record, "same"));
    context.similar.forEach(({ record }) => consume(record, "similar"));

    const now = Date.now();
    return [...byName.values()].map((stat) => {
      const equipmentTerms = tokens(equipmentText(stat.equipment));
      const overlap = jaccard(currentTerms, equipmentTerms);
      const ageDays = stat.latestTime ? (now - stat.latestTime) / 86_400_000 : 9999;
      const recencyBonus = ageDays <= 365 ? 9 : ageDays <= 730 ? 5 : ageDays <= 1095 ? 2 : 0;
      const score = clamp(
        14
        + stat.sameInvestorWins * 19
        + Math.min(4, stat.sameInvestorBids) * 4
        + stat.similarWins * 10
        + Math.min(5, stat.similarBids) * 2
        + overlap * 22
        + recencyBonus,
      );
      const level = score >= 78 ? "Rất cao" : score >= 62 ? "Cao" : score >= 42 ? "Trung bình" : "Thấp";
      const models = unique(
        stat.equipment.flatMap((item) => {
          const model = [item.model, item.brand].filter(Boolean).join(" · ");
          return model ? [`${item.name || "Thiết bị"}: ${model}`] : (item.name ? [item.name] : []);
        }),
      ).slice(0, 6);
      const evaluation = stat.sameInvestorWins >= 2
        ? "Đối thủ quen thuộc tại đơn vị, có lợi thế lịch sử thực hiện và hiểu yêu cầu mua sắm."
        : stat.sameInvestorWins === 1
          ? "Đã từng trúng tại chính đơn vị; cần kiểm tra hãng, giá và phạm vi mặt hàng họ thường cung cấp."
          : stat.similarWins >= 2
            ? "Có lịch sử trúng nhiều gói tương tự trong khu vực, khả năng cạnh tranh về hãng và giá đáng chú ý."
            : stat.similarWins === 1
              ? "Đã có ít nhất một kết quả tương tự trong khu vực; nên theo dõi báo giá và model đã chào."
              : "Mới ghi nhận tham dự hoặc dữ liệu thắng thầu còn ít.";
      return { ...stat, score, level, models, evaluation, overlap };
    }).sort((left, right) => right.score - left.score || right.sameInvestorWins - left.sameInvestorWins);
  }

  function marketAssessment(competitors, context, baseProbability) {
    const topScore = competitors[0]?.score || 0;
    const strongCount = competitors.filter((item) => item.score >= 62).length;
    const sameInvestorWins = competitors.reduce((sum, item) => sum + item.sameInvestorWins, 0);
    let level = "Thấp";
    let penalty = 2;
    if (topScore >= 78 || strongCount >= 3 || sameInvestorWins >= 6) {
      level = "Rất cao";
      penalty = 16;
    } else if (topScore >= 62 || strongCount >= 1 || sameInvestorWins >= 3) {
      level = "Cao";
      penalty = 11;
    } else if (topScore >= 42 || competitors.length >= 3) {
      level = "Trung bình";
      penalty = 6;
    }
    const adjusted = baseProbability === null ? null : clamp(baseProbability - penalty, 5, 95);
    const note = level === "Rất cao"
      ? "Có đối thủ đã thắng nhiều lần tại đơn vị hoặc có lịch sử mạnh ở nhóm thiết bị tương tự. Chỉ nên tham gia khi chốt được hãng, giá và hồ sơ năng lực nổi trội."
      : level === "Cao"
        ? "Cạnh tranh đáng kể. Cần đối chiếu model đã trúng, giá lịch sử và chuẩn bị phương án liên danh/ủy quyền hãng sớm."
        : level === "Trung bình"
          ? "Có đối thủ đã được ghi nhận nhưng chưa hình thành ưu thế áp đảo. Cần tạo khác biệt bằng cấu hình, dịch vụ và giá."
          : "Dữ liệu hiện có chưa cho thấy đối thủ áp đảo; vẫn phải kiểm tra đầy đủ E-HSMT và giá vốn.";
    return { level, penalty, adjusted, note, sampled: context.sameInvestor.length + context.similar.length };
  }

  function threatClass(level) {
    return normalize(level).replaceAll(" ", "-");
  }

  function modelChips(models) {
    if (!models?.length) return '<span class="competitor-empty-inline">Chưa công bố model/hãng</span>';
    return `<div class="competitor-models">${models.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
  }

  function competitorCards(competitors) {
    if (!competitors.length) {
      return '<p class="competitor-empty">Chưa tìm thấy tên nhà thầu thắng hoặc tham dự trong nhóm hồ sơ đối chiếu.</p>';
    }
    return `<div class="competitor-ranking">${competitors.slice(0, 8).map((item, index) => `
      <article class="competitor-card">
        <div class="competitor-rank">${index + 1}</div>
        <div class="competitor-card-main">
          <div class="competitor-name-line">
            <h5>${escapeHtml(item.name)}</h5>
            <span class="competitor-threat ${threatClass(item.level)}">${escapeHtml(item.level)}</span>
          </div>
          <div class="competitor-stat-line">
            <span><b>${item.sameInvestorWins}</b> thắng tại đơn vị</span>
            <span><b>${item.similarWins}</b> thắng gói tương tự</span>
            <span><b>${item.sameInvestorBids + item.similarBids}</b> lượt tham dự ghi nhận</span>
            <span><b>${escapeHtml(formatMoney(item.totalValue))}</b> giá trị trúng đã biết</span>
          </div>
          <p>${escapeHtml(item.evaluation)}</p>
          ${modelChips(item.models)}
        </div>
        <div class="competitor-score"><strong>${item.score}</strong><span>/100</span></div>
      </article>`).join("")}</div>`;
  }

  function recordEquipment(record) {
    const values = unique((record.equipment || []).flatMap((item) => {
      const model = [item.model, item.brand].filter(Boolean).join(" · ");
      if (model) return [`${item.name || "Thiết bị"}: ${model}`];
      return item.name ? [item.name] : [];
    })).slice(0, 5);
    return values.length ? values.join("; ") : "Chưa công bố chi tiết thiết bị/model";
  }

  function historyRecords(records, showSimilarity = false) {
    if (!records.length) {
      return '<p class="competitor-empty">Chưa có đủ dữ liệu công khai phù hợp trong bộ dữ liệu đang lưu.</p>';
    }
    return `<div class="competitor-history-list">${records.map((entry, index) => {
      const record = showSimilarity ? entry.record : entry;
      const similarity = showSimilarity ? `<span class="similarity-chip">Tương đồng ${entry.score}%</span>` : "";
      return `<article class="competitor-history-item">
        <div class="competitor-history-index">${index + 1}</div>
        <div class="competitor-history-copy">
          <div class="competitor-history-meta"><span>${escapeHtml(formatDate(record.decisionDate || record.publicDate))}</span><span>${escapeHtml(record.notifyNo)}</span>${similarity}</div>
          <h5>${escapeHtml(record.name)}</h5>
          <p><b>Đơn vị:</b> ${escapeHtml(record.investor)} · <b>Trúng:</b> ${escapeHtml((record.winnerNames || []).join("; ") || "Chưa xác định")}</p>
          <p><b>Thiết bị/hóa chất/model:</b> ${escapeHtml(recordEquipment(record))}</p>
        </div>
        <div class="competitor-history-value"><strong>${escapeHtml(formatMoney(record.winningPrice))}</strong>${record.sourceUrl ? `<a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noreferrer">Nguồn ↗</a>` : ""}</div>
      </article>`;
    }).join("")}</div>`;
  }

  function baseProbabilityFromModal(body) {
    const text = body.querySelector(".ai-success-line b")?.textContent || "";
    const value = Number(text.replace(/[^0-9]/g, ""));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function fullMarkup(tender, context, competitors, market, baseProbability) {
    const uniqueCompetitors = competitors.length;
    const modelCount = unique(competitors.flatMap((item) => item.models || [])).length;
    const adjustedLine = market.adjusted === null
      ? "Chưa đủ điểm cơ sở để điều chỉnh"
      : `${market.adjusted}% sau khi trừ ${market.penalty} điểm áp lực cạnh tranh từ mức cơ sở ${baseProbability}%`;

    return `<section class="competitor-intelligence" data-notify-no="${escapeHtml(tender.notifyNo)}">
      <div class="competitor-heading">
        <div><span>ĐỐI THỦ & LỊCH SỬ TRÚNG THẦU</span><h4>Đối chiếu 10 gói gần nhất tại đơn vị và gói tương tự trong khu vực</h4></div>
        <span class="market-level ${threatClass(market.level)}">Cạnh tranh ${escapeHtml(market.level)}</span>
      </div>

      <div class="competitor-summary-grid">
        <div><strong>${context.sameInvestor.length}</strong><span>gói trúng gần nhất tại đơn vị</span></div>
        <div><strong>${context.similar.length}</strong><span>gói tương tự trong khu vực</span></div>
        <div><strong>${uniqueCompetitors}</strong><span>đối thủ/nhà thầu được nhận diện</span></div>
        <div><strong>${modelCount}</strong><span>thiết bị, model hoặc hãng đã ghi nhận</span></div>
      </div>

      <div class="competition-decision">
        <div><span>Khả năng sau đối chiếu cạnh tranh</span><strong>${escapeHtml(adjustedLine)}</strong></div>
        <p>${escapeHtml(market.note)}</p>
      </div>

      <section class="competitor-block">
        <div class="competitor-block-title"><h4>Xếp hạng đối thủ</h4><span>Điểm cao khi đã thắng tại đơn vị, thắng gói tương tự, có model/hãng trùng nhóm và kết quả còn mới.</span></div>
        ${competitorCards(competitors)}
      </section>

      <details class="competitor-details" open>
        <summary>10 gói gần nhất đã có kết quả tại ${escapeHtml(tender.investor || "đơn vị")}</summary>
        ${historyRecords(context.sameInvestor)}
      </details>

      <details class="competitor-details">
        <summary>10 gói tương tự đã trúng trong Gia Lai, Quy Nhơn và khu vực lân cận</summary>
        ${historyRecords(context.similar, true)}
      </details>

      <p class="competitor-disclaimer">Nguồn: dữ liệu đấu thầu công khai đang lưu trên website. Xếp hạng phản ánh lịch sử thắng/tham dự, mức tương đồng thiết bị và độ mới của kết quả; không khẳng định quan hệ độc quyền, năng lực hiện tại hoặc chắc chắn nhà thầu sẽ tham dự gói mới.</p>
    </section>`;
  }

  function quickContext(tender) {
    const context = historyForTender(tender, null);
    const names = new Set();
    for (const record of context.sameInvestor) (record.winnerNames || []).forEach((name) => names.add(normalize(name)));
    for (const item of context.similar.slice(0, 5)) (item.record.winnerNames || []).forEach((name) => names.add(normalize(name)));
    names.delete("");
    return { same: context.sameInvestor.length, similar: context.similar.length, competitors: names.size };
  }

  function updateHoverCards() {
    document.querySelectorAll(".tender-row .ai-hover-card[data-open='true']").forEach((card) => {
      if (card.querySelector(".competitor-hover-hint")) return;
      const row = card.closest(".tender-row");
      const id = row?.dataset.analysisTenderId
        || row?.querySelector("[data-ai-open]")?.dataset.aiOpen
        || row?.querySelector("[data-action='expand']")?.dataset.id;
      const tender = tenderById.get(String(id || ""));
      if (!tender) return;
      const quick = quickContext(tender);
      const hint = document.createElement("div");
      hint.className = "competitor-hover-hint";
      hint.textContent = `${quick.competitors} đối thủ · ${quick.same} gói tại đơn vị · ${quick.similar} gói tương tự`;
      card.querySelector(".ai-preview-facts")?.after(hint);
    });
  }

  async function renderIntoModal() {
    const tender = tenderById.get(String(activeTenderId || ""));
    const modal = document.querySelector(".ai-modal:not([hidden])");
    const body = modal?.querySelector(".ai-modal-body");
    if (!tender || !body) return;
    if (body.querySelector(".competitor-intelligence")) return;
    if (/Đang phân tích gói thầu|Đang đọc dữ liệu/.test(body.textContent || "")) return;

    const version = ++renderVersion;
    const loading = document.createElement("section");
    loading.className = "competitor-intelligence competitor-loading";
    loading.innerHTML = '<span></span><p>Đang đối chiếu lịch sử nhà thầu, thiết bị và model đã trúng…</p>';
    body.appendChild(loading);

    const detail = await loadDetail(tender);
    if (version !== renderVersion || activeTenderId !== tender.id || !document.body.contains(body)) return;

    const context = historyForTender(tender, detail);
    const competitors = competitorStats(tender, context);
    const baseProbability = baseProbabilityFromModal(body);
    const market = marketAssessment(competitors, context, baseProbability);
    loading.outerHTML = fullMarkup(tender, context, competitors, market, baseProbability);
  }

  function scheduleRender() {
    window.clearTimeout(scheduleRender.timer);
    scheduleRender.timer = window.setTimeout(() => {
      void ready.then(() => {
        updateHoverCards();
        return renderIntoModal();
      });
    }, 90);
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const analysisButton = event.target.closest("[data-ai-open]");
      if (analysisButton) {
        activeTenderId = String(analysisButton.dataset.aiOpen || "");
        renderVersion += 1;
        scheduleRender();
        return;
      }
      if (event.target.closest("[data-ai-close]")) {
        window.setTimeout(() => {
          activeTenderId = "";
          renderVersion += 1;
        }, 0);
      }
    }, true);

    new MutationObserver(scheduleRender).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "data-open"],
    });
  }

  async function loadData() {
    try {
      const [tenderPayload, intelligencePayload] = await Promise.all([
        fetchJson(config.tenderDataUrl),
        fetchJson(config.intelligenceUrl).catch(() => ({ records: [] })),
      ]);
      for (const tender of tenderPayload.tenders || []) {
        tenderById.set(String(tender.id || ""), tender);
      }
      intelligence = intelligencePayload && Array.isArray(intelligencePayload.records)
        ? intelligencePayload
        : { records: [] };
    } catch (error) {
      console.warn("Không tải được dữ liệu đối thủ:", error);
    } finally {
      readyResolve();
      scheduleRender();
    }
  }

  function init() {
    bindEvents();
    void loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
