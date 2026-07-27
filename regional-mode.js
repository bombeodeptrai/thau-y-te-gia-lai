(() => {
  "use strict";

  const REGION_CONFIG_URL = "./data/regions.json";
  const COVERAGE_URL = "./data/region-coverage.json";
  const PREFS_KEY = "central-medical-tender-search-preferences-v1";
  const DEFAULT_REGION = "gia-lai";

  let regionConfig = [];
  let coverage = null;
  let basePeriodTenders;
  let baseFilteredTenders;
  let baseTenderMarkup;

  function escapeText(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function readPreferences() {
    const params = new URLSearchParams(location.search);
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    } catch {
      saved = {};
    }
    return {
      region: params.get("region") || saved.region || DEFAULT_REGION,
      sort: params.get("sort") || saved.sort || "newest",
      minBudget: params.get("min") || saved.minBudget || "",
      maxBudget: params.get("max") || saved.maxBudget || "",
      investorText: params.get("investor") || saved.investorText || "",
    };
  }

  function writePreferences() {
    const value = {
      region: state.regionSlug || DEFAULT_REGION,
      sort: state.advancedSort || "newest",
      minBudget: state.minBudgetBillion || "",
      maxBudget: state.maxBudgetBillion || "",
      investorText: state.investorText || "",
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(value));
    const params = new URLSearchParams(location.search);
    const values = {
      region: value.region === DEFAULT_REGION ? "" : value.region,
      sort: value.sort === "newest" ? "" : value.sort,
      min: value.minBudget,
      max: value.maxBudget,
      investor: value.investorText,
    };
    Object.entries(values).forEach(([key, item]) => {
      if (item) params.set(key, item);
      else params.delete(key);
    });
    const query = params.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  }

  async function fetchJson(url, fallback) {
    try {
      const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return fallback;
      return await response.json();
    } catch {
      return fallback;
    }
  }

  function currentRegion() {
    return regionConfig.find((item) => item.slug === state.regionSlug) || null;
  }

  function updatePageIdentity() {
    const region = currentRegion();
    const label = region?.shortName || region?.name || "miền Trung";
    const allRegions = state.regionSlug === "all";
    const title = allRegions
      ? "Theo dõi cơ hội thầu thiết bị y tế khu vực miền Trung"
      : `Theo dõi cơ hội thầu thiết bị y tế tại ${label}`;
    const heroTitle = document.querySelector(".hero-copy h1");
    if (heroTitle) heroTitle.innerHTML = escapeText(title).replace(" thiết bị", "<br />thiết bị");
    document.title = allRegions ? "Thầu Y tế Miền Trung" : `Thầu Y tế ${label}`;
  }

  function regionOptionLabel(region) {
    const count = state.tenders.filter((tender) => tender.regionSlug === region.slug).length;
    return `${region.shortName || region.name}${count ? ` (${count})` : ""}`;
  }

  function updateRegionOptions() {
    const select = document.querySelector("#region-filter");
    if (!select || !regionConfig.length) return;
    const selected = state.regionSlug || DEFAULT_REGION;
    const total = state.tenders.length;
    select.innerHTML = [
      `<option value="all">Toàn miền Trung${total ? ` (${total})` : ""}</option>`,
      ...regionConfig.map((region) =>
        `<option value="${escapeText(region.slug)}">${escapeText(regionOptionLabel(region))}</option>`),
    ].join("");
    select.value = regionConfig.some((item) => item.slug === selected) || selected === "all"
      ? selected
      : DEFAULT_REGION;
  }

  function coverageMarkup() {
    if (!coverage) return "Đang tổng hợp cơ sở dữ liệu từng tỉnh…";
    const initialized = Number(coverage.initializedRegionCount) || 0;
    const configured = Number(coverage.configuredRegionCount) || regionConfig.length;
    const days = Number(coverage.completeCoverageDays) || 0;
    const tenders = Number(coverage.totalTenderCount) || 0;
    const models = Number(coverage.totalEquipmentCount) || 0;
    return `<b>${initialized}/${configured}</b> tỉnh thành đã khởi tạo · <b>${tenders}</b> gói · <b>${models}</b> thiết bị/model${days ? ` · tối thiểu ${days} ngày dữ liệu` : ""}`;
  }

  function updateCoverageStrip() {
    const strip = document.querySelector("#regional-coverage-strip");
    if (strip) strip.innerHTML = coverageMarkup();
  }

  function renderRegionControl() {
    const fixedField = document.querySelector("#search-form .fixed-field");
    if (!fixedField) return;
    fixedField.outerHTML = `
      <label class="search-field select-field region-field">
        <span class="icon-text">⌖</span>
        <span class="sr-only">Tỉnh, thành phố</span>
        <select id="region-filter" aria-label="Chọn tỉnh, thành phố">
          <option value="${DEFAULT_REGION}">Gia Lai</option>
        </select>
        <span>⌄</span>
      </label>`;

    const form = document.querySelector("#search-form");
    const advanced = document.createElement("div");
    advanced.className = "advanced-search";
    advanced.innerHTML = `
      <button type="button" class="advanced-search-toggle" aria-expanded="false">
        <span>☷</span><span>Bộ lọc nâng cao</span><span>⌄</span>
      </button>
      <div class="advanced-search-fields" hidden>
        <label><span>Sắp xếp</span><select id="regional-sort">
          <option value="newest">Mới đăng trước</option>
          <option value="closing">Sắp đóng trước</option>
          <option value="value-desc">Giá trị lớn trước</option>
          <option value="competition">Nhiều nhà thầu trước</option>
        </select></label>
        <label><span>Giá từ (tỷ đồng)</span><input id="regional-min-budget" type="number" min="0" step="0.1" inputmode="decimal" placeholder="0" /></label>
        <label><span>Giá đến (tỷ đồng)</span><input id="regional-max-budget" type="number" min="0" step="0.1" inputmode="decimal" placeholder="Không giới hạn" /></label>
        <label class="advanced-investor"><span>Chủ đầu tư</span><input id="regional-investor" type="search" placeholder="Bệnh viện, trung tâm y tế…" /></label>
        <button type="button" id="regional-reset">Đặt lại</button>
      </div>`;
    form.insertAdjacentElement("afterend", advanced);

    const strip = document.createElement("div");
    strip.id = "regional-coverage-strip";
    strip.className = "regional-coverage-strip";
    strip.textContent = "Đang tổng hợp cơ sở dữ liệu từng tỉnh…";
    advanced.insertAdjacentElement("afterend", strip);
  }

  function applyAdvancedInputs() {
    const sort = document.querySelector("#regional-sort");
    const min = document.querySelector("#regional-min-budget");
    const max = document.querySelector("#regional-max-budget");
    const investor = document.querySelector("#regional-investor");
    if (sort) sort.value = state.advancedSort;
    if (min) min.value = state.minBudgetBillion;
    if (max) max.value = state.maxBudgetBillion;
    if (investor) investor.value = state.investorText;
  }

  function bindRegionalEvents() {
    document.querySelector("#region-filter")?.addEventListener("change", (event) => {
      state.regionSlug = event.target.value || DEFAULT_REGION;
      state.page = 1;
      state.expandedId = null;
      state.investor = "";
      writePreferences();
      updatePageIdentity();
      render();
    });

    const toggle = document.querySelector(".advanced-search-toggle");
    const fields = document.querySelector(".advanced-search-fields");
    toggle?.addEventListener("click", () => {
      const open = fields.hidden;
      fields.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.classList.toggle("open", open);
    });

    const rerender = () => {
      state.advancedSort = document.querySelector("#regional-sort")?.value || "newest";
      state.minBudgetBillion = document.querySelector("#regional-min-budget")?.value || "";
      state.maxBudgetBillion = document.querySelector("#regional-max-budget")?.value || "";
      state.investorText = document.querySelector("#regional-investor")?.value || "";
      state.page = 1;
      state.expandedId = null;
      writePreferences();
      render();
    };
    ["#regional-sort", "#regional-min-budget", "#regional-max-budget", "#regional-investor"]
      .forEach((selector) => document.querySelector(selector)?.addEventListener("input", rerender));

    document.querySelector("#regional-reset")?.addEventListener("click", () => {
      state.advancedSort = "newest";
      state.minBudgetBillion = "";
      state.maxBudgetBillion = "";
      state.investorText = "";
      applyAdvancedInputs();
      rerender();
    });

    elements.refresh?.addEventListener("click", () => setTimeout(() => {
      updateRegionOptions();
      updateCoverageStrip();
    }, 1800));
  }

  function patchApplication() {
    basePeriodTenders = periodTenders;
    baseFilteredTenders = filteredTenders;
    baseTenderMarkup = tenderMarkup;

    periodTenders = function regionalPeriodTenders() {
      const values = basePeriodTenders();
      return state.regionSlug === "all"
        ? values
        : values.filter((tender) => tender.regionSlug === state.regionSlug);
    };

    filteredTenders = function regionalFilteredTenders() {
      let values = baseFilteredTenders();
      const min = Number(state.minBudgetBillion) * 1_000_000_000;
      const max = Number(state.maxBudgetBillion) * 1_000_000_000;
      const investorQuery = normalize(state.investorText);
      if (Number.isFinite(min) && min > 0) {
        values = values.filter((tender) => (Number(tender.price) || Number(tender.winningPrice) || 0) >= min);
      }
      if (Number.isFinite(max) && max > 0) {
        values = values.filter((tender) => (Number(tender.price) || Number(tender.winningPrice) || 0) <= max);
      }
      if (investorQuery) {
        values = values.filter((tender) => normalize(tender.investor).includes(investorQuery));
      }
      const sort = state.advancedSort || "newest";
      return [...values].sort((left, right) => {
        if (sort === "closing") {
          const leftTime = new Date(left.closeDate || "2999-12-31").getTime();
          const rightTime = new Date(right.closeDate || "2999-12-31").getTime();
          return leftTime - rightTime;
        }
        if (sort === "value-desc") {
          return (Number(right.price) || Number(right.winningPrice) || 0)
            - (Number(left.price) || Number(left.winningPrice) || 0);
        }
        if (sort === "competition") {
          return (Number(right.bidderCount) || 0) - (Number(left.bidderCount) || 0);
        }
        return new Date(right.publicDate || 0) - new Date(left.publicDate || 0);
      });
    };

    tenderMarkup = function regionalTenderMarkup(tender) {
      const markup = baseTenderMarkup(tender);
      const regionLabel = tender.region || regionConfig.find((item) => item.slug === tender.regionSlug)?.name;
      if (!regionLabel) return markup;
      return markup.replace(
        '<div class="tender-meta">',
        `<div class="tender-meta"><span class="region-meta">${escapeText(regionLabel)}</span>`,
      );
    };
  }

  async function init() {
    try {
      const prefs = readPreferences();
      state.regionSlug = prefs.region;
      state.advancedSort = prefs.sort;
      state.minBudgetBillion = prefs.minBudget;
      state.maxBudgetBillion = prefs.maxBudget;
      state.investorText = prefs.investorText;

      const [configPayload, coveragePayload] = await Promise.all([
        fetchJson(REGION_CONFIG_URL, { regions: [] }),
        fetchJson(COVERAGE_URL, null),
      ]);
      regionConfig = Array.isArray(configPayload.regions) ? configPayload.regions : [];
      coverage = coveragePayload;

      renderRegionControl();
      patchApplication();
      updateRegionOptions();
      applyAdvancedInputs();
      bindRegionalEvents();
      updatePageIdentity();
      updateCoverageStrip();
      render();

      const timer = setInterval(() => {
        if (!state.tenders.length) return;
        updateRegionOptions();
        updateCoverageStrip();
        render();
        clearInterval(timer);
      }, 500);
      setTimeout(() => clearInterval(timer), 15000);
    } catch (error) {
      console.error("Không khởi tạo được chế độ dữ liệu miền Trung:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    void init();
  }
})();
