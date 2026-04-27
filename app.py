import os
import streamlit as st
st.markdown("## 🚗 Araç Analiz")

ilan_linki = st.text_input(
    "İlan linkini yapıştır",
    placeholder="Sahibinden linkini buraya yapıştır"
)

if ilan_linki:
    st.info("Link algılandı, analiz hazır...")

if ilan_linki and st.button("🚀 Hızlı Analiz"):
    st.success("Analiz başlatılıyor...")

from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def ai_ekspert_raporu(veri):
    prompt = f"""
Sen profesyonel bir ikinci el araç eksperisin.

Aşağıdaki aracı değerlendir:

Başlık: {veri['baslik']}
Yıl: {veri['yil']}
KM: {veri['km']}
Fiyat: {veri['fiyat']}
Durum: {veri['durum']}
Tramer: {veri['tramer']}
Boya: {veri['boya']}
Değişen: {veri['degisen']}
Piyasa: {veri['piyasa']}

Şu formatta net ve kısa cevap ver:

1. Genel değerlendirme
2. Fiyat durumu (ucuz / pahalı / uygun)
3. Risk analizi
4. Pazarlık önerisi
5. Net karar (AL / BEKLE / UZAK DUR)
"""

    res = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}]
    )

    return res.choices[0].message.content

def ai_ekspert_raporu(veri):
    prompt = f"""
Sen profesyonel bir ikinci el araç eksperisin.

Aşağıdaki aracı değerlendir:

Başlık: {veri['baslik']}
Yıl: {veri['yil']}
KM: {veri['km']}
Fiyat: {veri['fiyat']}
Durum: {veri['durum']}
Tramer: {veri['tramer']}
Boya: {veri['boya']}
Değişen: {veri['degisen']}
Piyasa Fiyatı: {veri['piyasa']}

Şu formatta cevap ver:

1. Genel Değerlendirme
2. Fiyat analizi (ucuz / pahalı / uygun)
3. Risk durumu
4. Pazarlık önerisi
5. Net karar (AL / BEKLE / UZAK DUR)
"""

    res = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}]
    )

    return res.choices[0].message.content

PIYASA_DB = {
    "clio5_2020": {
        "avg": 950000,
        "min": 880000,
        "max": 1020000
    },
    "corolla_2019": {
        "avg": 920000,
        "min": 860000,
        "max": 990000
    }
}

def market_key(baslik, yil):
    text = baslik.lower() if baslik else ""

    if "clio" in text:
        return f"clio5_{yil}"
    if "corolla" in text:
        return f"corolla_{yil}"

    return None

def piyasa_fiyat_hesapla(baslik, yil):
    key = market_key(baslik, yil)

    if key and key in PIYASA_DB:
        return PIYASA_DB[key]["avg"]

    return None

import streamlit as st
import requests
from bs4 import BeautifulSoup
import re

st.set_page_config(
    page_title="Araç Analiz",
    page_icon="🚗",
    layout="centered"
)

st.title("🚗 Araç Analiz Asistanı")
st.caption("Mobil araç fiyat analiz sistemi")

# -----------------------
# PARSE FONKSİYONU
# -----------------------
def parse_title(text):
    data = {"yil": None, "km": None, "vites": "Otomatik"}

    if not text:
        return data

    yil = re.search(r"\b(19\d{2}|20\d{2})\b", text)
    if yil:
        data["yil"] = int(yil.group())

    km = re.search(r"(\d{2,3}(?:[.,]\d{3})+|\d{4,6})\s*km", text.lower())
    if km:
        val = km.group(1).replace(".", "").replace(",", "")
        if val.isdigit():
            data["km"] = int(val)

    if "manuel" in text.lower():
        data["vites"] = "Manuel"
    elif "yarı" in text.lower():
        data["vites"] = "Yarı Otomatik"

    return data


# -----------------------
# İLANDAN VERİ ÇEKME
# -----------------------
def ilandan_veri_cek(url):
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept-Language": "tr-TR,tr;q=0.9",
            "Referer": "https://www.google.com/"
        }

        r = requests.get(url, headers=headers, timeout=10)

        if r.status_code != 200:
            return None, None

        soup = BeautifulSoup(r.text, "html.parser")

        baslik = soup.find("title")
        baslik = baslik.text.strip() if baslik else ""

        fiyat = None
        price_tag = soup.find("meta", {"itemprop": "price"})
        if price_tag and price_tag.get("content"):
            try:
                fiyat = int(price_tag["content"])
            except:
                fiyat = None

        return baslik, fiyat

    except:
        return None, None


# -----------------------
# KARAR MOTORU
# -----------------------
def karar_ver(fiyat, piyasa):
    if not fiyat or not piyasa:
        return "VERİ YETERSİZ"

    fark = fiyat - piyasa
    oran = (fark / piyasa) * 100

    if oran < -5:
        return "🔥 KAÇIRMA"
    elif oran < 5:
        return "🟢 ALINABİLİR"
    elif oran < 15:
        return "🟡 PAZARLIK"
    else:
        return "❌ UZAK DUR"


# -----------------------
# INPUTS
# -----------------------
ilan_linki = st.text_input("İlan Linki", key="link")

baslik = st.text_input(
    "İlan Başlığı",
    value=st.session_state.get("ilan_basligi", ""),
    key="baslik"
)

col1, col2 = st.columns(2)

with col1:
    yil = st.number_input("Yıl", value=st.session_state.get("yil", 2020))

with col2:
    km = st.number_input("KM", value=st.session_state.get("km", 100000))

fiyat = st.text_input("İlan Fiyatı")

if fiyat:
    fiyat = int(fiyat.replace(".", "").replace(",", ""))
else:
    fiyat = 0
try:
    fiyat = int(fiyat.replace(".", "").replace(",", ""))
except:
    fiyat = 0

durum = st.selectbox("Durum", ["Temiz", "Orta", "Yıpranmış"])
tramer = st.number_input("Tramer", value=0)
boya = st.number_input("Boya", value=0)
degisen = st.number_input("Değişen", value=0)


# -----------------------
# FONKSİYON BUTONU
# -----------------------
if st.button("Linkten Çek"):

    if ilan_linki:

        b, scraped_fiyat = ilandan_veri_cek(ilan_linki)

        # Başlık varsa kaydet
        if b:
            st.session_state["ilan_basligi"] = b

        # Fiyat varsa kullan, yoksa dokunma
        if scraped_fiyat:
            st.session_state["fiyat"] = scraped_fiyat

        st.success("Veri çekme tamamlandı (varsa dolduruldu)")
        st.rerun()

    else:
        st.warning("Link gir")


# -----------------------
# BAŞLIKTAN DOLDUR
# -----------------------
if st.button("Başlıktan Doldur"):
    parsed = parse_title(baslik)
    st.session_state.update(parsed)
    st.rerun()


# -----------------------
# ANALİZ
# -----------------------

if st.button("Analiz Et"):

    # -------------------------
    # REFERANS HESAP
    # -------------------------
    ref = fiyat

    ref -= (2026 - yil) * 5000

    if km > 200000:
        ref -= 60000
    elif km > 150000:
        ref -= 30000
    elif km < 80000:
        ref += 20000

    if durum == "Temiz":
        ref += 30000
    elif durum == "Yıpranmış":
        ref -= 50000

    ref -= tramer * 0.3
    ref -= boya * 4000
    ref -= degisen * 15000

    # -------------------------
    # PİYASA
    # -------------------------
    piyasa = piyasa_fiyat_hesapla(baslik, yil)

    if piyasa is None:
        piyasa = ref * 0.92

    # -------------------------
    # BANDLAR
    # -------------------------
    alim_alt = int(ref * 0.92)
    alim_ust = int(ref * 0.97)

    sat_alt = int(ref * 1.00)
    sat_ust = int(ref * 1.05)

    kurumsal = int(ref * 0.90)

    # -------------------------
    # FARK
    # -------------------------
    fark = fiyat - ref
    yuzde = (fark / ref) * 100 if ref else 0

    pazarlik = max(0, fiyat - alim_ust)
    pot_kar = sat_alt - fiyat

    # -------------------------
    # RİSK
    # -------------------------
    risk = 0
    if km > 200000: risk += 20
    if tramer > 50000: risk += 20
    if degisen > 0: risk += 20
    if fiyat > sat_ust: risk += 20
    if durum == "Yıpranmış": risk += 20

    # -------------------------
    # KARAR
    # -------------------------
    karar = karar_ver(fiyat, piyasa)

    st.success(f"Karar: {karar}")

    # -------------------------
    # OUTPUT
    # -------------------------
    st.divider()
    st.subheader("📊 ANALİZ")

    st.metric("Piyasa Fiyatı", f"{piyasa:,.0f} TL")
    st.metric("Referans", f"{ref:,.0f} TL")
    st.metric("Fiyat Farkı", f"{fark:,.0f} TL ({yuzde:.1f}%)")

    st.write("### 💰 Alım / Satım Bandı")
    st.write(f"Alım: {alim_alt:,} - {alim_ust:,}")
    st.write(f"Satış: {sat_alt:,} - {sat_ust:,}")

    st.write("### 💸 Pazarlık")
    st.write(f"{pazarlik:,} TL")

    st.write("### 📈 Potansiyel Kar")
    st.write(f"{pot_kar:,} TL")

    st.write("### ⚠️ Risk")
    st.progress(risk)
    st.write(f"{risk}/100")

    # -------------------------
    # 🤖 AI EKSPERT RAPOR
    # -------------------------
    veri = {
        "baslik": baslik,
        "yil": yil,
        "km": km,
        "fiyat": fiyat,
        "durum": durum,
        "tramer": tramer,
        "boya": boya,
        "degisen": degisen,
        "piyasa": piyasa
    }

    with st.spinner("🤖 AI ekspert raporu hazırlanıyor..."):
        ai_rapor = ai_ekspert_raporu(veri)

    st.subheader("🤖 AI Ekspert Raporu")
    st.write(ai_rapor)