import os
import re
import streamlit as st
from openai import OpenAI

# -----------------------
# SAYFA AYARLARI
# -----------------------
st.set_page_config(
    page_title="AI Araç Analizi",
    page_icon="🚗",
    layout="centered"
)

st.markdown("""
<style>
html, body, [data-testid="stAppViewContainer"] {
    overscroll-behavior-y: none;
}
section.main {
    overscroll-behavior-y: contain;
}
[data-testid="stAppViewContainer"] {
    height: 100vh;
    overflow-y: auto;
}
</style>
""", unsafe_allow_html=True)

st.title("🚗 AI Araç Analizi")
st.caption("Mobil ikinci el araç analiz sistemi")

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# -----------------------
# BASİT PİYASA DB
# -----------------------
PIYASA_DB = {
    "clio5_2020": {"avg": 950000, "min": 880000, "max": 1020000},
    "corolla_2019": {"avg": 920000, "min": 860000, "max": 990000},
}

# -----------------------
# YARDIMCI FONKSİYONLAR
# -----------------------
def temiz_sayi(deger):
    try:
        if deger is None:
            return 0

        text = str(deger)
        text = text.replace("TL", "")
        text = text.replace("tl", "")
        text = text.replace("KM", "")
        text = text.replace("km", "")
        text = text.replace("cc", "")
        text = text.replace("hp", "")
        text = text.replace(".", "")
        text = text.replace(",", "")
        text = text.strip()

        sadece_rakam = re.sub(r"[^\d]", "", text)

        if not sadece_rakam:
            return 0

        return int(sadece_rakam)
    except Exception:
        return 0


def parse_title(text):
    data = {"yil": 2020, "km": 100000, "vites": "Belirtilmemiş"}

    if not text:
        return data

    lower_text = text.lower()

    yil = re.search(r"\b(19\d{2}|20\d{2})\b", text)
    if yil:
        data["yil"] = int(yil.group())

    km = re.search(r"(\d{2,3}(?:[.,]\d{3})+|\d{4,6})\s*km", lower_text)
    if km:
        data["km"] = temiz_sayi(km.group(1))

    if "yarı otomatik" in lower_text or "yari otomatik" in lower_text:
        data["vites"] = "Yarı Otomatik"
    elif "manuel" in lower_text:
        data["vites"] = "Manuel"
    elif "otomatik" in lower_text:
        data["vites"] = "Otomatik"

    return data


def market_key(baslik, yil):
    text = baslik.lower() if baslik else ""

    if "clio" in text:
        return f"clio5_{yil}"

    if "corolla" in text:
        return f"corolla_{yil}"

    return None


def piyasa_fiyat_hesapla(baslik, yil, ref):
    key = market_key(baslik, yil)

    if key and key in PIYASA_DB:
        return PIYASA_DB[key]["avg"]

    return int(ref * 0.92) if ref else 0


def karar_ver(fiyat, piyasa):
    if not fiyat or not piyasa:
        return "VERİ YETERSİZ"

    oran = ((fiyat - piyasa) / piyasa) * 100

    if oran < -5:
        return "🔥 KAÇIRMA"
    elif oran < 5:
        return "🟢 ALINABİLİR"
    elif oran < 15:
        return "🟡 PAZARLIK"
    else:
        return "❌ UZAK DUR"


def dis_degerleme_linkleri():
    st.write("### 🌐 Dış Değerleme Siteleri")
    st.caption("Bu butonlar siteleri açar. Form otomatik doldurma işlemini Chrome eklentisi yapar.")

    col_a, col_b, col_c = st.columns(3)

    with col_a:
        st.link_button("🚘 Trink Sat", "https://www.arabam.com/trink-sat")

    with col_b:
        st.link_button("🚘 VavaCars", "https://tr.vava.cars/sell/valuation")

    with col_c:
        st.link_button("🚘 Otoplus", "https://www.otoplus.com/arabam-ne-kadar-eder")


def ai_ekspert_raporu(veri):
    prompt = f"""
Sen profesyonel bir ikinci el araç eksperisin.

Aşağıdaki aracı değerlendir:

Marka: {veri["marka"]}
Seri: {veri["seri"]}
Model: {veri["model"]}
Başlık: {veri["baslik"]}
Yıl: {veri["yil"]}
KM: {veri["km"]}
Yakıt Tipi: {veri["yakit"]}
Vites: {veri["vites"]}
Kasa Tipi: {veri["kasa"]}
Motor Gücü: {veri["motor_gucu"]}
Motor Hacmi: {veri["motor_hacmi"]}
Ağır Hasar Kayıtlı: {veri["agir_hasar"]}

Fiyat: {veri["fiyat"]} TL
Tramer: {veri["tramer"]} TL
Boya: {veri["boya"]}
Değişen: {veri["degisen"]}

Piyasa Fiyatı: {veri["piyasa"]} TL
Referans Fiyat: {veri["ref"]} TL
Risk Skoru: {veri["risk"]}/100
Karar: {veri["karar"]}

Fırsat Durumu: {veri["firsat"]}
Fırsat Oranı: %{veri["firsat_orani"]:.1f}

Önemli not:
- Boya, değişen ve tramer bilgisi boşsa bunu kesin bilgi gibi yorumlama.
- Ağır hasar kayıtlı bilgisi "Hayır" ise bunu olumlu kabul et.
- Araç yaşı, km, yakıt tipi, motor hacmi ve fiyatı birlikte değerlendir.

Şu formatta kısa, net ve kullanıcı dostu cevap ver:

1. Genel Değerlendirme
2. Fiyat Analizi
3. Risk Durumu
4. Pazarlık Önerisi
5. Net Karar: AL / BEKLE / UZAK DUR
"""

    try:
        res = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4
        )

        return res.choices[0].message.content

    except Exception as e:
        return f"AI analiz hatası: {e}"


# -----------------------
# URL PARAMETRELERİ
# -----------------------
query_params = st.query_params

otomatik_link = query_params.get("ilan", "")
otomatik_baslik = query_params.get("baslik", "")
otomatik_fiyat = query_params.get("fiyat", "")

otomatik_yil = temiz_sayi(query_params.get("yil", 2020))
otomatik_km = temiz_sayi(query_params.get("km", 100000))
otomatik_vites = query_params.get("vites", "Belirtilmemiş")

otomatik_tramer = temiz_sayi(query_params.get("tramer", 0))
otomatik_boya = temiz_sayi(query_params.get("boya", 0))
otomatik_degisen = temiz_sayi(query_params.get("degisen", 0))

otomatik_marka = query_params.get("marka", "")
otomatik_seri = query_params.get("seri", "")
otomatik_model = query_params.get("model", "")
otomatik_yakit = query_params.get("yakit", "")
otomatik_kasa = query_params.get("kasa", "")
otomatik_motor_gucu = query_params.get("motor_gucu", "")
otomatik_motor_hacmi = query_params.get("motor_hacmi", "")
otomatik_agir_hasar = query_params.get("agir_hasar", "")

if otomatik_yil <= 0:
    otomatik_yil = 2020

if otomatik_km <= 0:
    otomatik_km = 100000

# -----------------------
# FORM
# -----------------------
ilan_linki = st.text_input(
    "İlan linkini yapıştır",
    value=otomatik_link,
    placeholder="Sahibinden linkini buraya yapıştır"
)

if ilan_linki:
    st.info("Link algılandı. Eklenti ile gelen bilgiler otomatik doldurulduysa doğrudan analiz alınabilir.")

baslik = st.text_input(
    "İlan Başlığı",
    value=otomatik_baslik,
    placeholder="Örnek: 2020 Renault Clio 1.5 Blue dCi Otomatik 85.000 km"
)

if st.button("Başlıktan Yıl / KM / Vites Doldur"):
    parsed = parse_title(baslik)
    st.session_state["yil"] = parsed["yil"]
    st.session_state["km"] = parsed["km"]
    st.session_state["vites"] = parsed["vites"]
    st.rerun()

st.write("### 🔧 Araç Teknik Bilgileri")

col3, col4 = st.columns(2)

with col3:
    marka = st.text_input("Marka", value=otomatik_marka)
    seri = st.text_input("Seri", value=otomatik_seri)
    model = st.text_input("Model", value=otomatik_model)
    yakit = st.text_input("Yakıt Tipi", value=otomatik_yakit)

with col4:
    kasa = st.text_input("Kasa Tipi", value=otomatik_kasa)
    motor_gucu = st.text_input("Motor Gücü", value=otomatik_motor_gucu)
    motor_hacmi = st.text_input("Motor Hacmi", value=otomatik_motor_hacmi)
    agir_hasar = st.text_input("Ağır Hasar Kayıtlı", value=otomatik_agir_hasar)

col1, col2 = st.columns(2)

with col1:
    yil = st.number_input(
        "Yıl",
        min_value=1990,
        max_value=2026,
        value=st.session_state.get("yil", otomatik_yil)
    )

with col2:
    km = st.number_input(
        "KM",
        min_value=0,
        max_value=1000000,
        value=st.session_state.get("km", otomatik_km),
        step=1000
    )

vites_listesi = ["Belirtilmemiş", "Manuel", "Otomatik", "Yarı Otomatik"]

if otomatik_vites not in vites_listesi:
    otomatik_vites = "Belirtilmemiş"

vites = st.selectbox(
    "Vites",
    vites_listesi,
    index=vites_listesi.index(st.session_state.get("vites", otomatik_vites))
)

fiyat_text = st.text_input(
    "İlan Fiyatı",
    value=otomatik_fiyat,
    placeholder="Örnek: 950.000"
)

fiyat = temiz_sayi(fiyat_text)

st.write("### 🧾 Hasar Bilgileri")

tramer_text = st.text_input(
    "Tramer Tutarı",
    value=str(otomatik_tramer) if otomatik_tramer else "",
    placeholder="Örnek: 3000"
)

tramer = temiz_sayi(tramer_text)

boya = st.number_input(
    "Boya Sayısı",
    min_value=0,
    max_value=20,
    value=otomatik_boya
)

degisen = st.number_input(
    "Değişen Sayısı",
    min_value=0,
    max_value=20,
    value=otomatik_degisen
)

# -----------------------
# ANALİZ
# -----------------------
auto_run = bool("ilan" in query_params and baslik and fiyat > 0)

if st.button("🚀 Hızlı Analiz") or auto_run:
    if not baslik:
        st.warning("Önce ilan başlığını gir.")
        st.stop()

    if fiyat <= 0:
        st.warning("Önce ilan fiyatını gir.")
        st.stop()

    st.success("Analiz başlatılıyor...")

    ref = fiyat
    ref -= (2026 - yil) * 5000

    if km > 200000:
        ref -= 60000
    elif km > 150000:
        ref -= 30000
    elif km < 80000:
        ref += 20000

    ref -= int(tramer * 0.3)
    ref -= int(boya * 4000)
    ref -= int(degisen * 15000)

    if ref < 0:
        ref = 0

    piyasa = piyasa_fiyat_hesapla(baslik, yil, ref)

    alim_alt = int(ref * 0.92)
    alim_ust = int(ref * 0.97)

    sat_alt = int(ref * 1.00)
    sat_ust = int(ref * 1.05)

    fark = fiyat - ref
    yuzde = (fark / ref) * 100 if ref else 0

    pazarlik = max(0, fiyat - alim_ust)
    pot_kar = sat_alt - fiyat

    risk = 0
    if km > 200000:
        risk += 20
    if tramer > 50000:
        risk += 20
    if degisen > 0:
        risk += 20
    if agir_hasar.strip().lower() in ["evet", "var", "ağır hasarlı", "agir hasarli"]:
        risk += 25
    if fiyat > sat_ust:
        risk += 20

    risk = min(risk, 100)

    karar = karar_ver(fiyat, piyasa)

    # -----------------------
    # FIRSAT ANALİZİ
    # -----------------------
    firsat_orani = ((piyasa - fiyat) / piyasa) * 100 if piyasa else 0

    if firsat_orani >= 12:
        firsat = "🔥 KAÇIRMA"
    elif firsat_orani >= 5:
        firsat = "✅ FIRSAT"
    elif firsat_orani >= -5:
        firsat = "⚖️ NORMAL"
    else:
        firsat = "❌ PAHALI"

    st.divider()
    st.subheader("📊 Analiz Sonucu")

    st.info(f"Fırsat Durumu: {firsat} ({firsat_orani:.1f}%)")
    st.success(f"Karar: {karar}")

    st.metric("Piyasa Fiyatı", f"{piyasa:,.0f} TL")
    st.metric("Referans Fiyat", f"{ref:,.0f} TL")
    st.metric("Fiyat Farkı", f"{fark:,.0f} TL ({yuzde:.1f}%)")

    st.write("### 💰 Alım / Satım Bandı")
    st.write(f"Alım Bandı: {alim_alt:,.0f} - {alim_ust:,.0f} TL")
    st.write(f"Satış Bandı: {sat_alt:,.0f} - {sat_ust:,.0f} TL")

    st.write("### 💸 Pazarlık")
    st.write(f"Önerilen pazarlık payı: {pazarlik:,.0f} TL")

    st.write("### 📈 Potansiyel Kar")
    st.write(f"{pot_kar:,.0f} TL")

    st.write("### ⚠️ Risk")
    st.progress(risk)
    st.write(f"{risk}/100")

    veri = {
        "marka": marka,
        "seri": seri,
        "model": model,
        "yakit": yakit,
        "kasa": kasa,
        "motor_gucu": motor_gucu,
        "motor_hacmi": motor_hacmi,
        "agir_hasar": agir_hasar,
        "baslik": baslik,
        "yil": yil,
        "km": km,
        "vites": vites,
        "fiyat": fiyat,
        "tramer": tramer,
        "boya": boya,
        "degisen": degisen,
        "piyasa": piyasa,
        "ref": ref,
        "risk": risk,
        "karar": karar,
        "firsat": firsat,
        "firsat_orani": firsat_orani
    }

    with st.spinner("🤖 AI ekspert raporu hazırlanıyor..."):
        ai_rapor = ai_ekspert_raporu(veri)

    st.subheader("🤖 AI Ekspert Raporu")
    st.write(ai_rapor)

    dis_degerleme_linkleri()
