(() => {
  // Dữ liệu 11 tỉnh đã được hợp nhất, nhưng giao diện cũ luôn mở bộ lọc Gia Lai
  // và còn nhớ lựa chọn đó trong localStorage. Chuyển người dùng sang "Toàn miền Trung"
  // đúng một lần; sau đó vẫn tôn trọng tỉnh họ tự chọn.
  try {
    const preferencesKey = "central-medical-tender-search-preferences-v1";
    const migrationKey = "central-medical-default-all-regions-v1";
    const params = new URLSearchParams(window.location.search);
    if (!params.has("region") && localStorage.getItem(migrationKey) !== "1") {
      localStorage.removeItem(preferencesKey);
      params.set("region", "all");
      const query = params.toString();
      history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      localStorage.setItem(migrationKey, "1");
    }
  } catch {
    // Trình duyệt chặn localStorage thì giao diện vẫn hoạt động theo cấu hình sẵn có.
  }

  const enableFreeAnalysisMode = () => {
    const setText = (element, value) => {
      if (element && element.textContent !== value) element.textContent = value;
    };

    const applyLabels = () => {
      document.querySelectorAll(".ai-analysis-button").forEach((button) => {
        setText(button.querySelector("span:last-child"), "Phân tích miễn phí");
        button.title = "Phân tích nhanh mức độ phù hợp và khả năng tham gia bằng dữ liệu công khai";
      });

      document.querySelectorAll(".ai-preview-head small, .ai-source-chip").forEach((element) => {
        if (/đánh giá sơ bộ|openai/i.test(element.textContent || "")) {
          setText(element, "Phân tích miễn phí");
        }
      });

      document.querySelectorAll(".ai-preview-note").forEach((element) => {
        setText(element, "Đánh giá tự động miễn phí từ dữ liệu công khai; không gọi dịch vụ trả phí.");
      });

      const header = document.querySelector(".ai-modal-panel > header span");
      if (header) setText(header, "✦ PHÂN TÍCH ĐẤU THẦU KIỂU VIỆT");

      document.querySelectorAll(".ai-live-status").forEach((element) => {
        setText(element, "Chế độ miễn phí: không gọi API và không phát sinh chi phí.");
      });

      document.querySelectorAll("[data-ai-refresh]").forEach((button) => {
        button.hidden = true;
        button.remove();
      });
    };

    applyLabels();
    const observer = new MutationObserver(applyLabels);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };

  const loadAiModule = () => {
    if (document.querySelector("script[data-kieu-viet-ai]")) return;

    const loadAnalysis = () => {
      if (document.querySelector("script[data-kieu-viet-ai='analysis']")) return;
      const analysisScript = document.createElement("script");
      analysisScript.src = "./ai-analysis.js";
      analysisScript.async = false;
      analysisScript.dataset.kieuVietAi = "analysis";
      analysisScript.addEventListener("load", enableFreeAnalysisMode, { once: true });
      document.head.appendChild(analysisScript);
    };

    const configScript = document.createElement("script");
    configScript.src = "./ai-config.js";
    configScript.async = false;
    configScript.dataset.kieuVietAi = "config";
    configScript.addEventListener("load", loadAnalysis, { once: true });
    configScript.addEventListener("error", loadAnalysis, { once: true });
    document.head.appendChild(configScript);
  };

  // Luôn nạp mô-đun phân tích, kể cả khi trang không cần đặt lại vị trí cuộn.
  loadAiModule();

  const params = new URLSearchParams(window.location.search);
  const navigationEntry = performance.getEntriesByType?.("navigation")?.[0];
  const navigationType = navigationEntry?.type || "";
  const hasCacheBust = params.has("v") || params.has("t");
  const shouldResetScroll = !window.location.hash
    && (hasCacheBust || navigationType === "reload");

  if (!shouldResetScroll) return;

  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  const resetScroll = () => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  // Gọi ở nhiều mốc để chặn Chrome khôi phục vị trí cuộn cũ sau khi DOM,
  // ảnh hero hoặc dữ liệu động hoàn tất tải.
  resetScroll();
  document.addEventListener("DOMContentLoaded", resetScroll, { once: true });
  window.addEventListener("load", () => {
    requestAnimationFrame(() => {
      resetScroll();
      requestAnimationFrame(resetScroll);
    });
  }, { once: true });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) resetScroll();
  }, { once: true });
})();
