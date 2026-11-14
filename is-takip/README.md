# is-takip

Profilinize uygun iş ilanlarını düzenli olarak tarar, 0-100 arası puanlar ve
uygun olanları **Telegram**'a gönderir. Rust ile yazıldı.

Şu an ayarlı profil: **BT teknik destek / teknik servis, junior, İstanbul Avrupa yakası**.
Her şey [`profil.toml`](profil.toml) dosyasından değiştirilebilir.

## Nasıl çalışır

1. **Toplar:** LinkedIn'in herkese açık iş aramasından (son 24 saat) ve
   eklediğiniz RSS beslemelerinden ilanları çeker.
2. **Eler:** Daha önce gördüğü ilanları atlar (`gorulen_ilanlar.json`).
3. **Puanlar:**

   | Ölçüt | Puan |
   |---|---|
   | Başlıkta pozisyon adı (teknik destek, bilgi işlem…) | +45 |
   | Pozisyon adı yalnızca açıklamada | +20 |
   | Her beceri eşleşmesi (donanım, Windows…) | +6 (en fazla +30) |
   | Junior, yeni mezun, lise mezunu… | +15 |
   | Avrupa yakası ilçesi | +10 |
   | Başlıkta senior, kıdemli, müdür… | −40 |
   | `max_deneyim_yili` değerinden fazla deneyim istiyor | −30 |
   | Anadolu yakası ilçesi | −25 |
   | İstanbul dışı | −50 |

4. **Bildirir:** `min_puan` ve üstündeki ilanları puan sırasıyla, nedenleriyle birlikte Telegram'a yollar.

## Kurulum

### 1. Rust'ı kurun
<https://rustup.rs> adresinden kurun, sonra bu klasörde derleyin:

```
cargo build --release
```

### 2. Telegram botu oluşturun
1. Telegram'da **@BotFather**'a `/newbot` yazın, bota bir ad verin ve size verilen **token**'ı kopyalayın.
2. Oluşturduğunuz bota Telegram'dan `/start` yazın.
3. Token'ı ortam değişkeni yapıp sohbet kimliğinizi öğrenin:

   Windows (PowerShell):
   ```
   setx TELEGRAM_BOT_TOKEN "123456:ABC..."
   # yeni bir PowerShell penceresi açın
   .\target\release\is-takip.exe sohbet-kimligi
   setx TELEGRAM_CHAT_ID "BULUNAN_KIMLIK"
   ```
   Linux/macOS:
   ```
   export TELEGRAM_BOT_TOKEN="123456:ABC..."
   ./target/release/is-takip sohbet-kimligi
   export TELEGRAM_CHAT_ID="BULUNAN_KIMLIK"
   ```
4. Deneyin: `is-takip telegram-test`

### 3. Deneme taraması
```
is-takip calistir --kuru     # sadece ekrana yazar, bir şey göndermez
is-takip calistir            # gerçek tarama + Telegram
```

Profilinizi tek bir ilan üzerinde denemek için:
```
is-takip puanla --baslik "Bilgi İşlem Personeli" --konum "Şişli, İstanbul" --aciklama "Donanım, Windows"
```

## Sürekli çalıştırma

**Seçenek A: Windows Görev Zamanlayıcı** (bilgisayar açıkken çalışır)
1. Görev Zamanlayıcı → *Temel Görev Oluştur*.
2. Tetikleyici: *Günlük*, ardından görevin özelliklerinden *Her 3 saatte bir yinele* seçin.
3. Eylem: *Program başlat* → bu klasördeki `calistir.bat`.

Çıktılar `is-takip.log` dosyasına yazılır.

**Seçenek B: GitHub Actions** (bilgisayar kapalıyken de çalışır, ücretsiz)
Depoda `.github/workflows/is-takip.yml` hazır. GitHub'da depo
*Settings → Secrets and variables → Actions* altına `TELEGRAM_BOT_TOKEN` ve
`TELEGRAM_CHAT_ID` ekleyin. İş akışı Türkiye saatiyle 09:00-21:00 arası
3 saatte bir çalışır. *Actions* sekmesinden elle de başlatılabilir.
> Not: LinkedIn bazen sunucu IP'lerinden gelen istekleri sınırlar. GitHub'da
> ilan gelmezse Seçenek A daha güvenilirdir.

## Kaynaklar hakkında
- **LinkedIn:** Giriş gerektirmeyen herkese açık arama sayfası kullanılır. İstekler
  yavaş ve az sayıda tutulur. LinkedIn sayfa yapısını değiştirirse ayrıştırıcının
  (`src/kaynaklar/linkedin.rs`) güncellenmesi gerekebilir.
- **RSS:** `profil.toml` içine `[[kaynaklar.rss]]` ile istediğiniz beslemeyi ekleyebilirsiniz.
- Kariyer.net gibi siteler otomatik taramayı engelliyor. Bu siteler için kendi
  e-posta iş alarmlarını açmanız önerilir.

## Geliştirme
```
cargo test      # puanlama ve ayrıştırıcı testleri
cargo clippy
```
