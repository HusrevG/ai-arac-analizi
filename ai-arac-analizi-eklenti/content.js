/* global chrome */

const APP_URL = "https://44meul58gm9v8negqbk8p5.streamlit.app";
const AI_ARAC_VERSION = "2026-05-11-content-v11.40-manuel-duz-fix";
const VAVA_STEP_DELAY_MS = 3000;
const VAVA_STEP_LOCK_MS = 6000;

window.addEventListener("error", (event) => {
    try {
        console.warn("AI Araç Analizi yakalanan hata:", event.message || event.error);
    } catch (e) {}
}, true);

window.addEventListener("unhandledrejection", (event) => {
    try {
        console.warn("AI Araç Analizi yakalanan promise hatası:", event.reason);
    } catch (e) {}
}, true);


function textClean(value) {
    return (value || "").replace(/\byear\s*edition\b/g, " yearedition ")
        .replace(/\b40th\s*year\s*edition\b/g, " 40th yearedition ")
        .replace(/\s+/g, " ").trim();
}

function normalizeTR(value) {
    return (value || "")
        .toString()
        .toLowerCase()
        .replaceAll("ı", "i")
        .replaceAll("İ", "i")
        .replaceAll("ğ", "g")
        .replaceAll("ü", "u")
        .replaceAll("ş", "s")
        .replaceAll("ö", "o")
        .replaceAll("ç", "c")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function isChromeStorageReady() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
}

function saveCarData(aracData, callback) {
    if (isChromeStorageReady()) {
        chrome.storage.local.set({ aracData }, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
                console.warn("AI Araç Analizi storage yazma hatası:", chrome.runtime.lastError.message);
            }
            if (callback) callback();
        });
        return;
    }

    try {
        localStorage.setItem("aracData", JSON.stringify(aracData));
    } catch (e) {
        console.warn("AI Araç Analizi localStorage yazma hatası:", e);
    }

    if (callback) callback();
}

function getCarData(callback) {
    if (isChromeStorageReady()) {
        chrome.storage.local.get("aracData", (data) => {
            if (chrome.runtime && chrome.runtime.lastError) {
                console.warn("AI Araç Analizi storage okuma hatası:", chrome.runtime.lastError.message);
                callback(null);
                return;
            }
            callback(data && data.aracData ? data.aracData : null);
        });
        return;
    }

    try {
        const raw = localStorage.getItem("aracData");
        callback(raw ? JSON.parse(raw) : null);
    } catch (e) {
        callback(null);
    }
}

function setNativeValue(element, value) {
    if (!element || value === undefined || value === null) return false;

    const cleanValue = String(value);
    element.focus?.();

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(element, cleanValue);
    else element.value = cleanValue;

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
}

function getTitle() {
    const h1 = document.querySelector("h1");
    if (h1) return textClean(h1.innerText);

    const title = document.querySelector("title");
    if (title) return textClean(title.innerText);

    return "";
}

function getPrice() {
    const selectors = [
        ".classifiedInfo h3",
        ".classified-price-container",
        ".classifiedPrice",
        "[class*='price']"
    ];

    for (const selector of selectors) {
        const el = document.querySelector(selector);
        const text = textClean(el?.innerText || "");
        const match = text.match(/([\d.]{5,})\s*TL/i);
        if (match) return match[1];
    }

    const bodyText = document.body.innerText || "";
    const match = bodyText.match(/([\d.]{5,})\s*TL/i);
    return match ? match[1] : "";
}

function getInfoFromRows() {
    const info = {};
    const rows = document.querySelectorAll(".classifiedInfoList li, .classifiedInfo li");

    rows.forEach(row => {
        let label = "";
        let value = "";

        const strong = row.querySelector("strong");
        const span = row.querySelector("span");

        if (strong && span) {
            label = textClean(strong.innerText).replace(":", "");
            value = textClean(span.innerText);
        } else {
            const txt = textClean(row.innerText);
            const knownLabels = [
                "Marka", "Seri", "Model", "Yıl", "Model Yılı", "Yakıt Tipi",
                "Vites", "Araç Durumu", "KM", "Kilometre", "Kasa Tipi",
                "Motor Gücü", "Motor Hacmi", "Çekiş", "Renk", "Garanti",
                "Ağır Hasar Kayıtlı", "Plaka / Uyruk", "Kimden"
            ];

            for (const item of knownLabels) {
                if (txt.startsWith(item)) {
                    label = item;
                    value = textClean(txt.replace(item, "").replace(":", ""));
                    break;
                }
            }
        }

        if (label && value) info[label] = value;
    });

    return info;
}

function getYear(title, info) {
    const value = info["Model Yılı"] || info["Yıl"] || "";
    const match = value.match(/\b(19\d{2}|20\d{2})\b/);
    if (match) return match[0];

    const titleMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
    return titleMatch ? titleMatch[0] : "";
}

function getKm(title, info) {
    const value = info["KM"] || info["Kilometre"] || "";
    const match = value.match(/[\d.,]+/);
    if (match) return match[0];

    const titleMatch = title.match(/(\d{2,3}(?:[.,]\d{3})+|\d{4,7})\s*km/i);
    return titleMatch ? titleMatch[1] : "";
}

function getGear(title, info) {
    const value = (info["Vites"] || "").toLowerCase();

    if (value.includes("manuel")) return "Manuel";
    if (value.includes("yarı") || value.includes("yari")) return "Yarı Otomatik";
    if (value.includes("otomatik")) return "Otomatik";

    const titleText = title.toLowerCase();
    if (titleText.includes("manuel")) return "Manuel";
    if (titleText.includes("yarı otomatik") || titleText.includes("yari otomatik")) return "Yarı Otomatik";
    if (titleText.includes("otomatik")) return "Otomatik";

    return "";
}

function collectSahibindenCarData() {
    const info = getInfoFromRows();
    const baslik = getTitle();
    const fiyat = getPrice();
    const yil = getYear(baslik, info);
    const km = getKm(baslik, info);
    const vites = getGear(baslik, info);

    return {
        ilan: window.location.href,
        baslik,
        fiyat,
        yil,
        km,
        vites,
        marka: info["Marka"] || "",
        seri: info["Seri"] || "",
        model: info["Model"] || "",
        yakit: info["Yakıt Tipi"] || "",
        kasa: info["Kasa Tipi"] || "",
        motor_gucu: info["Motor Gücü"] || "",
        motor_hacmi: info["Motor Hacmi"] || "",
        agir_hasar: info["Ağır Hasar Kayıtlı"] || "",
        tramer: "",
        boya: "",
        degisen: "",
        renk: info["Renk"] || ""
    };
}

function buildStreamlitUrl(v) {
    const params = new URLSearchParams({
        ilan: v.ilan || "",
        baslik: v.baslik || "",
        fiyat: v.fiyat || "",
        yil: v.yil || "",
        km: v.km || "",
        vites: v.vites || "",
        marka: v.marka || "",
        seri: v.seri || "",
        model: v.model || "",
        yakit: v.yakit || "",
        kasa: v.kasa || "",
        motor_gucu: v.motor_gucu || "",
        motor_hacmi: v.motor_hacmi || "",
        agir_hasar: v.agir_hasar || "",
        renk: v.renk || "",
        t: Date.now().toString()
    });

    return `${APP_URL}/?${params.toString()}`;
}

function styleAiButton(btn) {
    btn.style.border = "none";
    btn.style.borderRadius = "10px";
    btn.style.padding = "11px 16px";
    btn.style.fontSize = "14px";
    btn.style.fontWeight = "700";
    btn.style.cursor = "pointer";
    btn.style.background = "#f59e0b";
    btn.style.color = "#111827";
    btn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.18)";
}

function createSahibindenButton() {
    if (document.getElementById("ai-arac-analizi-btn")) return;

    const aiBtn = document.createElement("button");
    aiBtn.id = "ai-arac-analizi-btn";
    aiBtn.innerText = "🚗 AI Analiz";
    styleAiButton(aiBtn);

    aiBtn.addEventListener("click", () => {
        const aracData = collectSahibindenCarData();
        saveCarData(aracData, () => window.open(buildStreamlitUrl(aracData), "_blank"));
    });

    const titleArea =
        document.querySelector(".classifiedDetailTitle") ||
        document.querySelector("h1")?.parentElement;

    if (titleArea) {
        aiBtn.style.marginLeft = "10px";
        titleArea.appendChild(aiBtn);
    } else {
        aiBtn.style.position = "fixed";
        aiBtn.style.right = "24px";
        aiBtn.style.bottom = "24px";
        aiBtn.style.zIndex = "999999";
        document.body.appendChild(aiBtn);
    }
}

function readAiDataFromHash() {
    try {
        const marker = "#ai_arac_data=";
        if (!location.hash || !location.hash.startsWith(marker)) return null;

        const encoded = location.hash.slice(marker.length);
        const parsed = JSON.parse(decodeURIComponent(encoded));

        if (parsed && typeof parsed === "object") {
            saveCarData(parsed, () => console.log("AI araç verisi kaydedildi.", parsed));
            return parsed;
        }
    } catch (e) {
        console.warn("AI araç hash verisi okunamadı:", e);
    }

    return null;
}

function showExternalSitePanel() {
    getCarData((v) => {
        if (!v || document.getElementById("ai-arac-panel")) return;

        const panel = document.createElement("div");
        panel.id = "ai-arac-panel";
        panel.style.position = "fixed";
        panel.style.right = "20px";
        panel.style.bottom = "20px";
        panel.style.zIndex = "999999";
        panel.style.background = "white";
        panel.style.border = "2px solid #222";
        panel.style.borderRadius = "12px";
        panel.style.padding = "12px";
        panel.style.boxShadow = "0 4px 20px rgba(0,0,0,.25)";
        panel.style.fontSize = "13px";
        panel.style.maxWidth = "280px";
        panel.style.color = "#111";
        panel.style.lineHeight = "1.45";

        panel.innerHTML = `
            <b>🚗 AI Araç Verisi</b><br><br>
            Marka: ${v.marka || "-"}<br>
            Seri: ${v.seri || "-"}<br>
            Model: ${v.model || "-"}<br>
            Yıl: ${v.yil || "-"}<br>
            KM: ${v.km || "-"}<br>
            Yakıt: ${v.yakit || "-"}<br>
            Vites: ${v.vites || "-"}<br>
        `;

        document.body.appendChild(panel);
    });
}

function selectByText(select, wantedText, label, options = {}) {
    if (!select) return false;

    const wanted = normalizeTR(wantedText || "");
    let candidates = Array.from(select.options || []).filter(opt => {
        const text = normalizeTR(opt.textContent);
        return text && !text.includes("seciniz");
    });

    let match = null;

    if (wanted) {
        match = candidates.find(opt => normalizeTR(opt.textContent) === wanted);
        if (!match) match = candidates.find(opt => normalizeTR(opt.textContent).includes(wanted));
        if (!match) match = candidates.find(opt => wanted.includes(normalizeTR(opt.textContent)));
    }

    if (!match && options.selectFirstIfNoMatch && candidates.length) {
        match = candidates[0];
    }

    if (!match) {
        console.log("Select eşleşmedi:", label, wantedText);
        return false;
    }

    select.value = match.value;
    match.selected = true;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    console.log("Seçildi:", label, match.textContent);
    return true;
}

function normalizeArabamColor(renk) {
    const r = normalizeTR(renk || "");

    const map = {
        "beyaz": "beyaz",
        "siyah": "siyah",
        "gri": "gri",
        "gumus": "gri",
        "gümüş": "gri",
        "fume": "gri",
        "füme": "gri",
        "mavi": "mavi",
        "kirmizi": "kırmızı",
        "kırmızı": "kırmızı",
        "lacivert": "lacivert",
        "bej": "bej",
        "kahverengi": "kahverengi",
        "sari": "sarı",
        "sarı": "sarı",
        "yesil": "yeşil",
        "yeşil": "yeşil"
    };

    return map[r] || renk || "";
}

function setArabamKm(value) {
    const cleanKm = String(value || "").replace(/[^\d]/g, "");
    if (!cleanKm) return false;

    const input =
        document.querySelector("#kilometer") ||
        document.querySelector("input[name='kilometer']") ||
        document.querySelector("input[placeholder*='Giriniz']");

    if (!input) return false;
    setNativeValue(input, cleanKm);
    return true;
}

function detectArabamVehiclePage() {
    const url = location.href.toLowerCase();
    const text = normalizeTR(document.body.innerText || "");
    return url.includes("arac-secimi") || (text.includes("marka") && text.includes("kilometre"));
}

function normalizeArabamGear(vites) {
    const t = normalizeTR(vites || "");
    if (t.includes("manuel")) return "Manuel";
    if (t.includes("otomatik") || t.includes("yari") || t.includes("yarı")) return "Otomatik";
    return vites || "";
}

function findArabamSelectByLabel(labelText) {
    const wanted = normalizeTR(labelText || "");
    if (!wanted) return null;

    const selects = Array.from(document.querySelectorAll("select"));

    for (const select of selects) {
        let current = select;
        for (let depth = 0; depth < 6 && current; depth++) {
            const txt = normalizeTR(current.innerText || current.textContent || "");
            if (txt.includes(wanted)) return select;
            current = current.parentElement;
        }
    }

    return null;
}

function selectArabamField(labelText, wantedText, options = {}) {
    const select = findArabamSelectByLabel(labelText);

    if (!select) {
        console.log("Trink Sat select bulunamadı:", labelText);
        return false;
    }

    return selectByText(select, wantedText, labelText, options);
}

function findArabamSelectByOptionTexts(matchWords) {
    const wanted = (matchWords || []).map(normalizeTR).filter(Boolean);
    if (!wanted.length) return null;

    const selects = Array.from(document.querySelectorAll("select"));

    return selects.find(select => {
        const text = Array.from(select.options || [])
            .map(o => normalizeTR(o.textContent || ""))
            .join(" ");

        return wanted.some(w => text.includes(w));
    }) || null;
}

function selectArabamColorStrict(v) {
    const renk = normalizeArabamColor(v.renk || "");
    const select = getArabamColorSelect();

    if (!select) {
        console.log("Trink Sat Renk select bulunamadı.");
        return false;
    }

    if (!isArabamSelectUsable(select)) {
        console.log("Trink Sat Renk select henüz aktif değil.");
        return false;
    }

    if (isArabamSelectFilled(select)) {
        console.log("Trink Sat Renk zaten dolu, dokunulmadı.");
        return true;
    }

    if (renk) {
        if (selectByText(select, renk, "Renk", { selectFirstIfNoMatch: false })) {
            return true;
        }
    }

    const realOptions = Array.from(select.options || []).filter(opt => {
        const txt = normalizeTR(opt.textContent || "");
        const val = normalizeTR(opt.value || "");
        return txt &&
            val &&
            val !== "0" &&
            val !== "-1" &&
            !txt.includes("seciniz") &&
            !txt.includes("seçiniz") &&
            txt !== "renk";
    });

    if (realOptions.length) {
        select.value = realOptions[0].value;
        realOptions[0].selected = true;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        console.log("✅ Trink Sat Renk ilk gerçek seçenek seçildi:", realOptions[0].textContent);
        return true;
    }

    return false;
}

function showArabamManualVersionNotice() {
    let box = document.getElementById("ai-arabam-manual-version");

    if (!box) {
        box = document.createElement("div");
        box.id = "ai-arabam-manual-version";
        box.style.position = "fixed";
        box.style.right = "18px";
        box.style.bottom = "18px";
        box.style.zIndex = "2147483647";
        box.style.background = "#111827";
        box.style.color = "white";
        box.style.border = "2px solid #f59e0b";
        box.style.borderRadius = "12px";
        box.style.padding = "12px 14px";
        box.style.fontSize = "13px";
        box.style.lineHeight = "1.45";
        box.style.boxShadow = "0 6px 22px rgba(0,0,0,.35)";
        box.style.maxWidth = "360px";
        document.body.appendChild(box);
    }

    box.innerHTML = `
        <b>🚘 Trink Sat Versiyon</b><br>
        Güvenli otomatik eşleşme bulunamadı.<br>
        Lütfen versiyonu manuel seç.<br>
        Versiyon seçilince renk ve KM otomatik devam edecek.
    `;
}

function hideArabamManualVersionNotice() {
    const box = document.getElementById("ai-arabam-manual-version");
    if (box) box.remove();
}

function getVisibleText(el) {
    return normalizeTR(el?.innerText || el?.textContent || "");
}

function rectsOverlapX(a, b) {
    return a.left < b.right && a.right > b.left;
}

function findArabamSelectByVisualLabel(labelText) {
    const wanted = normalizeTR(labelText || "");
    if (!wanted) return null;

    const selects = Array.from(document.querySelectorAll("select")).filter(s => {
        const r = s.getBoundingClientRect();
        return r.width > 20 && r.height > 10;
    });

    const labelCandidates = Array.from(document.querySelectorAll("label, div, span, p, strong"))
        .filter(el => {
            const txt = getVisibleText(el);
            const r = el.getBoundingClientRect();
            if (r.width < 5 || r.height < 5) return false;

            // Exact label öncelikli: "Renk", "Versiyon", "Vites Tipi" gibi.
            return txt === wanted || txt.replace(":", "") === wanted;
        });

    let best = null;

    for (const select of selects) {
        const sr = select.getBoundingClientRect();

        for (const label of labelCandidates) {
            const lr = label.getBoundingClientRect();

            const above = lr.bottom <= sr.top + 8;
            const near = Math.abs(sr.top - lr.bottom) < 70;
            const overlap = rectsOverlapX(sr, lr) || Math.abs((sr.left + sr.right) / 2 - (lr.left + lr.right) / 2) < 180;

            if (!above || !near || !overlap) continue;

            const score =
                (70 - Math.abs(sr.top - lr.bottom)) +
                (overlap ? 30 : 0) -
                Math.abs(sr.left - lr.left) * 0.05;

            if (!best || score > best.score) {
                best = { select, score, labelText: label.innerText || label.textContent };
            }
        }
    }

    if (best) {
        console.log("Trink Sat görsel label ile select bulundu:", labelText, best.labelText);
        return best.select;
    }

    return null;
}

function findArabamSelectByLabelStrict(labelText) {
    return findArabamSelectByVisualLabel(labelText) || findArabamSelectByLabel(labelText);
}

function getArabamColorSelect() {
    return findArabamSelectByVisualLabel("Renk") ||
        findArabamSelectByOptionTexts([
            "beyaz", "siyah", "gri", "füme", "fume", "mavi",
            "kırmızı", "kirmizi", "lacivert", "bej", "kahverengi",
            "sarı", "sari", "yeşil", "yesil", "turuncu", "bordo"
        ]);
}

function isArabamSelectUsable(select) {
    if (!select) return false;
    if (select.disabled || select.getAttribute("aria-disabled") === "true") return false;

    const rect = select.getBoundingClientRect();
    if (rect.width <= 5 || rect.height <= 5) return false;

    const realOptions = Array.from(select.options || []).filter(opt => {
        const txt = normalizeTR(opt.textContent || "");
        const val = normalizeTR(opt.value || "");
        if (!txt) return false;
        if (txt.includes("seciniz") || txt.includes("seçiniz") || txt === "renk") return false;
        if (!val || val === "0" || val === "-1" || val === "null" || val === "undefined") return false;
        return true;
    });

    return realOptions.length > 0;
}

function waitAndSelectArabamColor(v, maxMs = 12000) {
    const start = Date.now();

    const tick = () => {
        const select = getArabamColorSelect();
        if (select) console.log("Trink Sat renk select bulundu:", textClean(select.innerText || select.textContent || ""), "disabled=", !!select.disabled, "value=", select.value);

        if (isArabamSelectFilled(select)) {
            console.log("Trink Sat renk zaten seçilmiş.");
            setArabamKm(v.km);
            return;
        }

        if (isArabamSelectUsable(select)) {
            const ok = selectArabamColorStrict(v);
            console.log(ok ? "✅ Trink Sat renk manuel versiyon sonrası seçildi." : "❌ Trink Sat renk seçilemedi, tekrar denenecek.");

            if (ok && isArabamSelectFilled(select)) {
                setArabamKm(v.km);
                return;
            }
        } else {
            console.log("Trink Sat renk henüz aktif değil, bekleniyor...");
        }

        if (Date.now() - start < maxMs) {
            setTimeout(tick, 700);
        } else {
            console.log("❌ Trink Sat renk 12 sn içinde aktif olmadı/seçilemedi.");
            setArabamKm(v.km);
        }
    };

    setTimeout(tick, 500);
}

function waitForManualVersionThenContinue(v) {
    selectArabamGearStrict(v);
    const select = getArabamVersionSelect();

    if (!select) return false;

    showArabamManualVersionNotice();

    if (select.dataset.aiManualWatcherAttached !== "1") {
        select.dataset.aiManualWatcherAttached = "1";

        const handler = () => {
            if (!isArabamSelectFilled(select)) return;

            console.log("✅ Trink Sat versiyon manuel seçildi, otomatik devam ediyor.");

            hideArabamManualVersionNotice();

            try {
                waitAndSelectArabamColor(v, 15000);
            } catch (e) {
                console.error("Versiyon sonrası renk bekleme hatası:", e);
                setArabamKm(v.km);
            }
        };

        select.addEventListener("change", handler);
        select.addEventListener("input", handler);
    }

    if (select.dataset.aiManualPollAttached !== "1") {
        select.dataset.aiManualPollAttached = "1";
        const start = Date.now();

        const poll = () => {
            const latestVersionSelect = getArabamVersionSelect();

            if (isArabamSelectFilled(latestVersionSelect)) {
                console.log("✅ Trink Sat versiyon manuel seçimi polling ile algılandı.");
                hideArabamManualVersionNotice();
                waitAndSelectArabamColor(v, 15000);
                return;
            }

            if (Date.now() - start < 30000) {
                setTimeout(poll, 800);
            }
        };

        setTimeout(poll, 800);
    }

    return true;
}


function getArabamGearSelect() {
    // 1) Görsel label
    let found =
        findArabamSelectByVisualLabel("Vites Tipi") ||
        findArabamSelectByVisualLabel("Vites") ||
        findArabamSelectByLabel("Vites Tipi") ||
        findArabamSelectByLabel("Vites");

    if (found) return found;

    // 2) Trink Sat araç seçimi sayfasında alan sırası sabit:
    // Marka, Yıl, Model, Gövde, Yakıt, Vites, Versiyon, Renk
    const selects = Array.from(document.querySelectorAll("select"));
    if (selects[5]) return selects[5];

    // 3) Option içeriği fallback
    return findArabamSelectByOptionTexts([
        "otomatik", "manuel", "yarı otomatik", "yari otomatik"
    ]);
}

function selectArabamGearStrict(v) {
    const select = getArabamGearSelect();

    if (!select) {
        console.log("Trink Sat Vites select bulunamadı.");
        return false;
    }

    if (isArabamSelectFilled(select)) {
        console.log("Trink Sat Vites zaten dolu, dokunulmadı.");
        return true;
    }

    const wanted = normalizeArabamGear(v.vites || "");
    const wantedNorm = normalizeTR(wanted);

    const options = Array.from(select.options || []).filter(opt => {
        const txt = normalizeTR(opt.textContent || "");
        return txt && !txt.includes("seciniz") && !txt.includes("seçiniz");
    });

    console.log("Trink Sat Vites seçenekleri:", options.map(o => o.textContent), "aranan:", wanted);

    let match = null;

    if (wantedNorm) {
        match = options.find(opt => normalizeTR(opt.textContent || "") === wantedNorm);

        if (!match && wantedNorm.includes("manuel")) {
            // Trink Sat "Manuel" yerine "Düz" kullanıyor.
            match = options.find(opt => {
                const txt = normalizeTR(opt.textContent || "");
                return txt.includes("manuel") ||
                       txt.includes("duz") ||
                       txt.includes("düz");
            });
        }

        if (!match && wantedNorm.includes("otomatik")) {
            match = options.find(opt => {
                const txt = normalizeTR(opt.textContent || "");
                return txt === "otomatik" || txt.includes("otomatik");
            });
        }
    }

    if (!match && options.length === 1) {
        match = options[0];
    }

    if (!match) {
        console.log("Trink Sat Vites eşleşmedi:", wanted, options.map(o => o.textContent));
        return false;
    }

    select.value = match.value;
    match.selected = true;

    try {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
        if (setter) setter.call(select, match.value);
        else select.value = match.value;
    } catch (e) {
        select.value = match.value;
    }

    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    console.log("✅ Trink Sat Vites seçildi:", match.textContent);
    return true;
}

function waitForArabamGearThenVersion(v, maxMs = 20000) {
    const start = Date.now();

    const tick = () => {
        const gearOk = selectArabamGearStrict(v);

        if (gearOk) {
            setTimeout(() => {
                selectArabamVersionStrict(v);

                const versionSelect = getArabamVersionSelect();
                if (isArabamSelectFilled(versionSelect)) {
                    waitAndSelectArabamColor(v, 12000);
                } else {
                    waitForManualVersionThenContinue(v);
                }

                setArabamKm(v.km);
            }, 1200);
            return;
        }

        if (Date.now() - start < maxMs) {
            setTimeout(tick, 700);
        } else {
            console.log("Trink Sat vites 20 sn içinde seçilemedi; manuel bekleniyor.");
            setArabamKm(v.km);
        }
    };

    tick();
}


function fillArabamVehicleMissingFields(v) {
    const gearOk = selectArabamGearStrict(v);

    if (!gearOk) {
        waitForArabamGearThenVersion(v, 20000);
        setArabamKm(v.km);
        return;
    }

    setTimeout(() => {
        selectArabamVersionStrict(v);

        const versionSelect = getArabamVersionSelect();
        if (isArabamSelectFilled(versionSelect)) {
            waitAndSelectArabamColor(v, 12000);
        } else {
            waitForManualVersionThenContinue(v);
        }

        setArabamKm(v.km);
    }, 1000);
}

function isArabamSelectFilled(select) {
    if (!select) return false;

    const selected = select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
    const txt = normalizeTR(selected ? selected.textContent : "");
    const val = normalizeTR(select.value || "");

    if (!selected) return false;
    if (!val || val === "0" || val === "-1" || val === "null" || val === "undefined") return false;

    const placeholderWords = [
        "seciniz", "seçiniz", "secin", "seçin",
        "versiyon", "renk", "vites tipi", "model seciniz", "model seçiniz",
        "marka seciniz", "marka seçiniz", "yil seciniz", "yıl seçiniz",
        "lutfen", "lütfen"
    ];

    if (!txt) return false;
    if (placeholderWords.some(w => txt.includes(normalizeTR(w)))) return false;

    return true;
}

function safeSelectArabamField(labelText, wantedText, options = {}) {
    const select = findArabamSelectByLabel(labelText);
    if (!select) {
        console.log("Trink Sat select bulunamadı:", labelText);
        return false;
    }
    if (isArabamSelectFilled(select)) {
        console.log("Trink Sat alan zaten dolu, dokunulmadı:", labelText);
        return true;
    }
    const labelNorm = normalizeTR(labelText);
    const critical = ["marka", "yil", "yıl", "model"];
    const allowFirst = !!options.selectFirstIfNoMatch && !critical.some(c => labelNorm.includes(c));
    return selectByText(select, wantedText, labelText, { ...options, selectFirstIfNoMatch: allowFirst });
}

function markArabamVehicleFilledOnce() {
    try { sessionStorage.setItem("ai_arac_trinksat_vehicle_filled_" + location.pathname, String(Date.now())); } catch (e) {}
}

function hasArabamVehicleFilledOnce() {
    try { return !!sessionStorage.getItem("ai_arac_trinksat_vehicle_filled_" + location.pathname); } catch (e) { return false; }
}

function clearArabamVehicleFillLockForNewHash() {
    const key = "ai_arac_trinksat_last_hash";
    const current = location.hash || "";
    try {
        const last = sessionStorage.getItem(key);
        if (current && current !== last) {
            Object.keys(sessionStorage)
                .filter(k => k.startsWith("ai_arac_trinksat_vehicle_filled_"))
                .forEach(k => sessionStorage.removeItem(k));
            sessionStorage.setItem(key, current);
        }
    } catch (e) {}
}


const VERSION_ALIAS_GROUPS = [
    ["ed", "efficient dynamics", "efficientdynamic", "efficientdynamics", "efficient dynamic", "efficiency dynamics"],
    ["m plus", "mplus", "m paket", "m package", "m sport", "msport"],
    ["amg", "amg line", "amg paket"],
    ["dsg", "direct shift gearbox"],
    ["edc", "efficient dual clutch"],
    ["cvt", "xtronic", "multidrive"],
    ["tsi", "tfsi"],
    ["tdi", "tdci", "crdi", "dci", "hdi", "bluehdi", "multijet", "jtd"],
    ["hybrid", "hibrit"],
    ["phev", "plug in hybrid", "plug-in hybrid", "plug in hibrit"],
    ["4x4", "awd", "xdrive", "quattro", "4matic", "allgrip"],
    ["premium line", "premium"],
    ["comfortline", "comfort"],
    ["highline", "high line"],
    ["edition", "özel seri", "ozel seri"],
    ["40th", "40 th", "40 year", "40th year", "40 yıl", "40 yil", "40. yıl", "40.yıl"],
    ["year edition", "yearedition", "edition"],
    ["joy", "life"],
    ["icon", "iconic"],
    ["touch", "touch plus"],
    ["dream", "flame", "vision"],
    ["allure", "active", "gt line"],
    ["style", "style plus"],
    ["luxury", "luxury line"],
    ["prestige", "prestige plus"],
    ["executive", "executive plus"],
];

function normalizeVersionText(value) {
    let t = normalizeTR(value || "");

    t = t
        .replace(/\befficien\s*dynamic(s)?\b/g, " efficientdynamics ")
        .replace(/\befficient\s*dynamic(s)?\b/g, " efficientdynamics ")
        .replace(/\befficiency\s*dynamics\b/g, " efficientdynamics ")
        .replace(/\befficientdynamics\b/g, " efficientdynamics ")
        .replace(/\befficient\s*dynamics\b/g, " efficientdynamics ")
        .replace(/\bm\s*plus\b/g, " mplus ")
        .replace(/\bm\s*sport\b/g, " msport ")
        .replace(/\bgt\s*line\b/g, " gtline ")
        .replace(/\b40\s*(th|yil|yıl|year)\b/g, " 40th ")
        .replace(/\s+/g, " ")
        .trim();

    return t;
}

function aliasGroupForToken(token) {
    const tok = normalizeVersionText(token || "");
    return VERSION_ALIAS_GROUPS.find(group => group.some(x => normalizeVersionText(x) === tok || normalizeVersionText(x).includes(tok) || tok.includes(normalizeVersionText(x)))) || null;
}

function textHasAlias(text, token) {
    const t = normalizeVersionText(text || "");
    const tok = normalizeVersionText(token || "");

    if (!tok) return true;

    const group = aliasGroupForToken(tok);

    if (group) {
        return group.some(x => {
            const nx = normalizeVersionText(x);
            return new RegExp(`(^|\\s)${nx}(\\s|$)`).test(t) || t.includes(nx);
        });
    }

    return new RegExp(`(^|\\s)${tok}(\\s|$)`).test(t) || t.includes(tok);
}

function requiredAliasTokensFromSource(sourceText) {
    const source = normalizeVersionText(sourceText || "");
    const required = [];

    for (const group of VERSION_ALIAS_GROUPS) {
        const found = group.some(x => textHasAlias(source, x));
        if (found) {
            // Donanım/fiyatı etkileyen ayırt edici grupları şart koş.
            const canonical = normalizeVersionText(group[0]);
            if ([
                "ed", "mplus", "msport", "amg", "dsg", "edc", "cvt",
                "xdrive", "quattro", "4matic", "premium", "comfortline",
                "highline", "luxury", "executive", "prestige", "gtline",
                "allure", "active", "style", "40th"
            ].some(x => canonical.includes(x) || group.map(normalizeVersionText).includes(x))) {
                required.push(group[0]);
            }
        }
    }

    return Array.from(new Set(required));
}

function extractGenericMotorCodes(value) {
    const t = normalizeVersionText(value || "");
    const codes = [];

    const patterns = [
        /\b([1-9][0-9]{2}\s*(?:i|d|e|xi|xd)?)\b/g,              // BMW 320i, 320d
        /\b([0-9]\.[0-9]\s*(?:tsi|tdi|tfsi|hdi|bluehdi|dci|crdi|mpi|tce|ecoboost|multijet|jtd|hybrid|hibrit)?)\b/g,
        /\b([0-9]{2,3}\s*(?:hp|bg|ps))\b/g,
        /\b([0-9]{3,4}\s*cc)\b/g
    ];

    for (const p of patterns) {
        let m;
        while ((m = p.exec(t)) !== null) {
            codes.push(m[1].replace(/\s+/g, ""));
        }
    }

    return Array.from(new Set(codes.filter(Boolean)));
}

function extractBmwMotorCode(value) {
    const codes = extractGenericMotorCodes(value || "");
    const bmw = codes.find(c => /^[1-9][0-9]{2}(i|d|e|xi|xd)?$/.test(c));
    return bmw || "";
}

function isBMWVehicle(v) {
    const t = normalizeTR(`${v.marka || ""} ${v.seri || ""} ${v.model || ""}`);
    return t.includes("bmw") || t.includes("3 serisi") || t.includes("5 serisi") || t.includes("1 serisi");
}

function hasEDToken(value) {
    return textHasAlias(value, "ed");
}

function hasRequiredToken(text, token) {
    return textHasAlias(text, token);
}

function sourceHasSpecialEdition(sourceText) {
    const s = normalizeVersionText(sourceText || "");
    return s.includes("40th") || s.includes("yearedition") || s.includes("edition");
}

function optionHasSpecialEdition(optionText) {
    const o = normalizeVersionText(optionText || "");
    return o.includes("40th") || o.includes("yearedition") || o.includes("edition");
}

function sourceEditionTokens(sourceText) {
    const s = normalizeVersionText(sourceText || "");
    const tokens = [];

    if (s.includes("40th")) tokens.push("40th");
    if (s.includes("yearedition") || s.includes("edition")) tokens.push("edition");
    if (s.includes("luxury")) tokens.push("luxury");
    if (s.includes("mplus")) tokens.push("mplus");
    if (s.includes("msport")) tokens.push("msport");
    if (s.includes("joy")) tokens.push("joy");
    if (s.includes("prestige")) tokens.push("prestige");
    if (s.includes("sport")) tokens.push("sport");

    return Array.from(new Set(tokens));
}

function scoreVehicleVersionOption(optionText, v) {
    const option = normalizeVersionText(optionText || "");
    const source = normalizeVersionText(`${v.seri || ""} ${v.model || ""}`);
    const scoreLog = [];

    if (!option) return { score: -999, reject: true, reason: "empty" };

    let score = 0;

    const sourceMotors = extractGenericMotorCodes(source);
    const optionMotors = extractGenericMotorCodes(option);

    // Motor kodu varsa yanlış motor seçme. 320i varken 316i, 1.6 TDI varken 1.4 TSI gibi hataları engeller.
    if (sourceMotors.length && optionMotors.length) {
        const intersection = sourceMotors.filter(x => optionMotors.includes(x));

        if (!intersection.length) {
            const strongSource = sourceMotors.find(x => /\d/.test(x));
            const strongOption = optionMotors.find(x => /\d/.test(x));

            if (strongSource && strongOption) {
                return {
                    score: -999,
                    reject: true,
                    reason: `motor mismatch wanted=${sourceMotors.join("/")} option=${optionMotors.join("/")}`
                };
            }
        } else {
            score += 120;
            scoreLog.push("motor exact");
        }
    }

    const requiredAliases = requiredAliasTokensFromSource(source);

    for (const token of requiredAliases) {
        if (!textHasAlias(option, token)) {
            return {
                score: -999,
                reject: true,
                reason: `required alias missing=${token}`
            };
        }

        score += 50;
        scoreLog.push(`alias ${token}`);
    }

    // Özel seri/donanım adı fiyatı ciddi etkiler.
    // Kaynakta 40th Year Edition gibi ayırt edici ifade varsa,
    // sadece ED/motor eşleşmesi yetmez; edition bilgisini de arar.
    if (sourceHasSpecialEdition(source)) {
        if (!optionHasSpecialEdition(option)) {
            score -= 90;
            scoreLog.push("missing special edition");
        } else {
            score += 100;
            scoreLog.push("special edition match");
        }
    }

    for (const token of sourceEditionTokens(source)) {
        if (textHasAlias(option, token)) {
            score += 35;
            scoreLog.push(`edition token ${token}`);
        } else if (["40th", "edition", "luxury", "mplus", "msport"].includes(token)) {
            score -= 25;
            scoreLog.push(`missing edition token ${token}`);
        }
    }

    // Kaynaktaki kelimeleri puanla ama tek başına yanlış motoru asla kurtarmasın.
    const sourceWords = source.split(" ").filter(w =>
        w.length >= 2 &&
        !["serisi", "model", "otomatik", "manuel", "sedan", "hatchback", "hb"].includes(w)
    );

    for (const w of Array.from(new Set(sourceWords))) {
        if (textHasAlias(option, w)) {
            if (["40th", "edition", "yearedition", "luxury", "mplus", "msport"].includes(w)) score += 30;
            else score += 8;
        }
        else if (w.length >= 4) {
            if (["edition", "yearedition", "luxury", "mplus", "msport"].includes(w)) score -= 20;
            else score -= 2;
        }
    }

    if (source.includes("sedan") && option.includes("sedan")) score += 5;
    if (source.includes("hatchback") && (option.includes("hatchback") || option.includes("hb"))) score += 5;

    return { score, reject: false, reason: scoreLog.join(", ") };
}

function chooseBestVehicleVersionOption(elements, v) {
    const scored = elements.map(el => {
        const text = textClean(el.innerText || el.textContent || "");
        const s = scoreVehicleVersionOption(text, v);
        return { el, text, ...s };
    }).filter(x => !x.reject);

    scored.sort((a, b) => b.score - a.score);

    console.log("Versiyon/donanım skorları:", scored.map(x => ({
        text: x.text,
        score: x.score,
        reason: x.reason
    })));

    if (!scored.length) return null;

    const source = `${v.seri || ""} ${v.model || ""}`;
    const hasMotor = extractGenericMotorCodes(source).length > 0;
    const hasRequired = requiredAliasTokensFromSource(source).length > 0;
    const minScore = hasMotor || hasRequired ? 70 : 25;

    if (scored[0].score < minScore) {
        console.log("Versiyon/donanım güven eşiği altında, seçim yapılmadı:", scored[0], "minScore:", minScore);
        return null;
    }

    return scored[0].el;
}

function getArabamVersionSelect() {
    return findArabamSelectByVisualLabel("Versiyon") ||
        findArabamSelectByLabel("Versiyon") ||
        Array.from(document.querySelectorAll("select")).find(s => {
            const text = Array.from(s.options || []).map(o => normalizeVersionText(o.textContent)).join(" ");
            return text.includes("hp") || text.includes("otomatik") || text.includes("manuel") || text.includes("efficientdynamics");
        }) || null;
}

function showArabamVersionDebug(message, details = []) {
    let box = document.getElementById("ai-arabam-version-debug");
    if (!box) {
        box = document.createElement("div");
        box.id = "ai-arabam-version-debug";
        box.style.position = "fixed";
        box.style.left = "18px";
        box.style.bottom = "18px";
        box.style.zIndex = "2147483647";
        box.style.background = "#111827";
        box.style.color = "white";
        box.style.border = "2px solid #f59e0b";
        box.style.borderRadius = "12px";
        box.style.padding = "12px 14px";
        box.style.fontSize = "12px";
        box.style.lineHeight = "1.35";
        box.style.boxShadow = "0 6px 22px rgba(0,0,0,.35)";
        box.style.maxWidth = "420px";
        document.body.appendChild(box);
    }

    const safeDetails = (details || []).slice(0, 8).map(x => `<li>${String(x).replace(/[<>&]/g, "")}</li>`).join("");
    box.innerHTML = `<b>Trink Sat Versiyon</b><br>${message}<ul style="margin:6px 0 0 16px;padding:0;">${safeDetails}</ul>`;
}

function optionLooksLikeED(text) {
    return textHasAlias(text, "ed") ||
        normalizeVersionText(text).includes("efficientdynamics") ||
        normalizeVersionText(text).includes("efficient dynamic") ||
        normalizeVersionText(text).includes("efficien dynamic");
}

function selectArabamBMWEDVersionDirect(v) {
    const source = `${v.seri || ""} ${v.model || ""}`;
    const wantedMotor = extractBmwMotorCode(source);

    if (!wantedMotor || !hasEDToken(source)) {
        return false;
    }

    const select = getArabamVersionSelect();

    if (!select) {
        showArabamVersionDebug("Versiyon select bulunamadı.", []);
        return false;
    }

    if (isArabamSelectFilled(select)) {
        return true;
    }

    const options = Array.from(select.options || []).filter(opt => {
        const txt = normalizeTR(opt.textContent || "");
        return txt && !txt.includes("seciniz") && !txt.includes("seçiniz");
    });

    const candidates = options.map(opt => {
        const text = textClean(opt.textContent || "");
        const norm = normalizeVersionText(text);
        const motor = extractBmwMotorCode(norm);
        const hasMotor = norm.includes(wantedMotor) || motor === wantedMotor;
        const hasED = optionLooksLikeED(norm);
        return { opt, text, norm, motor, hasMotor, hasED };
    });

    console.log("Trink Sat BMW ED doğrudan adayları:", candidates);

    const sourceNorm = normalizeVersionText(source);

    let match = candidates.find(x => {
        if (!(x.hasMotor && x.hasED)) return false;

        // Kaynakta edition varsa düz ED seçme.
        if ((sourceNorm.includes("40th") || sourceNorm.includes("edition")) &&
            !(x.norm.includes("40th") || x.norm.includes("edition"))) {
            return false;
        }

        return true;
    });

    if (!match) {
        showArabamVersionDebug(
            `320i ED için güvenli eşleşme bulunamadı. Aranan motor: ${wantedMotor}`,
            candidates.map(x => `${x.text} | motor=${x.motor || "-"} | ED=${x.hasED}`)
        );

        waitForManualVersionThenContinue(v);

        return false;
    }

    select.value = match.opt.value;
    match.opt.selected = true;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    showArabamVersionDebug(`Seçildi: ${match.text}`, []);
    console.log("✅ Trink Sat BMW ED Versiyon doğrudan seçildi:", match.text);
    return true;
}

function isArabamVersionScoreConfident(scored, source) {
    if (!scored || !scored.length) return false;

    const best = scored[0];
    const second = scored[1] || null;

    const hasMotor = extractGenericMotorCodes(source).length > 0;
    const hasRequired = requiredAliasTokensFromSource(source).length > 0;

    // Motor/donanım kritikse yine daha temkinli ol.
    if (hasMotor || hasRequired) {
        return best.score >= 70;
    }

    // Genel araçlarda mutlak skor düşük görünse bile,
    // en iyi aday diğerlerinden açık ara öndeyse seç.
    if (best.score >= 15 && !second) return true;
    if (best.score >= 15 && second && (best.score - second.score) >= 7) return true;

    // Çok az aday varsa ve en iyi aday anlamlı puan aldıysa seçilebilir.
    if (scored.length <= 2 && best.score >= 14) return true;

    return false;
}

function buildStrongEditionSignature(text) {
    const t = normalizeVersionText(text || "");
    const parts = [];

    const motor = extractBmwMotorCode(t);
    if (motor) parts.push(motor);

    if (t.includes("efficientdynamics")) parts.push("efficientdynamics");
    if (t.includes("40th")) parts.push("40th");
    if (t.includes("yearedition") || t.includes("edition")) parts.push("edition");
    if (t.includes("luxury")) parts.push("luxury");
    if (t.includes("mplus")) parts.push("mplus");
    if (t.includes("msport")) parts.push("msport");

    return parts.join("|");
}

function trySelectExactEditionVersion(select, sourceText) {
    if (!select) return false;

    const wantedSig = buildStrongEditionSignature(sourceText);
    if (!wantedSig) return false;

    const options = Array.from(select.options || []).filter(opt => {
        const txt = normalizeTR(opt.textContent || "");
        return txt && !txt.includes("seciniz") && !txt.includes("seçiniz");
    });

    const candidates = options.map(opt => {
        const text = textClean(opt.textContent || "");
        const sig = buildStrongEditionSignature(text);

        return {
            opt,
            text,
            sig
        };
    });

    console.log("Trink Sat strong signature target:", wantedSig);
    console.log("Trink Sat strong signature candidates:", candidates);

    // Önce tam signature eşleşmesi
    let exact = candidates.find(x => x.sig === wantedSig);

    // Eğer edition kaynakta varsa, edition içermeyenleri tamamen ele.
    if (!exact && wantedSig.includes("edition")) {
        exact = candidates.find(x =>
            x.sig.includes("edition") &&
            x.sig.includes("40th") &&
            (
                (!wantedSig.includes("efficientdynamics")) ||
                x.sig.includes("efficientdynamics")
            ) &&
            (
                (!wantedSig.includes("320i")) ||
                x.sig.includes("320i")
            )
        );
    }

    if (!exact) return false;

    select.value = exact.opt.value;
    exact.opt.selected = true;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    console.log("✅ Trink Sat exact edition seçildi:", exact.text);
    return true;
}

function selectArabamVersionStrict(v) {
    const gearSelect = getArabamGearSelect();

    if (gearSelect && !isArabamSelectFilled(gearSelect)) {
        console.log("Trink Sat Versiyon bekliyor: önce vites seçilecek.");
        return false;
    }

    if (selectArabamBMWEDVersionDirect(v)) {
        return true;
    }

    const select = getArabamVersionSelect();

    const sourceFull = `${v.seri || ""} ${v.model || ""}`;

    if (trySelectExactEditionVersion(select, sourceFull)) {
        return true;
    }

    if (!select) {
        console.log("Trink Sat Versiyon select bulunamadı.");
        return false;
    }

    if (isArabamSelectFilled(select)) {
        console.log("Trink Sat Versiyon zaten dolu, dokunulmadı.");
        return true;
    }

    const options = Array.from(select.options || []).filter(opt => {
        const txt = normalizeTR(opt.textContent || "");
        return txt && !txt.includes("seciniz") && !txt.includes("seçiniz");
    });

    const scored = options.map(opt => {
        const text = textClean(opt.textContent || "");
        const s = scoreVehicleVersionOption(text, v);
        return { opt, text, ...s };
    }).filter(x => !x.reject);

    scored.sort((a, b) => b.score - a.score);

    console.log("Trink Sat Versiyon skorları:", scored.map(x => ({
        text: x.text,
        score: x.score,
        reason: x.reason
    })));

    if (!scored.length) {
        const allOptions = options.map(o => textClean(o.textContent || ""));
        showArabamVersionDebug("Güvenli versiyon eşleşmesi yok. Manuel seçim gerekli.", allOptions);

        waitForManualVersionThenContinue(v);

        console.log("Trink Sat Versiyon: manuel seçim bekleniyor.");
        return false;
    }

    const source = `${v.seri || ""} ${v.model || ""}`;

    if (!isArabamVersionScoreConfident(scored, source)) {
        showArabamVersionDebug(
            "En iyi eşleşme yeterince net değil. Manuel seçim gerekli.",
            scored.map(x => `${x.text} | skor=${x.score}`)
        );

        waitForManualVersionThenContinue(v);

        console.log("Trink Sat Versiyon göreli skor yeterli değil, manuel seçim bekleniyor:", scored);
        return false;
    }

    select.value = scored[0].opt.value;
    scored[0].opt.selected = true;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    console.log("✅ Trink Sat Versiyon seçildi:", scored[0].text);
    return true;
}


function autoFillArabamVehiclePage(v) {
    if (hasArabamVehicleFilledOnce()) {
        console.log("Trink Sat araç seçimi daha önce dolduruldu; tekrar müdahale edilmiyor.");
        return;
    }
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    (async () => {
        await wait(1000);
        let selects = Array.from(document.querySelectorAll("select"));

        selectByText(selects[0], v.marka, "Marka");
        await wait(1200);

        selects = Array.from(document.querySelectorAll("select"));
        selectByText(selects[1], String(v.yil), "Yıl");
        await wait(1200);

        selects = Array.from(document.querySelectorAll("select"));
        selectByText(selects[2], v.seri || v.model, "Model");
        await wait(1200);

        selects = Array.from(document.querySelectorAll("select"));
        selectByText(selects[3], v.kasa, "Gövde Tipi", { selectFirstIfNoMatch: true });
        await wait(900);

        selects = Array.from(document.querySelectorAll("select"));
        selectByText(selects[4], v.yakit, "Yakıt Tipi");
        await wait(900);

        selects = Array.from(document.querySelectorAll("select"));
        selectByText(selects[5], normalizeArabamGear(v.vites || ""), "Vites Tipi");
        await wait(1000);
        selectArabamGearStrict(v);
        await wait(1000);

        selects = Array.from(document.querySelectorAll("select"));
        selectArabamVersionStrict(v);
        await wait(900);

        selects = Array.from(document.querySelectorAll("select"));
        const renk = normalizeArabamColor(v.renk || "");
        if (selects[7]) {
            if (renk) {
                selectByText(selects[7], renk, "Renk", { selectFirstIfNoMatch: true });
            } else {
                selectByText(selects[7], "", "Renk", { selectFirstIfNoMatch: true });
            }
        } else {
            console.log("Trink Sat renk select bulunamadı.");
        }

        await wait(900);
        setArabamKm(v.km);

        await wait(1200);
        fillArabamVehicleMissingFields(v);

        await wait(1800);
        fillArabamVehicleMissingFields(v);

        const versionSelectForColor = getArabamVersionSelect();
        if (isArabamSelectFilled(versionSelectForColor)) {
            waitAndSelectArabamColor(v, 9000);
        } else {
            waitForArabamDependentFields(v, 16000);
        }

        setTimeout(() => fillArabamVehicleMissingFields(v), 1500);
        setTimeout(() => fillArabamVehicleMissingFields(v), 3500);
        setTimeout(() => fillArabamVehicleMissingFields(v), 6500);

        markArabamVehicleFilledOnce();

        console.log("Trink Sat araç seçimi dolduruldu ve kilitlendi. Devam Et'e basılmadı.");
    })();
}

function initSahibinden() {
    createSahibindenButton();
    console.log("AI Araç Analizi yüklendi:", AI_ARAC_VERSION);
}

const ARABAM_PART_LABELS = [
    "Sağ arka çamurluk",
    "Arka kaput",
    "Sol arka çamurluk",
    "Sağ arka kapı",
    "Sağ ön kapı",
    "Tavan",
    "Sol arka kapı",
    "Sol ön kapı",
    "Sağ ön çamurluk",
    "Motor kaputu",
    "Sol ön çamurluk",
    "Ön tampon",
    "Arka tampon"
];

function normalizePartName(value) {
    return normalizeTR(value || "");
}

function clickInputLikeHuman(input) {
    if (!input) return false;

    try {
        input.scrollIntoView({ block: "center", inline: "center" });
        input.focus?.();
    } catch (e) {}

    const label = input.closest("label");
    const target = label || input;

    try {
        target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        target.click?.();
    } catch (e) {
        try { input.click(); } catch (err) {}
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    return true;
}

function getWantedDamageState(partName, v) {
    const labelNorm = normalizePartName(partName);
    const boyali = (v.boyali_parcalar || []).map(normalizePartName);
    const degisen = (v.degisen_parcalar || []).map(normalizePartName);

    if (degisen.includes(labelNorm)) return "degisen";
    if (boyali.includes(labelNorm)) return "boyali";
    return "orijinal";
}


function clickDamageCell(row, state) {
    const selectors = {
        "orijinal": [".original", ".orijinal"],
        "boyali": [".painted", ".boyali"],
        "degisen": [".changed", ".degisen"]
    };

    let container = null;

    for (const s of selectors[state]) {
        container = row.querySelector(s);
        if (container) break;
    }

    // Önce özel kolonları dene
    if (container) {
        const possibleTargets = [
            container.querySelector("input"),
            container.querySelector("label"),
            container.querySelector("span"),
            container
        ].filter(Boolean);

        for (const target of possibleTargets) {
            try {
                target.scrollIntoView({ block: "center" });

                target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
                target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
                target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
                target.dispatchEvent(new MouseEvent("click", { bubbles: true }));

                target.click?.();

                const input = container.querySelector("input");
                if (input) {
                    input.checked = true;
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                }

                return true;
            } catch (e) {}
        }
    }

    // Fallback: sıraya göre radio/checkbox
    const inputs = Array.from(row.querySelectorAll("input[type='checkbox'], input[type='radio']"));

    const indexMap = {
        "orijinal": 0,
        "boyali": 1,
        "degisen": 2
    };

    const targetInput = inputs[indexMap[state]];

    if (!targetInput) {
        console.log("❌ Hasar input bulunamadı:", state);
        return false;
    }

    try {
        targetInput.scrollIntoView({ block: "center" });

        const label =
            targetInput.closest("label") ||
            row.querySelectorAll("label")[indexMap[state]];

        const clickTarget = label || targetInput;

        clickTarget.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        clickTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        clickTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        clickTarget.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        clickTarget.click?.();

        targetInput.checked = true;

        targetInput.dispatchEvent(new Event("input", { bubbles: true }));
        targetInput.dispatchEvent(new Event("change", { bubbles: true }));

        console.log("✅ Hasar kutusu işaretlendi:", state);

        return true;
    } catch (e) {
        console.log("❌ Hasar kutusu click hatası:", e);
    }

    return false;
}


function findDamageRows() {
    const rowCandidates = [
        ...Array.from(document.querySelectorAll(".elements-row")),
        ...Array.from(document.querySelectorAll("tr")),
        ...Array.from(document.querySelectorAll("div"))
    ];

    const result = [];
    const used = new Set();

    for (const row of rowCandidates) {
        const rowText = normalizeTR(row.innerText || "");
        const matchedPart = ARABAM_PART_LABELS.find(p => rowText.includes(normalizePartName(p)));

        const hasDamageInputs =
            row.querySelector(".original") ||
            row.querySelector(".painted") ||
            row.querySelector(".changed") ||
            row.querySelectorAll("input[type='checkbox'], input[type='radio']").length >= 3;

        if (matchedPart && hasDamageInputs && !used.has(matchedPart)) {
            used.add(matchedPart);
            result.push({ row, part: matchedPart });
        }
    }

    return result;
}

function detectArabamDamagePage() {
    const url = location.href.toLowerCase();
    const text = normalizeTR(document.body.innerText || "");

    return (
        url.includes("hasar-tramer") ||
        (
            text.includes("hasar") &&
            text.includes("tramer") &&
            text.includes("sag arka camurluk") &&
            text.includes("orijinal") &&
            text.includes("boyali")
        )
    );
}

function setSelectByMeaning(select, wanted) {
    if (!select) return false;

    const wantedNorm = normalizeTR(wanted);
    const opts = Array.from(select.options || []);

    let match = opts.find(o => normalizeTR(o.textContent).includes(wantedNorm));

    if (!match && wantedNorm === "var") {
        match = opts.find(o => normalizeTR(o.textContent).includes("var"));
    }

    if (!match && wantedNorm === "yok") {
        match = opts.find(o => normalizeTR(o.textContent).includes("yok"));
    }

    if (!match) {
        console.log("Tramer select eşleşmedi:", wanted, opts.map(o => o.textContent));
        return false;
    }

    select.value = match.value;
    match.selected = true;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    return true;
}

function findTramerSelectOnArabam() {
    const selects = Array.from(document.querySelectorAll("select"));

    return selects.find(s => {
        const text = Array.from(s.options || []).map(o => normalizeTR(o.textContent)).join(" ");
        return text.includes("tramer") || text.includes("tramer seciniz") || (text.includes("var") && text.includes("yok"));
    });
}

function fillTramerAmountOnArabam(amount) {
    const clean = String(amount || "").replace(/[^\d]/g, "");
    if (!clean) return false;

    const inputs = Array.from(document.querySelectorAll("input"));
    const input = inputs.find(i =>
        normalizeTR(i.placeholder).includes("giriniz") ||
        normalizeTR(i.placeholder).includes("tl") ||
        normalizeTR(i.name).includes("tramer") ||
        normalizeTR(i.id).includes("tramer")
    );

    if (!input) {
        console.log("Tramer tutarı input bulunamadı");
        return false;
    }

    setNativeValue(input, clean);
    return true;
}

function autoFillArabamDamagePageNoNext(v) {
    console.log("Trink Sat hasar/tramer doldurma başladı. Devam Et'e basılmayacak.", v);

    const rows = findDamageRows();
    console.log("Hasar satır sayısı:", rows.length);

    rows.forEach(({ row, part }) => {
        const state = getWantedDamageState(part, v);
        const ok = clickDamageCell(row, state);
        console.log(ok ? "Hasar seçildi:" : "Hasar seçilemedi:", part, state);
    });

    const tramerSelect = findTramerSelectOnArabam();

    if (tramerSelect) {
        const wanted = v.tramer_var === "Var" ? "Var" : "Yok";
        const ok = setSelectByMeaning(tramerSelect, wanted);
        console.log(ok ? "Tramer seçildi:" : "Tramer seçilemedi:", wanted);
    } else {
        console.log("Tramer select bulunamadı.");
    }

    if (v.tramer_var === "Var") {
        const okAmount = fillTramerAmountOnArabam(v.tramer);
        console.log(okAmount ? "Tramer tutarı yazıldı" : "Tramer tutarı yazılamadı", v.tramer);
    }

    console.log("Trink Sat hasar/tramer doldurma tamamlandı. Devam Et'e basılmadı.");
}

function initArabam() {
    clearArabamVehicleFillLockForNewHash();
    showExternalSitePanel();

    const hashData = readAiDataFromHash();

    getCarData((stored) => {
        const v = hashData || stored;
        if (!v) return;

        const filled = new Set();

        const run = () => {
            if (detectArabamVehiclePage()) {
                const key = "vehicle|" + location.pathname;
                if (!filled.has(key)) {
                    filled.add(key);
                    setTimeout(() => autoFillArabamVehiclePage(v), 800);
                }
                return;
            }

            if (detectArabamDamagePage()) {
                const key = "damage|" + location.pathname;
                if (!filled.has(key)) {
                    filled.add(key);
                    setTimeout(() => autoFillArabamDamagePageNoNext(v), 800);
                }
                return;
            }
        };

        run();

        const timer = setInterval(run, 1500);
        setTimeout(() => clearInterval(timer), 45000);
    });
}

function clickElementLikeHuman(el) {
    if (!el) return false;

    try {
        const rect = el.getBoundingClientRect();
        const tag = (el.tagName || "").toLowerCase();
        const role = el.getAttribute("role") || "";
        const disabled = el.disabled || el.getAttribute("aria-disabled") === "true";

        if (disabled) {
            console.log("Click iptal: disabled element", el);
            return false;
        }

        // Çok büyük container'lara tıklama; yanlışlıkla sayfa/back/header tıklaması döngü ve uyarı üretebilir.
        if (!["button", "a", "input", "label"].includes(tag) && role !== "button" && role !== "option") {
            if (rect.width > window.innerWidth * 0.75 || rect.height > window.innerHeight * 0.45) {
                console.log("Click iptal: büyük container", textClean(el.innerText || el.textContent || ""));
                return false;
            }
        }
    } catch (e) {}

    try {
        el.scrollIntoView({ block: "center", inline: "center" });
        el.focus?.();
    } catch (e) {}

    try {
        el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        el.click();
    } catch (e) {
        try {
            el.click();
        } catch (err) {}
    }

    return true;
}

function findVisibleClickableByText(textValue) {
    const wanted = normalizeTR(textValue || "");
    if (!wanted) return null;

    const candidates = Array.from(document.querySelectorAll(
        "button, a, li, div[role='button'], mat-option, .mat-mdc-option, [role='option'], span"
    )).filter(el => {
        const rect = el.getBoundingClientRect();
        const txt = normalizeTR(el.innerText || el.textContent || "");
        return txt && rect.width > 10 && rect.height > 10;
    });

    let match = candidates.find(el => normalizeTR(el.innerText || el.textContent || "") === wanted);
    if (!match) match = candidates.find(el => normalizeTR(el.innerText || el.textContent || "").includes(wanted));
    if (!match) match = candidates.find(el => wanted.includes(normalizeTR(el.innerText || el.textContent || "")));

    return match || null;
}

function clickVavaOption(textValue) {
    const el = findVisibleClickableByText(textValue);
    if (!el) {
        console.log("❌ VavaCars seçenek bulunamadı:", textValue);
        return false;
    }

    clickElementLikeHuman(el);
    console.log("✅ VavaCars seçenek tıklandı:", textValue);
    return true;
}

function cleanVehicleVariantText(value) {
    let t = normalizeTR(value || "");

    const removeWords = [
        "premium line", "prestige", "comfort", "comfortline", "highline",
        "style", "style plus", "elegance", "exclusive", "executive",
        "amg", "m sport", "sport line", "luxury line",
        "advantage", "standart", "standard",
        "touch", "icon", "joy", "flame", "dream", "vision",
        "business", "dynamic", "urban", "allure", "active", "gt line",
        "dsg", "edc", "xdrive", "bluehdi", "tdi", "tsi"
    ];

    for (const w of removeWords) {
        t = t.replaceAll(w, " ");
    }

    t = t.replace(/\s+/g, " ").trim();
    return t;
}

function extractEngineModelCandidates(v) {
    const rawModel = v.model || "";
    const rawSerie = v.seri || "";
    const joined = `${rawSerie} ${rawModel}`;
    const normJoined = normalizeTR(joined);

    const candidates = [];

    const bmwEngine = normJoined.match(/\b([1-9][0-9]{2}\s*[dixei]*)\b/);
    if (bmwEngine) {
        candidates.push(bmwEngine[1].replace(/\s+/g, ""));
        candidates.push(bmwEngine[1]);
    }

    const engineDecimal = normJoined.match(/\b([0-9]\.[0-9]\s*[a-z]{1,5})\b/);
    if (engineDecimal) candidates.push(engineDecimal[1]);

    const cleanedModel = cleanVehicleVariantText(rawModel);
    if (cleanedModel) candidates.push(cleanedModel);

    if (rawModel) candidates.push(rawModel);
    if (rawSerie) candidates.push(rawSerie);

    return Array.from(new Set(candidates.filter(Boolean)));
}

function visibleClickableCandidates() {
    return Array.from(document.querySelectorAll(
        "button, a, li, div[role='button'], mat-option, .mat-mdc-option, [role='option'], span"
    )).filter(el => {
        const rect = el.getBoundingClientRect();
        const txt = normalizeTR(el.innerText || el.textContent || "");
        return txt && rect.width > 10 && rect.height > 10;
    });
}

function clickBestVavaOption(candidatesText) {
    const elements = visibleClickableCandidates();

    for (const wantedText of candidatesText) {
        const wanted = normalizeTR(wantedText);
        if (!wanted) continue;

        let exact = elements.find(el => normalizeTR(el.innerText || el.textContent || "") === wanted);
        if (exact) {
            clickElementLikeHuman(exact);
            console.log("✅ VavaCars exact seçenek:", wantedText);
            return true;
        }
    }

    for (const wantedText of candidatesText) {
        const wanted = normalizeTR(wantedText);
        if (!wanted) continue;

        let strong = elements.find(el => {
            const txt = normalizeTR(el.innerText || el.textContent || "");
            return txt.startsWith(wanted + " ") || txt.includes(" " + wanted + " ") || txt.includes(wanted);
        });

        if (strong) {
            clickElementLikeHuman(strong);
            console.log("✅ VavaCars yakın seçenek:", wantedText, "=>", textClean(strong.innerText || strong.textContent || ""));
            return true;
        }
    }

    console.log("❌ VavaCars uygun seçenek bulunamadı:", candidatesText);
    return false;
}

function normalizeVavaBodyType(kasa) {
    const k = normalizeTR(kasa || "");
    if (k.includes("sedan")) return "Sedan";
    if (k.includes("hatchback")) return "Hatchback";
    if (k.includes("station")) return "Station Wagon";
    if (k.includes("suv")) return "SUV";
    if (k.includes("coupe") || k.includes("coupe")) return "Coupe";
    if (k.includes("cabrio")) return "Cabrio";
    return kasa || "";
}

function getVavaStepClean() {
    const url = location.href.toLowerCase();
    const text = normalizeTR(document.body.innerText || "");

    if (url.includes("/sell/valuation/year") || text.includes("model yili secin") || text.includes("model yılı seçin")) return "year";
    if (url.includes("/sell/valuation/brand") || text.includes("marka secin") || text.includes("marka seçin")) return "brand";
    if (url.includes("/sell/valuation/body") || text.includes("govde tipini secin") || text.includes("gövde tipini seçin") || text.includes("govde tipi secin") || text.includes("gövde tipi seçin")) return "body";
    if (url.includes("/sell/valuation/model") || text.includes("model secin") || text.includes("model seçin")) return "model";
    if (url.includes("/sell/valuation/transmission") || text.includes("sanziman") || text.includes("şanzıman")) return "transmission";
    if (url.includes("/sell/valuation/fuel") || text.includes("yakit turunu secin") || text.includes("yakıt türünü seçin") || text.includes("yakit turu") || text.includes("yakıt türü")) return "fuel";
    if (url.includes("/sell/valuation/color") || text.includes("renk secin") || text.includes("renk seçin") || text.includes("renk")) return "color";
    if (url.includes("/sell/valuation/trim") || url.includes("/sell/valuation/equipment") || text.includes("donanim") || text.includes("donanım")) return "trim";
    if (text.includes("arac bilgilerini girin") || text.includes("araç bilgilerini girin") || url.includes("vehicle")) return "vehicle_info";

    return "unknown";
}

function normalizeVavaVites(vites) {
    const t = normalizeTR(vites || "");
    if (t.includes("manuel")) return "Manuel";
    if (t.includes("otomatik") || t.includes("yari")) return "Otomatik";
    return vites || "";
}

function normalizeVavaFuel(yakit) {
    const y = normalizeTR(yakit || "");

    if (y.includes("dizel")) return "Dizel";
    if (y.includes("benzin")) return "Benzin";
    if (y.includes("lpg")) return "Benzin";
    if (y.includes("hibrit") || y.includes("hybrid")) return "Hibrit";
    if (y.includes("elektrik")) return "Elektrik";

    return yakit || "";
}

function normalizeVavaRenk(renk) {
    const r = normalizeTR(renk || "");
    const map = {
        "beyaz": "Beyaz",
        "siyah": "Siyah",
        "gri": "Gri",
        "gumus": "Gri",
        "fume": "Gri",
        "mavi": "Mavi",
        "kirmizi": "Kırmızı",
        "kırmızı": "Kırmızı",
        "lacivert": "Lacivert",
        "bej": "Bej",
        "kahverengi": "Kahverengi"
    };
    return map[r] || renk || "";
}

function clickVavaColor(renk) {
    const wanted = normalizeVavaRenk(renk || "");
    const wantedNorm = normalizeTR(wanted);

    console.log("🎨 VavaCars renk seçimi başladı. Gelen renk:", renk, "normalize:", wanted);

    const selectors = [
        "button",
        "a",
        "li",
        "div[role='button']",
        "mat-option",
        ".mat-mdc-option",
        "[role='option']",
        ".cursor-pointer",
        ".card",
        "[class*='color']",
        "[class*='option']",
        "div",
        "span"
    ].join(",");

    const all = Array.from(document.querySelectorAll(selectors))
        .filter(el => {
            const rect = el.getBoundingClientRect();
            const txt = normalizeTR(el.innerText || el.textContent || "");
            const visible = rect.width > 18 && rect.height > 10;
            return visible && (txt || el.querySelector("svg,img"));
        });

    const colorWords = [
        "beyaz", "siyah", "gri", "gumus", "gümüş", "fume", "füme",
        "mavi", "kirmizi", "kırmızı", "lacivert", "bej",
        "kahverengi", "sari", "sarı", "yesil", "yeşil", "turuncu",
        "bordo", "mor"
    ];

    let match = null;

    if (wantedNorm) {
        match = all.find(el => normalizeTR(el.innerText || el.textContent || "") === wantedNorm);

        if (!match) {
            match = all.find(el => {
                const txt = normalizeTR(el.innerText || el.textContent || "");
                return txt.includes(wantedNorm);
            });
        }
    }

    if (!match) {
        match = all.find(el => {
            const txt = normalizeTR(el.innerText || el.textContent || "");
            return colorWords.some(c => txt === c || txt.includes(c));
        });
    }

    if (!match) {
        // Renk sayfasında hiç metinli seçenek yoksa ilk büyük tıklanabilir kartı seç.
        match = all.find(el => {
            const rect = el.getBoundingClientRect();
            const tag = el.tagName.toLowerCase();
            const cls = normalizeTR(el.className || "");
            return (
                tag === "button" ||
                el.getAttribute("role") === "button" ||
                cls.includes("card") ||
                cls.includes("option") ||
                cls.includes("cursor")
            ) && rect.width > 60 && rect.height > 35;
        });
    }

    if (!match) {
        console.log("❌ VavaCars renk seçeneği bulunamadı. Sayfa manuel bırakıldı.");
        return false;
    }

    // Gereğinden büyük parent'a çıkma; doğrudan bulunmuş elemanı tıkla.
    clickElementLikeHuman(match);

    // Bazı Angular kartlarında child tıklama yetmiyor, en yakın role/button parent'a da bas.
    const parentButton = match.closest("button, [role='button'], mat-option, .mat-mdc-option");
    if (parentButton && parentButton !== match) {
        setTimeout(() => clickElementLikeHuman(parentButton), 300);
    }

    console.log("✅ VavaCars renk tıklama denendi:", textClean(match.innerText || match.textContent || match.className || ""));
    return true;
}

function setVavaKm(v) {
    const km = String(v.km || "").replace(/[^\d]/g, "");
    if (!km) return false;

    const inputs = Array.from(document.querySelectorAll("input"));
    const kmInput = inputs.find(i => {
        const p = normalizeTR(i.placeholder || "");
        const n = normalizeTR(i.name || "");
        const id = normalizeTR(i.id || "");
        return p.includes("50000") || p.includes("kilometre") || n.includes("km") || id.includes("km");
    }) || inputs.find(i => {
        const rect = i.getBoundingClientRect();
        return rect.width > 80 && rect.height > 20;
    });

    if (!kmInput) {
        console.log("❌ VavaCars KM input bulunamadı");
        return false;
    }

    setNativeValue(kmInput, km);
    console.log("✅ VavaCars KM yazıldı:", km);
    return true;
}

function clickVavaBodyType(kasa) {
    const bodyType = normalizeVavaBodyType(kasa || "");
    const wanted = normalizeTR(bodyType);

    if (!wanted) {
        console.log("❌ VavaCars gövde tipi verisi yok.");
        return false;
    }

    // KRİTİK: Burada genel div/span aramıyoruz.
    // Eski sürüm bazen sayfanın büyük container'ını yakalıyor ve seçim yerine scroll yapıyordu.
    // Sadece gerçek tıklanabilir option/card/button elemanları hedeflenir.
    const selector = [
        "button",
        "a",
        "li",
        "[role='button']",
        "[role='option']",
        "mat-option",
        ".mat-mdc-option",
        "[data-test-id*='body']",
        "[data-testid*='body']",
        "[class*='option']",
        "[class*='card']",
        "[class*='item']"
    ].join(",");

    const candidates = Array.from(document.querySelectorAll(selector))
        .filter(el => {
            const rect = el.getBoundingClientRect();
            const txt = normalizeTR(el.innerText || el.textContent || "");
            const tag = el.tagName.toLowerCase();
            const visible = rect.width > 40 && rect.height > 20;
            const saneSize = rect.width < window.innerWidth * 0.95 && rect.height < window.innerHeight * 0.45;
            const notNav = !txt.includes("arac al") && !txt.includes("aracinizi satin") && !txt.includes("giris yapin");
            const relevant = txt.includes("hatchback") || txt.includes("sedan") || txt.includes("station") || txt.includes("suv") || txt.includes("coupe") || txt.includes("cabrio") || txt.includes("wagon") || txt.includes("hb");
            return visible && saneSize && notNav && relevant && tag !== "body" && tag !== "html";
        });

    const bodyAliases = [];
    if (wanted.includes("hatchback")) bodyAliases.push("hatchback", "hatchback 5", "hb");
    if (wanted.includes("sedan")) bodyAliases.push("sedan");
    if (wanted.includes("station")) bodyAliases.push("station", "station wagon", "wagon");
    if (wanted.includes("suv")) bodyAliases.push("suv", "crossover");
    if (wanted.includes("coupe")) bodyAliases.push("coupe");
    if (wanted.includes("cabrio")) bodyAliases.push("cabrio");
    if (!bodyAliases.length) bodyAliases.push(wanted);

    let match = null;

    // Önce tam veya çok yakın option text
    for (const alias of bodyAliases) {
        match = candidates.find(el => {
            const txt = normalizeTR(el.innerText || el.textContent || "");
            return txt === alias || txt === alias + " 5 kapi" || txt === alias + " 3 kapi";
        });
        if (match) break;
    }

    // Sonra içeriyor kontrolü, ama büyük container değil; zaten filtreledik.
    if (!match) {
        for (const alias of bodyAliases) {
            match = candidates.find(el => {
                const txt = normalizeTR(el.innerText || el.textContent || "");
                return txt.includes(alias);
            });
            if (match) break;
        }
    }

    if (!match) {
        console.log("❌ VavaCars gövde tipi seçeneği bulunamadı:", bodyType, candidates.map(el => textClean(el.innerText || el.textContent || "")).slice(0, 20));
        return false;
    }

    // Eğer match child ise en yakın gerçek clickable üst elemana çık; fakat büyük sayfa container'ına çıkma.
    const closestClickable = match.closest("button, a, li, [role='button'], [role='option'], mat-option, .mat-mdc-option, [data-test-id], [data-testid]");
    let clickable = closestClickable || match;

    const rect = clickable.getBoundingClientRect();
    if (rect.width > window.innerWidth * 0.95 || rect.height > window.innerHeight * 0.45) {
        console.log("❌ VavaCars gövde tipi için büyük container yakalandı, tıklama iptal:", textClean(clickable.innerText || clickable.textContent || ""));
        return false;
    }

    try {
        clickable.scrollIntoView({ block: "center", inline: "center" });
    } catch (e) {}

    setTimeout(() => {
        clickElementLikeHuman(clickable);
        console.log("✅ VavaCars gövde tipi tıklandı:", bodyType, "=>", textClean(clickable.innerText || clickable.textContent || ""));
    }, 250);

    return true;
}

function vavaHasNoOptionsPage() {
    const text = normalizeTR(document.body.innerText || "");
    return text.includes("secenek bulunmamaktadir") || text.includes("seçenek bulunmamaktadır");
}

function showVavaNoOptionNotice(v) {
    if (document.getElementById("ai-vava-no-option-notice")) return;
    const step = getVavaStepClean();
    const box = document.createElement("div");
    box.id = "ai-vava-no-option-notice";
    box.style.position = "fixed";
    box.style.left = "18px";
    box.style.bottom = "18px";
    box.style.zIndex = "2147483647";
    box.style.background = "#111827";
    box.style.color = "white";
    box.style.border = "2px solid #ef4444";
    box.style.borderRadius = "12px";
    box.style.padding = "12px 14px";
    box.style.fontSize = "13px";
    box.style.lineHeight = "1.45";
    box.style.boxShadow = "0 6px 22px rgba(0,0,0,.35)";
    box.style.maxWidth = "360px";
    box.innerHTML = `<b>🚗 VavaCars seçenek yok</b><br>Bu adımda VavaCars seçenek üretmedi: <b>${step}</b><br>Otomasyon durdu. Döngü oluşmaması için otomatik geri kapalıdır.<br>Gerekirse sen bir kez geri okuna basıp tekrar ilerletebilirsin.`;
    document.body.appendChild(box);
}

function findVavaPageBackButton() {
    console.log("VavaCars otomatik geri kapalı.");
    return null;
}

function handleVavaNoOptionsOnce(v) {
    const step = getVavaStepClean();
    const key = "ai_vava_no_option_pause_" + location.pathname;

    try {
        if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, String(Date.now()));
            console.log("VavaCars seçenek yok göründü; geri basılmayacak, kısa süre bekleniyor:", step);
        }
    } catch (e) {}

    showVavaNoOptionNotice(v);
    console.log("VavaCars seçenek yok; otomasyon bu adımda durdu. Döngü oluşmasın diye otomatik geri kapalı:", step);
    return true;
}

function getVavaOptionElementsForStep() {
    return Array.from(document.querySelectorAll(
        "button, a, [role='button'], mat-option, .mat-mdc-option, [role='option'], .cursor-pointer, .card, [class*='card'], [class*='option']"
    )).filter(el => {
        const rect = el.getBoundingClientRect();
        const txt = normalizeTR(el.innerText || el.textContent || "");
        const raw = textClean(el.innerText || el.textContent || "");
        const cls = normalizeTR(el.className || "");
        const aria = normalizeTR(el.getAttribute("aria-label") || "");
        const test = normalizeTR(el.getAttribute("data-test-id") || "");

        if (rect.width < 30 || rect.height < 18) return false;
        if (rect.top < 90) return false;
        if (!txt) return false;

        const bad =
            txt.includes("geri") ||
            txt.includes("nasıl çalışır") ||
            txt.includes("nasil calisir") ||
            txt.includes("giriş yap") ||
            txt.includes("giris yap") ||
            txt.includes("araç alın") ||
            txt.includes("arac alin") ||
            txt.includes("aracınızı satın") ||
            txt.includes("aracinizi satin") ||
            txt.includes("finansman") ||
            txt.includes("vavaservis") ||
            txt.includes("bu bilgiyi nasıl alabilirim") ||
            txt.includes("bu bilgiyi nasil alabilirim");

        if (bad) return false;

        const optionish =
            el.tagName.toLowerCase() === "button" ||
            el.tagName.toLowerCase() === "a" ||
            el.getAttribute("role") === "button" ||
            el.getAttribute("role") === "option" ||
            cls.includes("option") ||
            cls.includes("card") ||
            cls.includes("cursor") ||
            test.includes("option") ||
            aria.includes("sec") ||
            aria.includes("seç");

        return optionish && raw.length <= 80;
    });
}

function clickVavaTrimSafe(v) {
    const elements = getVavaOptionElementsForStep();

    console.log("VavaCars donanım seçenek adayları:", elements.map(e => textClean(e.innerText || e.textContent || "")));

    const best = chooseBestVehicleVersionOption(elements, v);

    if (best) {
        clickElementLikeHuman(best);
        console.log("✅ VavaCars donanım/versiyon güvenli skorla seçildi:", textClean(best.innerText || best.textContent || ""));
        return true;
    }

    // Donanım fiyatı ciddi etkiler. Motor/ED eşleşmesi yoksa ilk seçeneğe düşme.
    console.log("❌ VavaCars donanım için güvenli eşleşme yok. Manuel seçim gerekli.");
    return false;
}

function runVavaStep(v) {
    if (vavaHasNoOptionsPage()) {
        return handleVavaNoOptionsOnce(v);
    }
    const step = getVavaStepClean();
    console.log("🚗 VavaCars adım:", step);

    if (step === "year") {
        return clickVavaOption(String(v.yil || ""));
    }

    if (step === "brand") {
        return clickBestVavaOption([v.marka || ""]);
    }

    if (step === "model") {
        const modelCandidates = extractEngineModelCandidates(v);
        return clickBestVavaOption(modelCandidates);
    }

    if (step === "body") {
        return clickVavaBodyType(v.kasa || "");
    }

    if (step === "transmission") {
        return clickBestVavaOption([normalizeVavaVites(v.vites || "")]);
    }

    if (step === "fuel") {
        return clickBestVavaOption([normalizeVavaFuel(v.yakit || "")]);
    }

    if (step === "color") {
        return clickVavaColor(v.renk || "");
    }

    if (step === "trim") {
        return clickVavaTrimSafe(v);
    }

    if (step === "vehicle_info") {
        return setVavaKm(v);
    }

    return false;
}

function initVavaCars() {
    showExternalSitePanel();

    const hashData = readAiDataFromHash();

    getCarData((stored) => {
        const v = hashData || stored;
        if (!v) return;

        if (location.pathname === "/" || location.pathname === "") {
            setTimeout(() => {
                location.href = "https://tr.vava.cars/sell/valuation/year";
            }, 2000);
            return;
        }

        let lastStep = "";
        let lastRunTime = 0;

        const watcher = () => {
            const step = getVavaStepClean();

            if (step === "unknown") return;

            const now = Date.now();

            if (step !== lastStep) {
                lastStep = step;
                lastRunTime = 0;
            }

            if (now - lastRunTime < 9000) return;

            lastRunTime = now;

            setTimeout(() => {
                runVavaStep(v);
            }, 3000);
        };

        watcher();

        const timer = setInterval(watcher, 1000);

        const observer = new MutationObserver(() => watcher());
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });

        setTimeout(() => {
            clearInterval(timer);
            observer.disconnect();
        }, 120000);
    });
}

function init() {
    const host = location.hostname;

    if (host.includes("sahibinden.com")) {
        initSahibinden();
        return;
    }

    if (host.includes("arabam.com")) {
        initArabam();
        return;
    }

    if (host.includes("vava.cars")) {
        initVavaCars();
        return;
    }
}

try {
    init();
} catch (err) {
    console.error("AI Araç Analizi init hatası:", err);
}
