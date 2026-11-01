# Manga Çeviri TR — Tarayıcı Eklentisi

İngilizce manga sayfalarındaki **konuşma balonlarını bulur**, **Türkçeye çevirir** ve çeviriyi
**balona sığacak şekilde** orijinal yazının üstüne yerleştirir.

- **Ücretsiz:** API anahtarı, hesap veya ödeme yok.
- **Bilgisayarda çalışır:** Yazı okuma (OCR) eklentinin içindeki Tesseract ile, çeviri Google Chrome'un
  yerleşik çevirmeniyle yapılır. Manga görselleri hiçbir yapay zekâ servisine gönderilmez.
- **Hızlı:** Sayfa başı ≈ 1 saniye (ölçüm aşağıda).

| Önce | Sonra |
|---|---|
| ![önce](docs/once.png) | ![sonra](docs/sonra.png) |

> Görseller bu proje için çizilmiş özgün test sayfasıdır (`test/ornek-sayfa-uret.py`).

Zor koşullar testi (düşük kaliteli JPEG, kirli kâğıt rengi, ince çizgi, dikenli bağırma balonu,
gri kutu, panel sınırını aşan balon):

![zor sayfa](docs/zor-sayfa.png)

---

## 1. Kurulum (5 dakika)

> **Google Chrome gerekir** (bilgisayar: Windows, Mac veya Linux). Ücretsiz çevirmen Chrome'a aittir;
> Edge, Opera ve Brave'de bulunmayabilir. Chrome'u güncellemek için: Chrome menüsü → Yardım → Google Chrome hakkında.
> Telefon ve tabletlerde (iPhone, iPad, Android) eklenti çalışmaz.

1. Bu depoyu bilgisayarına indir: GitHub'da **Code → Download ZIP**, sonra ZIP'i silinmeyecek bir klasöre
   çıkar (ör. Belgeler). Klasör silinirse eklenti de çalışmaz.
2. Chrome'da adres çubuğuna `chrome://extensions` yaz.
3. Sağ üstteki **Geliştirici modu**'nu aç.
4. **Paketlenmemiş öğe yükle** düğmesine bas ve indirdiğin klasörün içindeki **`eklenti`** klasörünü seç.
5. Araç çubuğundaki yapboz simgesinden eklentiyi **sabitle** ki pembe "TR" simgesi hep görünsün.

### İlk ayar (bir kez)

1. Eklenti simgesine tıkla → sağ üstteki **⚙** → **Türkçe paketi hazırla ve dene** düğmesine bas.
   Chrome Türkçe çeviri paketini bir kez indirir ve örnek bir cümle çevirir. **"✓ Hazır"** yazısını ve Türkçe
   cümleyi görmelisin.
2. Manga sitesinde ilk kez çevirirken sağ alttaki panelde **"Türkçe çeviri paketini hazırla"** düğmesi çıkarsa
   bir kez ona bas (Chrome her site için ilk seferde bir tıklama ister).

## 2. Kullanım

- Manga sayfasını aç → eklenti simgesine tıkla → **Bu sayfayı çevir**.
  (Sayfada sağ tık → **Bu sayfadaki mangayı çevir** de olur.)
- Sağ altta küçük bir panel ilerlemeyi gösterir. Çeviri bitince görseller yerinde değişir.
- **Orijinale dönmek:** paneldeki **Orijinal** düğmesi (tümü) veya görsele **Alt + tık** (tek görsel)
  veya görselde sağ tık → **Çeviri ↔ Orijinal**. Bir balon yanlış çevrildiyse böyle anında orijinale dönülür.
- **Uzun bölümler / webtoon:** popup'taki **Yeni yüklenen sayfaları otomatik çevir** kutusunu işaretle;
  aşağı kaydırdıkça yüklenen sayfalar da çevrilir.
- Tek bir görseli çevirmek: görselde sağ tık → **Bu görseli Türkçeye çevir**.
- Aynı sayfayı tekrar açarsan çeviri **önbellekten** anında gelir.

## 3. Hız

Testte ölçülen süreler (bulut sunucusunda; Chrome'un çeviri adımı hariç, çünkü test ortamı Türkçe paketi indiremiyor):

| Durum | Süre |
|---|---|
| İlk sayfa (yazı okuma motoru ilk kez yüklenirken) | ≈ 2 saniye |
| Motor hazırken her sayfa | ≈ 0,7 saniye |
| 11.780 piksel uzunluğunda webtoon (≈ 10 sayfa, 40 balon) | ≈ 6 saniye |
| Daha önce çevrilmiş sayfa (önbellek) | ≈ 0,3 saniye |

Chrome'un çevirmeni de bilgisayarda çalıştığından sayfa başına yalnızca kısa bir süre ekler (tahmin: 0,5–2 sn).
20 sayfalık bir bölüm yaklaşık 20–60 saniyede biter; sayfalar sırayla hazırlandığı için okumaya hemen başlanabilir.

## 4. Nasıl çalışıyor?

```
eklenti/
├── manifest.json        Eklentinin kimlik kartı: izinler, simgeler, kısayol
├── background.js        Arka plan: görsel indirme (CORS), motoru açık tutma, önbellek, sağ tık menüsü
├── content.js           Sayfada çalışan kısım: görselleri bulma, işleme, değiştirme, panel
├── offscreen.html/js    Gizli motor sayfası: OCR (Tesseract) + Chrome çevirmeni
├── lib/detector.js      Balon tespiti (tarayıcıda, kütüphanesiz görüntü işleme)
├── lib/layout.js        Türkçeyi balona sığdırma, İngilizceyi kapatma, yazma
├── popup.html/js        Simgeye tıklayınca açılan pencere
├── options.html/js      Ayarlar sayfası
├── ui.css               Popup ve ayarlar stili
├── vendor/tesseract/    Gömülü OCR motoru ve İngilizce verisi (Apache 2.0, internet gerekmez)
├── fonts/               Türkçe karakter destekli çizgi roman fontu (Comic Relief, OFL lisansı)
└── icons/
test/
├── ornek-sayfa-uret.py     Özgün test manga sayfaları üretir
├── tespit-testi.js         Balon tespitini görselleştirir
├── ucretsiz-motor-test.js  OCR doğruluğu, yüz eleme, paket indirme düğmesi
└── uctan-uca-test.js       Baştan sona: CORS/hotlink, çeviri, geçiş, önbellek, webtoon
```

### Aşama 1 — Sayfadaki manga görsellerini bulma
`content.js → scanImages()` sayfadaki `<img>` etiketlerini tarar; doğal boyutu en az 300×300 olan ve ekranda
en az 150 piksel görünenleri "manga sayfası" sayar (logolar, avatarlar, reklamlar elenir).

### Aşama 2 — Balonları bulma (`lib/detector.js`)
1. Görüntü gri tonlamaya çevrilir, açık renkli (beyaz) pikseller işaretlenir.
2. Birbirine değen beyaz pikseller gruplanır (bağlı bileşen analizi). Kapalı bir balonun içi tek bir grup olur.
3. Grubun içinde kalan koyu "delikler" harflerdir. İçinde harf benzeri küçük delikler olan, dolu ve makul boyutlu
   gruplar **aday balon** olur. İçi açık renkli büyük delikler (yüz, başka balon) içeren gruplar panel/arka plan
   sayılıp elenir; her yere yayılmış nokta deseni (ekran tonu) elenir.
4. Her balon için şekil maskesi, her satırdaki sol/sağ sınır, arka plan rengi ve harf yüksekliği çıkarılır.
5. **Webtoon gibi çok uzun görseller** üst üste binen dilimlere bölünür; dilim sınırına denk gelen balon komşu
   dilimde bütün olarak işlenir, hiçbir balon iki kez yazılmaz.

### Aşama 3 — Okuma ve çeviri (`offscreen.js`)
1. Balonun yalnızca yazı bölgesi kırpılır, balon çizgisi beyaza boyanır, harfler büyütülür ve **Tesseract**
   ile okunur.
2. Okunan metin gerçek kelimelere benzemiyorsa (yüz, çizim parçası) o aday **atlanır**, üstüne yazı yazılmaz.
   Tek başına "I" harfinin "1" veya "|" okunması gibi bilinen hatalar düzeltilir.
3. Manga yazıları BÜYÜK HARF olduğu için çeviriden önce normal cümle düzenine getirilir ("I'M SORRY" → "I'm sorry"),
   sonra **Chrome'un yerleşik çevirmeni** Türkçeye çevirir.
4. Motor gizli bir sayfada açık tutulur; her sayfada yeniden yüklenmediği için hızlıdır.

### Aşama 4 — Sığdırma ve yazma (`lib/layout.js`)
1. İngilizce yazı, balonun kendi arka plan rengiyle balonun şekli boyunca kapatılır (kenar çizgisi korunur).
2. Türkçe metin büyük yazı boyutundan başlanarak 1, 2, 3… satır denenir; oval balonlarda her satır o yükseklikteki
   balon genişliğine göre kırılır ve ortalanır.
3. Sığmazsa yazı küçültülür; son çare olarak kelime bölünür.

### Aşama 5 — Ayarlar, önbellek, hata yönetimi
- **Ayarlar:** Türkçe paketi hazırla/dene, en küçük yazı boyutu, BÜYÜK HARF seçeneği.
- **Önbellek:** Görüntünün parmak izine göre saklanır (en fazla 800 sayfa, en eskiler silinir).
- **Hata yönetimi:** Çevirmen yoksa, paket inmemişse, görsel indirilemezse panelde Türkçe açıklama gösterilir.

## 5. CORS sorunu ve seçilen çözüm

Manga siteleri görselleri çoğu zaman başka bir alan adından (CDN) yükler; tarayıcı, sayfadaki bir betiğin bu
görsellerin piksellerini okumasını engeller (CORS).

| Seçenek | Artı | Eksi |
|---|---|---|
| A. Görseli `crossOrigin="anonymous"` ile yeniden yüklemek | Basit | Sunucu CORS izni vermiyorsa çalışmaz (çoğu manga CDN'i vermez) |
| B. Ekran görüntüsü almak (`captureVisibleTab`) | Her sitede çalışır | Sadece görünen kısım, düşük çözünürlük |
| C. Kendi sunucunda proxy | Her yerde çalışır | Sunucu masrafı, gizlilik, bakım |
| **D. Görseli eklentinin arka planı indirir** ✅ | Eklentiler host izniyle CORS'a takılmaz; tam çözünürlük; sunucu yok | "Tüm sitelere erişim" izni gerekir |

**Seçilen: D.** `background.js → fetchImage()` görseli indirir. Bazı siteler "hotlink" koruması için **Referer**
başlığına bakar; eklenti sadece kendi isteklerinde Referer'i okunan sitenin adresine ayarlar
(`declarativeNetRequest` oturum kuralı). Yine de olmazsa, görsel CORS izinliyse doğrudan okunur (yedek yol).

## 6. Sorun giderme

| Mesaj / durum | Ne yapmalı |
|---|---|
| "Çeviri motoru bu tarayıcıda yok" | Güncel **Google Chrome** kullan (Edge/Opera/Brave'de bulunmayabilir) |
| Panelde "Türkçe çeviri paketini hazırla" düğmesi | Bir kez bas; Chrome Türkçe paketini indirir ve çeviri devam eder |
| "Görsel indirilemedi (HTTP 403)" | Site görsele erişimi engelliyor. Sayfayı yenileyip tekrar dene |
| "Bu sayfada manga görseli bulunamadı" | Görseller henüz yüklenmemiş olabilir: aşağı kaydır, tekrar bas. `<canvas>` ile çizen siteler desteklenmiyor |
| Bir balon yanlış/bozuk | Görsele **Alt + tık** ile orijinale dön |
| "Bu sayfada eklenti çalışamaz" | `chrome://` sayfaları ve eklenti mağazası korumalıdır, normal sitelerde çalışır |

**Ayrıntılı hata görmek için:** `chrome://extensions` → Manga Çeviri TR → **service worker** bağlantısı
veya manga sayfasında **F12 → Console**.

## 7. Bilinen sınırlamalar

- Çeviri makine çevirisidir: anlaşılırdır ama bir çevirmen kadar doğal olmayabilir; karakterin sen/siz hitabını
  ayarlayamaz ve çeviriyi kısaltamaz (sığmazsa yazı küçülür).
- Çok süslü veya el yazısı fontlarda OCR hata yapabilir.
- Efekt sesleri ve arka plan yazıları bilerek çevrilmez.
- Kenar çizgisi açık veya içi koyu/desenli balonlar bulunamayabilir; siyah zemine beyaz yazılı balonlar desteklenmez.
- `<canvas>` ile çizilen sayfalar, CSS arka planı olarak gösterilen görseller ve iframe içindeki okuyucular desteklenmez.

## 8. Geliştirici testleri

```bash
python3 test/ornek-sayfa-uret.py                 # özgün test sayfalarını üret (Pillow gerekir)
node test/tespit-testi.js test/ornek/sayfa1.png  # balon tespitini görselleştir (Playwright gerekir)
node test/ucretsiz-motor-test.js                 # OCR doğruluğu, yüz eleme, paket indirme düğmesi
node test/uctan-uca-test.js                      # baştan sona test
```

Testler gerçek Tesseract OCR'ı çalıştırır. Test tarayıcısı Chrome'un Türkçe paketini indiremediği için çeviri
adımında sahte çevirmen kullanılır (okunan metni «…» içinde döndürür). Doğrulananlar: 3 test sayfasındaki 13 konuşma
balonunun hepsinin doğru okunması ve yüzlerin atlanması; farklı alan adından ve Referer korumalı sunucudan görsel
alma; orijinal↔çeviri geçişi; önbellek; webtoon şeridinde 40 balonun her birinin tam bir kez işlenmesi; hiçbir dış
yapay zekâ servisine istek gitmemesi; Türkçe paket inmemişken panelde indirme düğmesinin çıkması.

## Telif ve lisanslar

Çeviriyi kendi kişisel okumanız için kullanın; çevrilmiş görselleri paylaşmayın.
OCR: [tesseract.js](https://github.com/naptha/tesseract.js) ve İngilizce dil verisi — Apache License 2.0 (`eklenti/vendor/tesseract/`).
Yazı tipi: [Comic Relief](https://github.com/loudifier/Comic-Relief) — SIL Open Font License 1.1 (`eklenti/fonts/OFL.txt`).
