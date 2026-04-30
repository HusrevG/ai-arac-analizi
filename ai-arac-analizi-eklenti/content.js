/* global chrome */

const APP_URL = "https://44meul58gm9v8negqbk8p5.streamlit.app";

const VALUATION_URLS = [
    "https://www.arabam.com/trink-sat",
    "https://tr.vava.cars/sell/valuation",
    "https://www.otoplus.com/arabam-ne-kadar-eder"
];

function textClean(value) {
    return (value || "").replace(/\s+/g, " ").trim();
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
    if (!element || value === undefined || value === null || value === "") return false;

    const lastValue = element.value;
    element.value = String(value);

    const tracker = element._valueTracker;
    if (tracker) tracker.setValue(lastValue);

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    return true;
}

function selectOptionByText(select, wantedText) {
    if (!select || !wantedText) return false;

    const normalizedWanted = textClean(String(wantedText)).toLowerCase();
    const options = Array.from(select.options || []);

    let match = options.find(opt => textClean(opt.textContent).toLowerCase() === normalizedWanted);
    if (!match) {
        match = options.find(opt => textClean(opt.textContent).toLowerCase().includes(normalizedWanted));
    }
    if (!match) {
        match = options.find(opt => normalizedWanted.includes(textClean(opt.textContent).toLowerCase()));
    }

    if (!match) return false;

    select.value = match.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
}

function findInputByHints(hints) {
    const inputs = Array.from(document.querySelectorAll("input, textarea"));
    const lowerHints = hints.map(x => x.toLowerCase());

    return inputs.find(input => {
        const text = [
            input.name,
            input.id,
            input.placeholder,
            input.getAttribute("aria-label"),
            input.getAttribute("data-testid"),
            input.getAttribute("autocomplete")
        ].filter(Boolean).join(" ").toLowerCase();

        return lowerHints.some(h => text.includes(h));
    });
}

function getTitle() {
    const h1 = document.querySelector("h1");
    if (h1) return textClean(h1.innerText);

    const title = document.querySelector("title");
    if (title) return textClean(title.innerText);

    return "";
}

function getPrice() {
    const bodyText = document.body.innerText;
    const patterns = [
        /([\d.]{5,})\s*TL/i,
        /Fiyat\s*[:\n ]+\s*([\d.,]+)/i
    ];

    for (const pattern of patterns) {
        const match = bodyText.match(pattern);
        if (match) return match[1];
    }
    return "";
}

function getInfoFromRows() {
    const info = {};
    const rows = document.querySelectorAll(".classifiedInfoList li, .classifiedInfo li, li");

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
    if (titleMatch) return titleMatch[0];

    return "";
}

function getKm(title, info) {
    const value = info["KM"] || info["Kilometre"] || "";
    const match = value.match(/[\d.,]+/);
    if (match) return match[0];

    const titleMatch = title.match(/(\d{2,3}(?:[.,]\d{3})+|\d{4,6})\s*km/i);
    if (titleMatch) return titleMatch[1];

    return "";
}

function getGear(title, info) {
    const value = (info["Vites"] || "").toLowerCase();
    if (value.includes("manuel")) return "Manuel";
    if (value.includes("yarı")) return "Yarı Otomatik";
    if (value.includes("otomatik")) return "Otomatik";

    const titleText = title.toLowerCase();
    if (titleText.includes("manuel")) return "Manuel";
    if (titleText.includes("yarı otomatik")) return "Yarı Otomatik";
    if (titleText.includes("otomatik")) return "Otomatik";

    return "";
}

function getDamageInfo() {
    const bodyText = document.body.innerText;
    let tramer = "";
    let boya = "";
    let degisen = "";

    const tramerMatch = bodyText.match(/(?:tramer|hasar kaydı|hasar)\D{0,40}([\d.,]+)/i);
    if (tramerMatch) tramer = tramerMatch[1];

    function countItemsAfterHeader(headerText, stopHeaders) {
        const lines = bodyText.split("\n").map(x => textClean(x)).filter(Boolean);
        let started = false;
        let count = 0;

        for (const line of lines) {
            const lower = line.toLowerCase();
            if (lower.includes(headerText.toLowerCase())) {
                started = true;
                continue;
            }

            if (started) {
                if (stopHeaders.some(stop => lower.includes(stop.toLowerCase()))) return count;

                const ignore = ["orijinal", "lokal boyalı", "boyalı", "değişen", "boyalı veya değişen parça"];
                if (ignore.some(x => lower === x)) continue;

                if (
                    lower.includes("kaput") ||
                    lower.includes("çamurluk") ||
                    lower.includes("kapı") ||
                    lower.includes("tavan") ||
                    lower.includes("bagaj") ||
                    lower.includes("tampon")
                ) count += 1;
            }
        }
        return count;
    }

    const boyaliSayisi = countItemsAfterHeader("Boyalı Parçalar", ["Değişen Parçalar", "Özellikler"]);
    const degisenSayisi = countItemsAfterHeader("Değişen Parçalar", ["Özellikler", "Açıklama", "İlan Bilgileri"]);

    if (boyaliSayisi > 0) boya = String(boyaliSayisi);
    if (degisenSayisi > 0) degisen = String(degisenSayisi);

    if (!boya && bodyText.includes("Değişen ve boyalı parçası bulunmamaktadır")) boya = "0";
    if (!degisen && bodyText.includes("Değişen ve boyalı parçası bulunmamaktadır")) degisen = "0";

    return { tramer, boya, degisen };
}

function collectSahibindenCarData() {
    const info = getInfoFromRows();
    const baslik = getTitle();
    const fiyat = getPrice();
    const yil = getYear(baslik, info);
    const km = getKm(baslik, info);
    const vites = getGear(baslik, info);
    const damage = getDamageInfo();

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
        tramer: damage.tramer,
        boya: damage.boya,
        degisen: damage.degisen
    };
}

function buildStreamlitUrl(v) {
    return APP_URL +
        "?ilan=" + encodeURIComponent(v.ilan || "") +
        "&baslik=" + encodeURIComponent(v.baslik || "") +
        "&fiyat=" + encodeURIComponent(v.fiyat || "") +
        "&yil=" + encodeURIComponent(v.yil || "") +
        "&km=" + encodeURIComponent(v.km || "") +
        "&vites=" + encodeURIComponent(v.vites || "") +
        "&tramer=" + encodeURIComponent(v.tramer || "") +
        "&boya=" + encodeURIComponent(v.boya || "") +
        "&degisen=" + encodeURIComponent(v.degisen || "") +
        "&marka=" + encodeURIComponent(v.marka || "") +
        "&seri=" + encodeURIComponent(v.seri || "") +
        "&model=" + encodeURIComponent(v.model || "") +
        "&yakit=" + encodeURIComponent(v.yakit || "") +
        "&kasa=" + encodeURIComponent(v.kasa || "") +
        "&motor_gucu=" + encodeURIComponent(v.motor_gucu || "") +
        "&motor_hacmi=" + encodeURIComponent(v.motor_hacmi || "") +
        "&agir_hasar=" + encodeURIComponent(v.agir_hasar || "");
}

function styleButton(btn, rightPx) {
    btn.style.position = "fixed";
    btn.style.bottom = "24px";
    btn.style.right = rightPx;
    btn.style.zIndex = "999999";
    btn.style.border = "none";
    btn.style.borderRadius = "10px";
    btn.style.padding = "11px 14px";
    btn.style.fontSize = "14px";
    btn.style.fontWeight = "700";
    btn.style.cursor = "pointer";
    btn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
}

function createSahibindenButtons() {
    if (document.getElementById("ai-arac-analizi-btn")) return;

    const aiBtn = document.createElement("button");
    aiBtn.id = "ai-arac-analizi-btn";
    aiBtn.innerText = "🚗 AI Analiz";
    styleButton(aiBtn, "24px");
    aiBtn.style.background = "#f59e0b";
    aiBtn.style.color = "#111827";

    aiBtn.addEventListener("click", () => {
        const aracData = collectSahibindenCarData();
        saveCarData(aracData, () => window.open(buildStreamlitUrl(aracData), "_blank"));
    });

    const externalBtn = document.createElement("button");
    externalBtn.id = "ai-dis-degerleme-btn";
    externalBtn.innerText = "🌐 Dış Değerleme Aç";
    styleButton(externalBtn, "145px");
    externalBtn.style.background = "#2563eb";
    externalBtn.style.color = "#ffffff";

    externalBtn.addEventListener("click", () => {
        const aracData = collectSahibindenCarData();
        saveCarData(aracData, () => {
            VALUATION_URLS.forEach((url, index) => {
                setTimeout(() => window.open(url, "_blank"), index * 250);
            });
        });
    });

    const titleArea = document.querySelector(".classifiedDetailTitle");
    if (titleArea) {
        aiBtn.style.position = "static";
        aiBtn.style.marginLeft = "10px";
        aiBtn.style.boxShadow = "none";
        externalBtn.style.position = "static";
        externalBtn.style.marginLeft = "8px";
        externalBtn.style.boxShadow = "none";
        titleArea.appendChild(aiBtn);
        titleArea.appendChild(externalBtn);
    } else {
        document.body.appendChild(aiBtn);
        document.body.appendChild(externalBtn);
    }
}

function showExternalSitePanel() {
    getCarData((v) => {
        if (!v) return;
        if (document.getElementById("ai-arac-panel")) return;

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
            Vites: ${v.vites || "-"}<br><br>
            <button id="ai-copy" style="width:100%;padding:8px;background:#0d6efd;color:white;border:0;border-radius:8px;cursor:pointer;">
                Kopyala
            </button>
        `;

        document.body.appendChild(panel);

        document.getElementById("ai-copy").onclick = () => {
            const text = `Marka: ${v.marka || ""}
Seri: ${v.seri || ""}
Model: ${v.model || ""}
Yıl: ${v.yil || ""}
KM: ${v.km || ""}
Yakıt: ${v.yakit || ""}
Vites: ${v.vites || ""}
Kasa: ${v.kasa || ""}
Motor Gücü: ${v.motor_gucu || ""}
Motor Hacmi: ${v.motor_hacmi || ""}
Ağır Hasar: ${v.agir_hasar || ""}
Tramer: ${v.tramer || ""}
Boya: ${v.boya || ""}
Değişen: ${v.degisen || ""}`;
            navigator.clipboard.writeText(text);
            alert("Kopyalandı");
        };
    });
}

function autoFillArabam(v) {
    setTimeout(() => {
        const brandSelect = document.querySelector("#brands");
        if (brandSelect) {
            const ok = selectOptionByText(brandSelect, v.marka);
            console.log(ok ? `✅ Arabam marka seçildi: ${v.marka}` : `❌ Arabam marka eşleşmedi: ${v.marka}`);
        } else {
            console.log("❌ Arabam #brands select bulunamadı.");
        }

        setNativeValue(findInputByHints(["km", "kilometre"]), v.km);
        setNativeValue(findInputByHints(["year", "yıl", "model yılı"]), v.yil);
    }, 1500);
}

function autoFillVavaCars(v) {
    setTimeout(() => {
        setNativeValue(findInputByHints(["km", "kilometre", "mileage"]), v.km);
        setNativeValue(findInputByHints(["year", "yıl", "model year"]), v.yil);
        console.log("AI Araç Analizi: VavaCars doldurma denendi.", v);
    }, 1500);
}

function autoFillOtoplus(v) {
    setTimeout(() => {
        setNativeValue(findInputByHints(["km", "kilometre"]), v.km);
        setNativeValue(findInputByHints(["year", "yıl", "model yılı"]), v.yil);
        console.log("AI Araç Analizi: Otoplus doldurma denendi.", v);
    }, 1500);
}

function init() {
    const host = location.hostname;

    if (host.includes("sahibinden.com")) {
        createSahibindenButtons();
        return;
    }

    if (host.includes("arabam.com")) {
        showExternalSitePanel();
        getCarData((v) => {
            if (v) autoFillArabam(v);
        });
        return;
    }

    if (host.includes("vava.cars")) {
        showExternalSitePanel();
        getCarData((v) => {
            if (v) autoFillVavaCars(v);
        });
        return;
    }

    if (host.includes("otoplus.com")) {
        showExternalSitePanel();
        getCarData((v) => {
            if (v) autoFillOtoplus(v);
        });
    }
}

init();
