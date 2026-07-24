(() => {
  "use strict";

  const config = {
    tenderDataUrl: "./data/tenders.json",
    detailsBaseUrl: "./data/details",
    hoverDelayMs: 550,
    ...(window.KIEU_VIET_AI_CONFIG || {}),
  };

  const tenderById = new Map();
  const detailCache = new Map();
  const analysisCache = new Map();
  const hoverTimers = new WeakMap();
  let modal = null;
  let activeTender = null;
  let dataReadyResolve;
  const dataReady = new Promise((resolve) => { dataReadyResolve = resolve; });

  const MEDICAL_KEYWORDS = [
    "thiết bị y tế", "máy siêu âm", "máy xét nghiệm", "máy thở", "máy điện tim",
    "máy nội soi", "phẫu thuật", "monitor", "x-quang", "ct scanner", "mri",
    "khí y tế", "hóa chất", "hoá chất", "sinh phẩm", "vật tư", "xét nghiệm",
  ];

  const SPECIALIZED_KEYWORDS = [
    "ct", "mri", "cộng hưởng từ", "x-quang", "x quang", "nội soi", "phẫu thuật",
    "huyết học", "sinh hóa", "sinh hoá", "miễn dịch", "pcr", "giải phẫu bệnh",
    "gây mê", "lọc máu", "hồi sức", "monitor", "siêu âm",
  ];

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("vi-VN")
      .replace(/\s+/g, " ")
      .trim();
  }

  function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
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

  function daysUntil(value) {
    const time = new Date(value || 0).getTime();
    if (!Number.isFinite(time)) return null;
    return (time - Date.now()) / 86_400_000;
  }

  function collectDetailItems(detail) {
    const technical = Array.isArray(detail?.technicalRequirements?.items)
      ? detail.technicalRequirements.items : [];
    const invited = Array.isArray(detail?.requirements?.items)
      ? detail.requirements.items : [];
    const awarded = Array.isArray(detail?.items) ? detail.items : [];

    const source = technical.length ? technical : (invited.length ? invited : awarded);
    return source
      .filter((item) => item && (item.name || item.lotName))
      .map((item) => ({
        name: String(item.name || item.lotName || "Mặt hàng y tế").replace(/\s+/g, " ").trim(),
        lotName: String(item.lotName || "").replace(/\s+/g, " ").trim(),
        quantity: Number(item.quantity) || 0,
        unit: String(item.unit || "").trim(),
        plannedPrice: Number(item.plannedPrice) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        model: String(item.model || item.code || "").trim(),
        brand: String(item.brand || "").trim(),
        manufacturer: String(item.manufacturer || "").trim(),
        origin: String(item.origin || "").trim(),
        specification: String(item.specification || item.otherRequirement || "").replace(/\s+/g, " ").trim(),
      }));
  }

  function equipmentImportance(item, index, total) {
    const text = normalize(`${item.name} ${item.lotName} ${item.specification}`);
    const amount = item.plannedPrice || item.unitPrice || 0;
    if (index === 0 || amount >= 1_000_000_000 || /\b(he thong|may|thiet bi)\b/.test(text)) return "Chủ đạo";
    if (total <= 5 || amount >= 200_000_000) return "Quan trọng";
    return "Phụ trợ";
  }

  function equipmentFit(item, baseTechnical, specialized) {
    const text = normalize(`${item.name} ${item.lotName} ${item.specification}`);
    let score = baseTechnical;
    if (MEDICAL_KEYWORDS.some((keyword) => text.includes(normalize(keyword)))) score += 7;
    if (/vat tu|hoa chat|sinh pham/.test(text)) score += 5;
    if (specialized && SPECIALIZED_KEYWORDS.some((keyword) => text.includes(normalize(keyword)))) score -= 5;
    if (item.model || item.brand || item.manufacturer) score += 4;
    return clamp(score);
  }

  function analyzeTender(tender, detail = null) {
    const items = collectDetailItems(detail);
    const text = normalize([
      tender?.name,
      tender?.category,
      tender?.location,
      tender?.investor,
      ...items.slice(0, 20).map((item) => `${item.name} ${item.specification}`),
    ].join(" "));

    const locationText = normalize(`${tender?.location || ""} ${tender?.investor || ""}`);
    const local = /gia lai|pleiku|quy nhon|binh dinh/.test(locationText);
    const medical = MEDICAL_KEYWORDS.some((keyword) => text.includes(normalize(keyword)));
    const specialized = SPECIALIZED_KEYWORDS.some((keyword) => text.includes(normalize(keyword)));
    const price = Number(tender?.price) || Number(tender?.winningPrice) || 0;
    const remainingDays = daysUntil(tender?.closeDate);
    const hasTechnical = Boolean(detail?.technicalRequirements?.items?.length);
    const hasInvited = Boolean(detail?.requirements?.items?.length);
    const captchaLimited = detail?.technicalRequirements?.disclosure === "official-captcha-required";
    const itemCount = items.length;
    const bidderCount = Number(tender?.bidderCount) || detail?.bidders?.length || 0;

    let legal = 38;
    if (medical) legal += 7;
    if (local) legal += 6;
    if (specialized) legal -= 4;
    legal = clamp(legal);

    let technical = 42;
    if (medical) technical += 11;
    if (local) technical += 5;
    if (itemCount) technical += Math.min(10, Math.ceil(itemCount / 3));
    if (hasTechnical) technical += 7;
    if (specialized) technical -= 5;
    technical = clamp(technical);

    let commercial = 52;
    if (!price) commercial = 40;
    else if (price <= 5_000_000_000) commercial = 68;
    else if (price <= 15_000_000_000) commercial = 57;
    else if (price <= 30_000_000_000) commercial = 44;
    else if (price <= 50_000_000_000) commercial = 32;
    else commercial = 20;
    if (itemCount > 25) commercial -= 5;
    commercial = clamp(commercial);

    let schedule = 50;
    if (remainingDays === null) schedule = 40;
    else if (remainingDays >= 21) schedule = 78;
    else if (remainingDays >= 14) schedule = 68;
    else if (remainingDays >= 7) schedule = 55;
    else if (remainingDays >= 3) schedule = 35;
    else if (remainingDays >= 0) schedule = 16;
    else schedule = 8;
    schedule = clamp(schedule);

    const geography = local ? 88 : 56;

    let partnership = 48;
    if (specialized) partnership -= 6;
    if (medical) partnership += 4;
    if (/vat tu|hoa chat|sinh pham/.test(text)) partnership += 5;
    if (price > 30_000_000_000) partnership -= 5;
    partnership = clamp(partnership);

    const dataScore =
      (hasTechnical ? 34 : 0) +
      (hasInvited ? 24 : 0) +
      (itemCount ? Math.min(25, itemCount * 2) : 0) +
      (price ? 10 : 0) +
      (tender?.closeDate ? 7 : 0);

    const overall = clamp(
      legal * 0.18 +
      technical * 0.24 +
      commercial * 0.18 +
      schedule * 0.14 +
      geography * 0.12 +
      partnership * 0.14,
    );

    let probability = clamp(overall * 0.72);
    if (!hasInvited && !hasTechnical) probability -= 6;
    if (captchaLimited) probability -= 4;
    if (price > 50_000_000_000) probability -= 5;
    if (remainingDays !== null && remainingDays < 3) probability -= 7;
    if (bidderCount >= 5) probability -= 4;
    probability = clamp(probability);

    const recommendation = overall >= 72 && probability >= 50
      ? "Ưu tiên khảo sát để tham gia"
      : overall >= 58
        ? "Tham gia có điều kiện"
        : overall >= 45
          ? "Theo dõi và làm rõ"
          : "Chưa khuyến nghị tham gia";

    const confidence = dataScore >= 70 ? "Khá" : dataScore >= 40 ? "Trung bình" : "Thấp";

    const primaryEquipment = items
      .slice()
      .sort((a, b) => (b.plannedPrice || b.unitPrice || 0) - (a.plannedPrice || a.unitPrice || 0))
      .slice(0, 8)
      .map((item, index) => {
        const importance = equipmentImportance(item, index, itemCount);
        const facts = [
          item.quantity ? `${new Intl.NumberFormat("vi-VN").format(item.quantity)} ${item.unit}`.trim() : "",
          item.model ? `Model/mã: ${item.model}` : "",
          item.brand ? `Nhãn hiệu: ${item.brand}` : "",
          item.plannedPrice ? `Giá phần/lô: ${formatMoney(item.plannedPrice)}` : "",
        ].filter(Boolean);
        return {
          name: item.name,
          importance,
          fit: equipmentFit(item, technical, specialized),
          note: facts.length
            ? facts.join(" · ")
            : "Cần mở E-HSMT để xác định đầy đủ cấu hình, tiêu chuẩn và điều kiện hãng.",
        };
      });

    const strengths = [];
    if (local) strengths.push("Lợi thế địa bàn Gia Lai/Quy Nhơn giúp khảo sát, giao nhận, lắp đặt và phối hợp hiện trường thuận lợi.");
    if (medical) strengths.push("Gói phù hợp định hướng thiết bị, vật tư và dịch vụ triển khai tại công trình y tế.");
    if (price && price <= 15_000_000_000) strengths.push("Quy mô giá dự toán ở mức có thể tiếp tục khảo sát về tài chính và phương án liên kết.");
    if (remainingDays !== null && remainingDays >= 14) strengths.push("Còn đủ thời gian ban đầu để rà soát E-HSMT, xin báo giá hãng và chuẩn bị hồ sơ.");
    if (hasTechnical || hasInvited) strengths.push(`Đã nhận diện được ${itemCount || 1} danh mục/phần lô để lập bảng đáp ứng.`);
    if (!strengths.length) strengths.push("Có thể dùng dữ liệu công khai hiện có để sàng lọc trước khi quyết định mua E-HSMT hoặc làm việc với hãng.");

    const gaps = [
      "Chưa xác minh giấy ủy quyền hãng hoặc quyền phân phối cho thiết bị chủ đạo.",
      "Chưa đối chiếu đầy đủ hợp đồng tương tự, doanh thu, báo cáo tài chính và hạn mức bảo lãnh theo E-HSMT.",
      "Chưa xác minh nhân sự kỹ thuật chuyên hãng, chứng chỉ đào tạo, bảo hành và thời gian đáp ứng dịch vụ.",
    ];
    if (!hasTechnical) gaps.unshift("Chưa đọc được toàn bộ bảng yêu cầu kỹ thuật E-HSMT từ nguồn công khai.");
    if (!itemCount) gaps.unshift("Chưa tách được danh mục thiết bị/vật tư chủ đạo của gói.");
    if (specialized) gaps.push("Thiết bị chuyên sâu cần kiểm tra chặt điều kiện hãng, cấu hình tương đương, phụ kiện, phần mềm và nghiệm thu.");

    const risks = [];
    if (remainingDays !== null && remainingDays < 7) risks.push("Thời gian còn lại ngắn, rủi ro không kịp xin ủy quyền hãng, báo giá và hoàn thiện hồ sơ.");
    if (price > 30_000_000_000) risks.push("Quy mô tài chính lớn, cần đánh giá vốn lưu động, bảo lãnh và điều khoản thanh toán.");
    if (itemCount > 20) risks.push("Danh mục nhiều mặt hàng làm tăng rủi ro thiếu báo giá, sai cấu hình hoặc không đồng bộ tiến độ giao hàng.");
    if (captchaLimited) risks.push("Nguồn công khai chưa cung cấp toàn bộ E-HSMT do yêu cầu xác nhận; kết quả phân tích còn giới hạn.");
    if (specialized) risks.push("Thiết bị chuyên sâu có nguy cơ bị ràng buộc bởi tiêu chí kỹ thuật, hãng, phụ kiện và dịch vụ sau bán hàng.");
    if (bidderCount >= 5) risks.push(`Mức cạnh tranh đã ghi nhận khoảng ${bidderCount} nhà thầu.`);
    if (!risks.length) risks.push("Rủi ro chính vẫn là thiếu dữ liệu chính thức về tiêu chí đạt/không đạt và giá vốn thực tế.");

    const partners = [
      "Hãng hoặc nhà phân phối được ủy quyền cho thiết bị/vật tư chủ đạo.",
      "Đơn vị kỹ thuật có khả năng lắp đặt, đào tạo, bảo hành và xử lý sự cố tại Gia Lai.",
    ];
    if (price > 15_000_000_000) partners.push("Ngân hàng hoặc đối tác tài chính hỗ trợ bảo lãnh và vốn lưu động.");
    if (itemCount > 10) partners.push("Nhà cung cấp phụ trợ để gom đủ danh mục, chứng từ CO/CQ và tiến độ giao hàng.");
    if (specialized) partners.push("Chuyên gia sản phẩm hoặc kỹ sư hãng để lập bảng đáp ứng kỹ thuật và phương án nghiệm thu.");

    const actions = [
      "Mở E-HSMT chính thức và lập bảng tiêu chí đạt/không đạt theo từng mục năng lực, kỹ thuật và thương mại.",
      primaryEquipment.length
        ? `Ưu tiên làm việc trước với hãng/nhà phân phối của: ${primaryEquipment.slice(0, 3).map((item) => item.name).join("; ")}.`
        : "Xác định danh mục thiết bị/vật tư chủ đạo và hãng có thể cung cấp.",
      "Kiểm tra hợp đồng tương tự, nhân sự kỹ thuật, giấy phép, chứng chỉ và phạm vi bảo hành đang có.",
      "Lập bảng giá vốn, thuế, vận chuyển, lắp đặt, đào tạo, bảo hành và biên lợi nhuận tối thiểu.",
      "Đánh giá thời gian nhập hàng, giao hàng và khả năng đáp ứng trước ngày đóng thầu.",
    ];
    if (remainingDays !== null && remainingDays < 7) actions.unshift("Tổ chức quyết định tham gia/không tham gia trong 24 giờ vì thời gian chuẩn bị ngắn.");
    if (price > 15_000_000_000) actions.push("Làm việc sớm với ngân hàng về hạn mức bảo lãnh dự thầu, thực hiện hợp đồng và tạm ứng.");

    const dataQuality = [
      hasTechnical ? `${detail.technicalRequirements.items.length} dòng kỹ thuật` : "chưa có bảng kỹ thuật đầy đủ",
      hasInvited ? `${detail.requirements.items.length} phần/lô mời thầu` : "chưa tách phần/lô",
      price ? `giá dự toán ${formatMoney(price)}` : "chưa có giá dự toán",
    ].join(" · ");

    return {
      overall_score: overall,
      success_probability: probability,
      recommendation,
      confidence,
      executive_summary: `${recommendation}. Điểm phù hợp hiện tại ${overall}/100; khả năng thành công ước tính ${probability}%. Kết quả dựa trên hồ sơ công khai, quy mô gói, thời gian còn lại, địa bàn và các khoảng trống năng lực chưa xác minh.`,
      fit: { legal, technical, commercial, schedule, geography, partnership },
      primary_equipment: primaryEquipment,
      strengths: unique(strengths).slice(0, 7),
      gaps: unique(gaps).slice(0, 8),
      risks: unique(risks).slice(0, 8),
      required_partners: unique(partners).slice(0, 7),
      next_actions: unique(actions).slice(0, 10),
      assumptions: [
        "Chưa coi giấy ủy quyền hãng, năng lực tài chính, nhân sự hoặc hợp đồng tương tự là đã đáp ứng khi chưa có tài liệu xác minh.",
        "Xác suất thành công là chỉ báo sàng lọc quản trị, không phải dự báo chắc chắn kết quả lựa chọn nhà thầu.",
      ],
      data_quality: dataQuality,
      disclaimer: "Phân tích tự động miễn phí, không sử dụng OpenAI. E-HSMT và tài liệu pháp lý chính thức là căn cứ cuối cùng.",
      source: "free-local-analysis",
      generatedAt: new Date().toISOString(),
    };
  }

  function recommendationClass(recommendation) {
    const value = normalize(recommendation);
    if (value.includes("uu tien")) return "positive";
    if (value.includes("co dieu kien")) return "conditional";
    if (value.includes("theo doi")) return "watch";
    return "negative";
  }

  function previewMarkup(tender, analysis) {
    return `
      <div class="ai-preview-head">
        <span class="ai-spark">✦</span>
        <div><b>Phân tích đấu thầu Kiểu Việt</b><small>Miễn phí · dữ liệu công khai</small></div>
        <strong>${clamp(analysis.overall_score)}</strong>
      </div>
      <div class="ai-preview-recommendation ${recommendationClass(analysis.recommendation)}">${escapeHtml(analysis.recommendation)}</div>
      <p>${escapeHtml(analysis.executive_summary)}</p>
      <div class="ai-preview-facts">
        <span>Khả năng thành công <b>${clamp(analysis.success_probability)}%</b></span>
        <span>Độ tin cậy <b>${escapeHtml(analysis.confidence)}</b></span>
      </div>
      <div class="ai-preview-note">Không gọi API trả phí. Bấm để xem thiết bị chủ đạo, rủi ro và việc cần làm.</div>
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
    if (!values.length) return '<p class="ai-empty">Dữ liệu công khai chưa tách được thiết bị/vật tư chủ đạo.</p>';
    return `<div class="ai-equipment-list">${values.map((item) => `
      <article>
        <div><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.importance)}</span></div>
        <strong>${clamp(item.fit)}%</strong>
        <p>${escapeHtml(item.note)}</p>
      </article>`).join("")}</div>`;
  }

  function fullAnalysisMarkup(tender, analysis) {
    const fit = analysis.fit || {};
    return `
      <div class="ai-modal-summary">
        <div class="ai-score-ring" style="--score:${clamp(analysis.overall_score)}"><strong>${clamp(analysis.overall_score)}</strong><span>/100</span></div>
        <div class="ai-modal-copy">
          <span class="ai-source-chip">Phân tích miễn phí</span>
          <h3>${escapeHtml(analysis.recommendation)}</h3>
          <p>${escapeHtml(analysis.executive_summary)}</p>
          <div class="ai-success-line"><span>Khả năng thành công ước tính</span><b>${clamp(analysis.success_probability)}%</b><i><em style="width:${clamp(analysis.success_probability)}%"></em></i></div>
        </div>
      </div>
      <div class="ai-tender-context">
        <span><b>${escapeHtml(tender.notifyNo || "")}</b></span>
        <span>${escapeHtml(tender.investor || "")}</span>
        <span>${escapeHtml(formatMoney(tender.price || tender.winningPrice))}</span>
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
      <section class="ai-section"><h4>Thiết bị/vật tư chủ đạo</h4>${equipmentList(analysis.primary_equipment)}</section>
      <div class="ai-two-column">
        <section class="ai-section ai-positive-list"><h4>Điểm mạnh</h4>${stringList(analysis.strengths, "Chưa xác định được điểm mạnh cụ thể.")}</section>
        <section class="ai-section ai-gap-list"><h4>Khoảng trống hồ sơ</h4>${stringList(analysis.gaps, "Chưa xác định được khoảng trống.")}</section>
        <section class="ai-section ai-risk-list"><h4>Rủi ro chính</h4>${stringList(analysis.risks, "Chưa xác định được rủi ro cụ thể.")}</section>
        <section class="ai-section"><h4>Đối tác cần có</h4>${stringList(analysis.required_partners, "Chưa xác định yêu cầu liên kết.")}</section>
      </div>
      <section class="ai-section ai-actions"><h4>Việc cần làm trong 24–72 giờ</h4>${stringList(analysis.next_actions, "Mở E-HSMT chính thức và rà soát tiêu chí đánh giá.")}</section>
      <details class="ai-assumptions"><summary>Dữ liệu, giả định và giới hạn</summary>
        <p><b>Chất lượng dữ liệu:</b> ${escapeHtml(analysis.data_quality)}</p>
        ${stringList(analysis.assumptions, "Không có giả định được nêu.")}
      </details>
      <p class="ai-disclaimer">${escapeHtml(analysis.disclaimer)}</p>
      <p class="ai-generated-at">Tạo lúc ${escapeHtml(formatDate(analysis.generatedAt, true))}</p>`;
  }

  function loadingMarkup(tender) {
    return `
      <div class="ai-modal-summary">
        <div class="ai-score-ring" style="--score:0"><strong>…</strong><span>/100</span></div>
        <div class="ai-modal-copy">
          <span class="ai-source-chip">Đang đọc dữ liệu</span>
          <h3>Đang phân tích gói thầu</h3>
          <p>Hệ thống đang đọc danh mục mời thầu, thông số kỹ thuật và thông tin công khai của ${escapeHtml(tender.notifyNo || "gói này")}.</p>
        </div>
      </div>`;
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
          <div><span>✦ PHÂN TÍCH ĐẤU THẦU KIỂU VIỆT</span><h2 id="ai-modal-title">Phân tích gói thầu</h2></div>
          <button type="button" data-ai-close aria-label="Đóng">×</button>
        </header>
        <div class="ai-modal-body"></div>
        <footer>
          <span class="ai-live-status">Chế độ miễn phí · không gọi API · không phát sinh chi phí.</span>
          <button type="button" class="ai-close-button" data-ai-close>Đóng</button>
        </footer>
      </section>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-ai-close]")) closeModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) closeModal();
    });
    return modal;
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.documentElement.classList.remove("ai-modal-open");
    activeTender = null;
  }

  async function loadDetail(tender) {
    const notifyNo = String(tender.notifyNo || "");
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

  async function getAnalysis(tender, useDetail = true) {
    const cacheKey = `${tender.notifyNo || tender.id}:${useDetail ? "full" : "quick"}`;
    if (analysisCache.has(cacheKey)) return analysisCache.get(cacheKey);
    const detail = useDetail ? await loadDetail(tender) : null;
    const analysis = analyzeTender(tender, detail);
    analysisCache.set(cacheKey, analysis);
    return analysis;
  }

  async function openModal(tender) {
    activeTender = tender;
    const target = ensureModal();
    target.querySelector("#ai-modal-title").textContent = tender.name || "Phân tích gói thầu";
    target.querySelector(".ai-modal-body").innerHTML = loadingMarkup(tender);
    target.hidden = false;
    document.documentElement.classList.add("ai-modal-open");
    requestAnimationFrame(() => target.querySelector("[data-ai-close]")?.focus());

    const analysis = await getAnalysis(tender, true);
    if (activeTender?.id !== tender.id || target.hidden) return;
    target.querySelector(".ai-modal-body").innerHTML = fullAnalysisMarkup(tender, analysis);
  }

  function rowTender(row) {
    const id = row.querySelector("[data-action='expand']")?.dataset.id
      || row.querySelector("[data-action='save']")?.dataset.id
      || row.dataset.analysisTenderId;
    return tenderById.get(String(id || "")) || null;
  }

  async function showPreview(row, tender) {
    const card = row.querySelector(".ai-hover-card");
    if (!card) return;
    const quick = await getAnalysis(tender, false);
    card.innerHTML = previewMarkup(tender, quick);
    card.dataset.open = "true";
    row.classList.add("ai-preview-open");

    const full = await getAnalysis(tender, true);
    if (!row.classList.contains("ai-preview-open")) return;
    card.innerHTML = previewMarkup(tender, full);
  }

  function hidePreview(row) {
    const timer = hoverTimers.get(row);
    if (timer) clearTimeout(timer);
    hoverTimers.delete(row);
    row.querySelector(".ai-hover-card")?.removeAttribute("data-open");
    row.classList.remove("ai-preview-open");
  }

  function enhanceRows() {
    const list = document.querySelector("#tender-list");
    if (!list) return;

    list.querySelectorAll(".tender-row").forEach((row) => {
      if (row.dataset.analysisEnhanced === "true") return;
      const actions = row.querySelector(".tender-actions");
      const referenceButton = row.querySelector("[data-action='expand']") || row.querySelector("[data-action='save']");
      const id = referenceButton?.dataset.id;
      if (!actions || !id) return;

      row.dataset.analysisEnhanced = "true";
      row.dataset.analysisTenderId = id;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "ai-analysis-button";
      button.dataset.aiOpen = id;
      button.innerHTML = "<span>✦</span><span>Phân tích miễn phí</span>";
      button.title = "Phân tích mức độ phù hợp, thiết bị chủ đạo, rủi ro và khả năng tham gia";
      actions.prepend(button);

      const preview = document.createElement("aside");
      preview.className = "ai-hover-card";
      preview.setAttribute("aria-live", "polite");
      row.appendChild(preview);

      if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        row.addEventListener("pointerenter", () => {
          const timer = setTimeout(async () => {
            await dataReady;
            const tender = rowTender(row);
            if (tender) await showPreview(row, tender);
          }, Number(config.hoverDelayMs) || 550);
          hoverTimers.set(row, timer);
        });
        row.addEventListener("pointerleave", (event) => {
          if (event.relatedTarget && row.contains(event.relatedTarget)) return;
          hidePreview(row);
        });
      }
    });
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
      if (tender) await openModal(tender);
    });
    new MutationObserver(enhanceRows).observe(list, { childList: true, subtree: true });
  }

  async function loadData() {
    try {
      const payload = await fetchJson(config.tenderDataUrl);
      for (const tender of payload.tenders || []) {
        tenderById.set(String(tender.id || ""), tender);
      }
    } catch (error) {
      console.warn("Không tải được dữ liệu phân tích:", error);
    } finally {
      dataReadyResolve();
      enhanceRows();
    }
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
