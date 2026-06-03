import os
import re
import json
import urllib.parse
import uuid
import streamlit as st
import streamlit.components.v1 as components
from openai import OpenAI

APP_VERSION = "2026-06-03-v11.59-reset-key-only-safe-fix"

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
st.caption("PC detay sayfası + mobil manuel ikinci el araç analiz sistemi")
st.caption(f"Sürüm: {APP_VERSION}")

api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=api_key) if api_key else None

# -----------------------
# BASİT PİYASA DB
# -----------------------
PIYASA_DB = {
    "clio5_2020": {"avg": 950000, "min": 880000, "max": 1020000},
    "corolla_2019": {"avg": 920000, "min": 860000, "max": 990000},
}

HASAR_PARCA_LISTESI = [
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
    "Arka tampon",
]


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
        text = text.replace("₺", "")
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


def market_key(baslik, yil):
    text = baslik.lower() if baslik else ""

    if "clio" in text:
        return f"clio5_{yil}"

    if "corolla" in text:
        return f"corolla_{yil}"

    return None


def piyasa_fiyat_hesapla(baslik, yil, ref, fiyat=0):
    key = market_key(baslik, yil)

    if key and key in PIYASA_DB:
        db_avg = PIYASA_DB[key]["avg"]

        # İlan fiyatı ile DB ortalamasını harmanla
        if fiyat > 0:
            return int((db_avg * 0.65) + (fiyat * 0.35))

        return db_avg

    # DB yoksa ilan fiyatını merkez kabul et.
    if fiyat > 0:
        fark = abs(ref - fiyat)

        # Referans ile ilan fiyatı birbirine yakınsa
        # piyasayı ilan fiyatına çok yakın tut.
        if fark <= fiyat * 0.08:
            return int((fiyat * 0.85) + (ref * 0.15))

        # Ağır hasarlı / ciddi kusurlu araçlarda
        # referans etkisini biraz artır.
        return int((fiyat * 0.70) + (ref * 0.30))

    return ref if ref else 0


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


def firsat_skoru_hesapla(fiyat, yil, km, tramer_var, tramer, agir_hasar, boya_sayisi, degisen_sayisi):
    fiyat = temiz_sayi(fiyat)
    yil = temiz_sayi(yil)
    km = temiz_sayi(km)
    tramer = temiz_sayi(tramer)
    boya_sayisi = temiz_sayi(boya_sayisi)
    degisen_sayisi = temiz_sayi(degisen_sayisi)

    skor = 100
    riskler = []

    if km > 250000:
        skor -= 25
        riskler.append("Çok yüksek kilometre")
    elif km > 200000:
        skor -= 18
        riskler.append("Yüksek kilometre")
    elif km > 150000:
        skor -= 10
        riskler.append("Orta-yüksek kilometre")

    if yil < 2010:
        skor -= 18
        riskler.append("Araç yaşı yüksek")
    elif yil < 2015:
        skor -= 10
        riskler.append("Araç yaşına dikkat edilmeli")

    agir_hasar_text = str(agir_hasar).strip().lower()
    if agir_hasar_text in ["var", "evet", "true", "1", "ağır hasarlı", "agir hasarli"]:
        skor -= 35
        riskler.append("Ağır hasar kaydı var")

    if tramer_var == "Var":
        if tramer <= 0:
            skor -= 8
            riskler.append("Tramer var ama tutar girilmemiş")
        elif tramer > 150000:
            skor -= 20
            riskler.append("Tramer tutarı yüksek")
        elif tramer > 50000:
            skor -= 12
            riskler.append("Tramer tutarı dikkate alınmalı")
        else:
            skor -= 5
            riskler.append("Tramer kaydı var")

    if boya_sayisi >= 5:
        skor -= 15
        riskler.append("Boya sayısı yüksek")
    elif boya_sayisi >= 3:
        skor -= 8
        riskler.append("Birkaç parçada boya var")
    elif boya_sayisi >= 1:
        skor -= 3
        riskler.append("Boyalı parça var")

    if degisen_sayisi >= 2:
        skor -= 20
        riskler.append("Değişen parça sayısı yüksek")
    elif degisen_sayisi == 1:
        skor -= 10
        riskler.append("Değişen parça var")

    if fiyat > 0 and fiyat < 400000:
        skor -= 8
        riskler.append("Fiyat piyasa için olağan dışı düşük olabilir")

    skor = max(0, min(100, skor))

    if skor >= 80:
        karar = "🟢 Güçlü aday"
    elif skor >= 60:
        karar = "🟡 Pazarlıkla değerlendir"
    else:
        karar = "🔴 Uzak dur / Çok dikkatli incele"

    return skor, karar, riskler



# -----------------------
# 13 PARÇALI HASAR ŞEMASI
# -----------------------
# ÖNEMLİ:
# Bu bölüm URL/link tabanlı değildir.
# Parça tıklaması Streamlit custom component ile Python'a döner.
# Böylece yeni sekme açılmaz, URL değişmez, form alanları silinmez.
HASAR_DURUM_KODLARI = {"Orijinal": "0", "Boyalı": "1", "Değişen": "2"}
HASAR_KOD_DURUMLARI = {"0": "Orijinal", "1": "Boyalı", "2": "Değişen"}


HASAR_COMPONENT_DIR = os.path.join(os.path.dirname(__file__), "hasar_component")
hasar_map_component = components.declare_component(
    "hasar_map_component",
    path=HASAR_COMPONENT_DIR,
)


def hasar_durumlarini_hazirla():
    """Hasar durumlarını yalnızca session_state içinde tutar."""
    if "hasar_durumlari" not in st.session_state:
        st.session_state.hasar_durumlari = {
            parca: "Orijinal" for parca in HASAR_PARCA_LISTESI
        }

    if "hasar_reset_rev" not in st.session_state:
        st.session_state.hasar_reset_rev = 0

    # Eski/bozuk state gelirse güvenli şekilde 13 parça listesine normalize et.
    mevcut = st.session_state.get("hasar_durumlari", {})
    st.session_state.hasar_durumlari = {
        parca: mevcut.get(parca, "Orijinal")
        if mevcut.get(parca, "Orijinal") in ["Orijinal", "Boyalı", "Değişen"]
        else "Orijinal"
        for parca in HASAR_PARCA_LISTESI
    }



def hasar_parca_dongu(parca):
    """Orijinal -> Boyalı -> Değişen -> Orijinal döngüsü."""
    if parca not in HASAR_PARCA_LISTESI:
        return

    mevcut = st.session_state.hasar_durumlari.get(parca, "Orijinal")

    if mevcut == "Orijinal":
        st.session_state.hasar_durumlari[parca] = "Boyalı"
    elif mevcut == "Boyalı":
        st.session_state.hasar_durumlari[parca] = "Değişen"
    else:
        st.session_state.hasar_durumlari[parca] = "Orijinal"



def hasar_state_string_uret(durumlar):
    return "".join(
        HASAR_DURUM_KODLARI.get(durumlar.get(parca, "Orijinal"), "0")
        for parca in HASAR_PARCA_LISTESI
    )



def hasar_durumlarini_sifirla():
    st.session_state.hasar_durumlari = {
        parca: "Orijinal" for parca in HASAR_PARCA_LISTESI
    }
    st.session_state.hasar_last_nonce = ""
    st.session_state.hasar_reset_rev = st.session_state.get("hasar_reset_rev", 0) + 1



def hasar_semasi_goster():
    """Sahibinden benzeri 13 parçalı manuel hasar seçim şeması."""
    hasar_durumlarini_hazirla()

    st.write("#### 🚗 13 Parçalı Ekspertiz Şeması")
    st.caption("Araç üzerindeki parçaya tıkla: Orijinal → Boyalı → Değişen → Orijinal")

    clicked = hasar_map_component(
        state=st.session_state.hasar_durumlari,
        part_order=HASAR_PARCA_LISTESI,
        height=820,
        default=None,
        key=f"hasar_map_component_v11_59_{st.session_state.get('hasar_reset_rev', 0)}",
    )

    if isinstance(clicked, dict):
        nonce = str(clicked.get("nonce", ""))
        parca = clicked.get("part", "")

        # Aynı component değerinin tekrar tekrar işlenmesini engeller.
        if nonce and nonce != st.session_state.get("hasar_last_nonce"):
            st.session_state.hasar_last_nonce = nonce
            hasar_parca_dongu(parca)
            st.rerun()

    if st.button("🧹 Tüm hasar seçimlerini sıfırla", use_container_width=True):
        hasar_durumlarini_sifirla()
        st.rerun()

    boyali = [p for p in HASAR_PARCA_LISTESI if st.session_state.hasar_durumlari.get(p) == "Boyalı"]
    degisen = [p for p in HASAR_PARCA_LISTESI if st.session_state.hasar_durumlari.get(p) == "Değişen"]

    col_boya, col_degisen = st.columns(2)
    with col_boya:
        st.markdown("**Boyalı parçalar**")
        st.write(", ".join(boyali) if boyali else "Yok")
    with col_degisen:
        st.markdown("**Değişen parçalar**")
        st.write(", ".join(degisen) if degisen else "Yok")

    st.caption(f"Seçilen boya sayısı: {len(boyali)} | Seçilen değişen sayısı: {len(degisen)}")
    return boyali, degisen


def dis_degerleme_linkleri(arac_payload):
    payload_text = urllib.parse.quote(json.dumps(arac_payload, ensure_ascii=False))

    yil_degeri = temiz_sayi(arac_payload.get("yil", 0))
    km_degeri = temiz_sayi(arac_payload.get("km", 0))

    trink_enabled = True
    trink_reason = ""

    if yil_degeri < 2004:
        trink_enabled = False
        trink_reason = "Trink Sat 2004 model öncesi araçlara değerleme vermiyor."
    elif yil_degeri > 2025:
        trink_enabled = False
        trink_reason = "Trink Sat 2026 ve üzeri araçlara değerleme vermiyor."

    vavacars_enabled = True
    vava_reason = ""

    if yil_degeri < 2009:
        vavacars_enabled = False
        vava_reason = "VavaCars 2009 model öncesi araçlara değerleme vermiyor."
    elif yil_degeri > 2025:
        vavacars_enabled = False
        vava_reason = "VavaCars 2026 ve üzeri araçlara değerleme vermiyor."
    elif km_degeri > 200000:
        vavacars_enabled = False
        vava_reason = "VavaCars 200.000 KM üzeri araçları kabul etmiyor."

    trink_url = f"https://www.arabam.com/trink-sat/teklif-al/arac-secimi#ai_arac_data={payload_text}"
    vavacars_url = f"https://tr.vava.cars/#ai_arac_data={payload_text}"

    col_a, col_b = st.columns(2)

    with col_a:
        if trink_enabled:
            st.link_button("🚘 Trink Sat", trink_url)
        else:
            st.button("🚘 Trink Sat uygun değil", disabled=True)

        if trink_reason:
            st.caption(trink_reason)

    with col_b:
        if vavacars_enabled:
            st.link_button("🚘 VavaCars", vavacars_url)
        else:
            st.button("🚘 VavaCars uygun değil", disabled=True)

        if vava_reason:
            st.caption(vava_reason)


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
Tramer Durumu: {veri["tramer_var"]}
Tramer Tutarı: {veri["tramer"]} TL
Boya Sayısı: {veri["boya"]}
Boyalı Parçalar: {", ".join(veri["boyali_parcalar"]) if veri["boyali_parcalar"] else "Yok"}
Değişen Sayısı: {veri["degisen"]}
Değişen Parçalar: {", ".join(veri["degisen_parcalar"]) if veri["degisen_parcalar"] else "Yok"}

Piyasa Fiyatı: {veri["piyasa"]} TL
Referans Fiyat: {veri["ref"]} TL
Risk Skoru: {veri["risk"]}/100
Karar: {veri["karar"]}

Fırsat Durumu: {veri["firsat"]}
Fırsat Oranı: %{veri["firsat_orani"]:+.1f}
Fırsat Skoru: {veri["firsat_skor"]}/100
Fırsat Skoru Kararı: {veri["firsat_skor_karar"]}
Fırsat Skoru Riskleri: {", ".join(veri["firsat_riskler"]) if veri["firsat_riskler"] else "Belirgin ek risk yok"}

Önemli not:
- Tramer, boya ve değişen bilgileri kullanıcı tarafından manuel girilmiştir.
- Kullanıcı boş ya da 0 girdiyse bunu kesin kusursuzluk olarak yorumlama; yine ekspertiz öner.
- Ağır hasar kayıtlı bilgisi "Hayır" ise bunu olumlu kabul et.
- Araç yaşı, km, yakıt tipi, motor hacmi ve fiyatı birlikte değerlendir.
- Pahalı/fırsat yorumunu piyasa fiyatı ve referans fiyatla tutarlı yap.
- İlan fiyatını tamamen yok sayma.
- Ağır hasar, çok yüksek tramer, çok yüksek km veya ciddi değişen yoksa fiyatı aşırı düşük değerlendirme.
- Normal piyasa koşullarında alım bandını genelde ilan fiyatının %90-%100 aralığında tut.
- 950 bin TL civarı normal bir araç için sebepsiz şekilde 800-850 bin önerme.
- Fiyat yorumunda gerçek Türkiye ikinci el piyasasını baz al.

Şu formatta kısa, net ve kullanıcı dostu cevap ver:

1. Genel Değerlendirme
2. Fiyat Analizi
3. Risk Durumu
4. Pazarlık Önerisi
5. Net Karar: AL / BEKLE / UZAK DUR
"""

    if client is None:
        return "AI analiz hatası: OPENAI_API_KEY tanımlı değil."

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

otomatik_marka = query_params.get("marka", "")
otomatik_seri = query_params.get("seri", "")
otomatik_model = query_params.get("model", "")
otomatik_yakit = query_params.get("yakit", "")
otomatik_kasa = query_params.get("kasa", "")
otomatik_motor_gucu = query_params.get("motor_gucu", "")
otomatik_motor_hacmi = query_params.get("motor_hacmi", "")
otomatik_agir_hasar = query_params.get("agir_hasar", "")
otomatik_tramer_var = query_params.get("tramer_var", "Yok")
otomatik_tramer_tutari = query_params.get("tramer_tutari", "")

if otomatik_yil <= 0:
    otomatik_yil = 2020

if otomatik_km <= 0:
    otomatik_km = 100000

# Başlık ekranda gösterilmez; analiz için arkada oluşturulur.
baslik = f"{otomatik_marka} {otomatik_seri} {otomatik_model} {otomatik_yil}".strip()
if not baslik:
    baslik = otomatik_baslik

# -----------------------
# FORM
# -----------------------
ilan_linki = st.text_input(
    "İlan linkini yapıştır",
    value=otomatik_link,
    placeholder="Sahibinden linkini buraya yapıştır",
    key="ilan"
)

if ilan_linki:
    st.info("Link algılandı. Eklenti ile gelen bilgiler otomatik doldurulduysa doğrudan analiz alınabilir.")

st.write("### 🔧 Araç Teknik Bilgileri")

col3, col4 = st.columns(2)

with col3:
    marka = st.text_input("Marka", value=otomatik_marka, key="marka")
    seri = st.text_input("Seri", value=otomatik_seri, key="seri")
    model = st.text_input("Model", value=otomatik_model, key="model")
    yakit = st.text_input("Yakıt Tipi", value=otomatik_yakit, key="yakit")

with col4:
    kasa = st.text_input("Kasa Tipi", value=otomatik_kasa, key="kasa")
    motor_gucu = st.text_input("Motor Gücü", value=otomatik_motor_gucu, key="motor_gucu")
    motor_hacmi = st.text_input("Motor Hacmi", value=otomatik_motor_hacmi, key="motor_hacmi")
    agir_hasar = st.text_input("Ağır Hasar Kayıtlı", value=otomatik_agir_hasar, key="agir_hasar")

col1, col2 = st.columns(2)

with col1:
    yil = st.number_input(
        "Yıl",
        min_value=1990,
        max_value=2026,
        value=otomatik_yil,
        key="yil"
    )

with col2:
    km = st.number_input(
        "KM",
        min_value=0,
        max_value=1000000,
        value=otomatik_km,
        step=1000,
        key="km"
    )

vites_listesi = ["Belirtilmemiş", "Manuel", "Otomatik", "Yarı Otomatik"]

if otomatik_vites not in vites_listesi:
    otomatik_vites = "Belirtilmemiş"

vites = st.selectbox(
    "Vites",
    vites_listesi,
    index=vites_listesi.index(otomatik_vites),
    key="vites"
)

fiyat_text = st.text_input(
    "İlan Fiyatı",
    value=otomatik_fiyat,
    placeholder="Örnek: 950.000",
    key="fiyat"
)

fiyat = temiz_sayi(fiyat_text)

st.write("### 🧾 Hasar / Tramer Bilgileri")
st.caption("Hasar bilgileri manuel seçilir. Sistem boya/değişen/tramer verisi uydurmaz.")

if otomatik_tramer_var not in ["Yok", "Var"]:
    otomatik_tramer_var = "Yok"

tramer_var = st.selectbox(
    "Tramer Kaydı",
    ["Yok", "Var"],
    index=["Yok", "Var"].index(otomatik_tramer_var),
    key="tramer_var"
)

tramer_text = st.text_input(
    "Toplam Tramer Tutarı",
    value=otomatik_tramer_tutari,
    placeholder="Örnek: 25000",
    key="tramer_tutari"
)

tramer = temiz_sayi(tramer_text)

boyali_parcalar, degisen_parcalar = hasar_semasi_goster()

boya = len(boyali_parcalar)
degisen = len(degisen_parcalar)

ortak_parcalar = sorted(set(boyali_parcalar) & set(degisen_parcalar))
if ortak_parcalar:
    st.error("Aynı parça hem boyalı hem değişen seçilmiş. Lütfen düzelt: " + ", ".join(ortak_parcalar))

if "Tavan" in degisen_parcalar:
    st.warning("Tavan değişen seçildi. Bu yüksek riskli kabul edilir.")

st.caption(f"Seçilen boya sayısı: {boya} | Seçilen değişen sayısı: {degisen}")




# -----------------------
# ANALİZ
# -----------------------
auto_run = False  # Manuel hasar bilgileri girileceği için otomatik analiz kapalı

if st.button("🚀 Hızlı Analiz"):
    if fiyat <= 0:
        st.warning("Önce ilan fiyatını gir.")
        st.stop()

    if ortak_parcalar:
        st.warning("Aynı parça hem boyalı hem değişen olamaz. Önce hasar seçimlerini düzelt.")
        st.stop()

    st.success("Analiz başlatılıyor...")

    # -------------------------------------------------
    # GERÇEKÇİ REFERANS / PİYASA HESABI
    # -------------------------------------------------

    ref = fiyat

    # Yaş etkisi
    yas = max(0, 2026 - yil)

    if yas >= 15:
        ref -= 90000
    elif yas >= 10:
        ref -= 60000
    elif yas >= 5:
        ref -= 25000

    # KM etkisi
    if km > 300000:
        ref -= 120000
    elif km > 250000:
        ref -= 90000
    elif km > 200000:
        ref -= 60000
    elif km > 150000:
        ref -= 30000
    elif km < 80000:
        ref += 25000
    elif km < 50000:
        ref += 45000

    # Tramer etkisi
    if tramer_var == "Var" and tramer > 0:
        if tramer > 300000:
            ref -= int(tramer * 0.40)
        elif tramer > 150000:
            ref -= int(tramer * 0.35)
        elif tramer > 50000:
            ref -= int(tramer * 0.25)
        else:
            ref -= int(tramer * 0.15)

    # Boya / değişen etkisi
    ref -= int(boya * 3500)
    ref -= int(degisen * 18000)

    # Ağır hasar ciddi etki etsin
    if agir_hasar.strip().lower() in ["evet", "var", "ağır hasarlı", "agir hasarli"]:
        ref -= 120000

    # Referans fiyat ilan fiyatından kopup saçmalamasın.
    # Ağır kusur yoksa minimum %90 bandında kalsın.
    minimum_ref = int(fiyat * 0.90)

    agir_kusur = (
        degisen >= 2 or
        tramer >= 150000 or
        agir_hasar.strip().lower() in ["evet", "var", "ağır hasarlı", "agir hasarli"]
    )

    if agir_kusur:
        minimum_ref = int(fiyat * 0.78)

    if ref < minimum_ref:
        ref = minimum_ref

    if ref < 0:
        ref = 0

    piyasa = piyasa_fiyat_hesapla(baslik, yil, ref, fiyat)

    # Gerçekçi alım/satım bandı
    if agir_kusur:
        alim_alt = int(ref * 0.92)
    else:
        alim_alt = int(ref * 0.96)

    alim_ust = int(ref * 1.00)

    sat_alt = int(ref * 1.00)
    sat_ust = int(ref * 1.06)

    referans_farki = fiyat - ref
    referans_yuzde = (referans_farki / ref) * 100 if ref else 0

    piyasa_farki = fiyat - piyasa
    piyasa_yuzde = (piyasa_farki / piyasa) * 100 if piyasa else 0

    pazarlik = max(0, fiyat - alim_ust)
    pot_kar = sat_alt - fiyat

    risk = 0

    if km > 200000:
        risk += 20

    if tramer_var == "Var":
        if tramer > 50000:
            risk += 20
        else:
            risk += 10

    if degisen > 0:
        risk += 20

    if agir_hasar.strip().lower() in ["evet", "var", "ağır hasarlı", "agir hasarli"]:
        risk += 25

    if fiyat > sat_ust:
        risk += 20

    risk = min(risk, 100)

    karar = karar_ver(fiyat, piyasa)

    firsat_orani = piyasa_yuzde

    if firsat_orani <= -12:
        firsat = "🔥 KAÇIRMA"
    elif firsat_orani <= -5:
        firsat = "✅ FIRSAT"
    elif firsat_orani <= 5:
        firsat = "⚖️ NORMAL"
    else:
        firsat = "❌ PAHALI"

    firsat_skor, firsat_skor_karar, firsat_riskler = firsat_skoru_hesapla(
        fiyat=fiyat,
        yil=yil,
        km=km,
        tramer_var=tramer_var,
        tramer=tramer,
        agir_hasar=agir_hasar,
        boya_sayisi=boya,
        degisen_sayisi=degisen
    )

    guven = 100
    if km > 200000:
        guven -= 20
    if boya >= 3:
        guven -= 10
    if degisen > 0:
        guven -= 15
    if tramer_var == "Var" and tramer <= 0:
        guven -= 10
    if not fiyat:
        guven -= 20
    guven = max(0, min(100, guven))

    st.divider()
    st.subheader("📊 Analiz Sonucu")

    # Tutarlı karar kartı: önce fiyat/piyasa pahalı mı, sonra fırsat skoru.
    if firsat_orani > 5:
        st.warning("⚠️ PAHALI / PAZARLIK GEREKİR")
    elif firsat_skor >= 80:
        st.success("🔥 GÜÇLÜ ADAY")
    elif firsat_skor >= 60:
        st.warning("⚠️ PAZARLIKLA ALINABİLİR")
    else:
        st.error("❌ UZAK DUR")

    if firsat_orani > 30:
        st.error("🚨 AŞIRI PAHALI - PİYASADAN ÇOK YUKARI")
    elif firsat_orani < -20:
        st.success("💣 AŞIRI FIRSAT - PİYASA ALTI")

    st.info(f"Fırsat Durumu: {firsat} ({firsat_orani:+.1f}%)")
    st.success(f"Karar: {karar}")

    st.metric("Piyasa Fiyatı", f"{piyasa:,.0f} TL")
    st.metric("Referans Fiyat", f"{ref:,.0f} TL")
    st.metric("Piyasa Farkı", f"{piyasa_farki:+,.0f} TL ({piyasa_yuzde:+.1f}%)")
    st.metric("Referans Farkı", f"{referans_farki:+,.0f} TL ({referans_yuzde:+.1f}%)")

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

    st.write("### 🧠 Veri Güven Skoru")
    st.metric("Veri Güven Skoru", f"{guven}/100")

    st.write("### 🎯 Fırsat Skoru")
    st.metric("Fırsat Skoru", f"{firsat_skor}/100")
    st.success(firsat_skor_karar)

    if firsat_riskler:
        st.warning("Dikkat edilmesi gerekenler:")
        for r in firsat_riskler:
            st.write(f"- {r}")

    veri = {
        "marka": marka,
        "seri": seri,
        "model": model,
        "yakit": yakit,
        "kasa": kasa,
        "motor_gucu": motor_gucu,
        "motor_hacmi": motor_hacmi,
        "agir_hasar": agir_hasar,
        "renk": query_params.get("renk", ""),
        "tramer_var": tramer_var,
        "baslik": baslik,
        "yil": yil,
        "km": km,
        "vites": vites,
        "fiyat": fiyat,
        "tramer": tramer,
        "boya": boya,
        "boyali_parcalar": boyali_parcalar,
        "degisen": degisen,
        "degisen_parcalar": degisen_parcalar,
        "piyasa": piyasa,
        "ref": ref,
        "risk": risk,
        "karar": karar,
        "firsat": firsat,
        "firsat_orani": firsat_orani,
        "firsat_skor": firsat_skor,
        "firsat_skor_karar": firsat_skor_karar,
        "firsat_riskler": firsat_riskler,
    }

    with st.spinner("🤖 AI ekspert raporu hazırlanıyor..."):
        ai_rapor = ai_ekspert_raporu(veri)

    st.write("### ⚡ Hızlı Özet")
    ai_rapor_upper = ai_rapor.upper()
    if "UZAK DUR" in ai_rapor_upper:
        st.error("AI: UZAK DUR")
    elif "AL" in ai_rapor_upper:
        st.success("AI: ALINABİLİR")
    else:
        st.warning("AI: KARARSIZ / DETAY İNCELE")

    st.subheader("🤖 AI Ekspert Raporu")
    st.write(ai_rapor)

    arac_payload = {
        "ilan": ilan_linki,
        "marka": marka,
        "seri": seri,
        "model": model,
        "yil": str(yil),
        "km": str(km),
        "yakit": yakit,
        "vites": vites,
        "kasa": kasa,
        "motor_gucu": motor_gucu,
        "motor_hacmi": motor_hacmi,
        "agir_hasar": agir_hasar,
        "renk": query_params.get("renk", ""),
        "tramer_var": tramer_var,
        "tramer": str(tramer),
        "boyali_parcalar": boyali_parcalar,
        "degisen_parcalar": degisen_parcalar,
    }

    dis_degerleme_linkleri(arac_payload)
