//! İlanı profile göre 0-100 arası puanlar ve nedenlerini listeler.

use crate::ayar::Profil;
use crate::ilan::Ilan;

#[derive(Debug, Clone)]
pub struct Sonuc {
    pub puan: i32,
    pub nedenler: Vec<String>,
}

/// Türkçe karakterleri ve büyük/küçük harfi eşitler:
/// "İSTANBUL Beşiktaş" → "istanbul besiktas".
pub fn normalize(metin: &str) -> String {
    let mut cikti = String::with_capacity(metin.len());
    for c in metin.chars() {
        // 'I' Türkçede 'ı' olur, ama zaten 'i'ye katlıyoruz.
        for k in c.to_lowercase() {
            match k {
                'ç' => cikti.push('c'),
                'ğ' => cikti.push('g'),
                'ı' => cikti.push('i'),
                'ö' => cikti.push('o'),
                'ş' => cikti.push('s'),
                'ü' => cikti.push('u'),
                'â' => cikti.push('a'),
                'î' => cikti.push('i'),
                'û' => cikti.push('u'),
                '\u{0307}' => {} // 'İ'.to_lowercase() sonrası kalan nokta
                _ => cikti.push(k),
            }
        }
    }
    cikti
}

/// `kelime` metinde ayrı bir kelime/ifade olarak geçiyor mu?
/// ("it" kelimesi "itibaren" içinde eşleşmez.) İkisi de normalize edilmiş olmalı.
fn kelime_var(metin: &str, kelime: &str) -> bool {
    if kelime.is_empty() {
        return false;
    }
    let mut bas = 0;
    while let Some(konum) = metin[bas..].find(kelime) {
        let i = bas + konum;
        let j = i + kelime.len();
        let once_ok = metin[..i].chars().next_back().is_none_or(|c| !c.is_alphanumeric());
        let sonra_ok = metin[j..].chars().next().is_none_or(|c| !c.is_alphanumeric());
        if once_ok && sonra_ok {
            return true;
        }
        bas = i + metin[i..].chars().next().map_or(1, char::len_utf8);
    }
    false
}

fn ilk_eslesen<'a>(metin: &str, kelimeler: &'a [String]) -> Option<&'a String> {
    kelimeler.iter().find(|k| kelime_var(metin, &normalize(k)))
}

/// Metinde istenen en düşük deneyim yılını bulur: "en az 3 yıl", "3+ years", "2-4 yıl".
pub fn istenen_deneyim(metin_norm: &str) -> Option<u32> {
    let karakterler: Vec<char> = metin_norm.chars().collect();
    let mut en_kucuk: Option<u32> = None;
    let mut i = 0;
    while i < karakterler.len() {
        if !karakterler[i].is_ascii_digit() || (i > 0 && karakterler[i - 1].is_alphanumeric()) {
            i += 1;
            continue;
        }
        let mut j = i;
        let mut sayi: u32 = 0;
        while j < karakterler.len() && karakterler[j].is_ascii_digit() {
            sayi = sayi.saturating_mul(10).saturating_add(karakterler[j] as u32 - '0' as u32);
            j += 1;
        }
        // "+", "-5", " ", "'" gibi ara karakterleri atla
        let mut k = j;
        while k < karakterler.len()
            && (karakterler[k] == ' '
                || karakterler[k] == '+'
                || karakterler[k] == '-'
                || karakterler[k] == '\''
                || karakterler[k].is_ascii_digit())
            && k - j < 6
        {
            k += 1;
        }
        let kalan: String = karakterler[k..karakterler.len().min(k + 5)].iter().collect();
        if (kalan.starts_with("yil") || kalan.starts_with("year")) && (1..=20).contains(&sayi) {
            en_kucuk = Some(en_kucuk.map_or(sayi, |e| e.min(sayi)));
        }
        i = j;
    }
    en_kucuk
}

/// İlanı puanlar. Hariç tutulan bir kelime geçiyorsa `None` döner.
pub fn puanla(ilan: &Ilan, profil: &Profil) -> Option<Sonuc> {
    let baslik = normalize(&ilan.baslik);
    let govde = normalize(&format!("{} {}", ilan.sirket, ilan.aciklama));
    let konum = normalize(&ilan.konum);
    let tum = format!("{baslik} {govde}");

    if ilk_eslesen(&tum, &profil.haric_kelimeler).is_some() {
        return None;
    }

    let mut puan: i32 = 10;
    let mut nedenler = Vec::new();

    // 1) Pozisyon uyumu
    if let Some(k) = ilk_eslesen(&baslik, &profil.pozisyon_kelimeleri) {
        puan += 45;
        nedenler.push(format!("✅ Başlık uyuyor: {k}"));
    } else if let Some(k) = ilk_eslesen(&govde, &profil.pozisyon_kelimeleri) {
        puan += 20;
        nedenler.push(format!("☑️ Açıklamada geçiyor: {k}"));
    } else {
        nedenler.push("❔ Pozisyon adı eşleşmedi".into());
    }

    // 2) Beceriler
    let beceriler: Vec<&String> = profil
        .beceri_kelimeleri
        .iter()
        .filter(|k| kelime_var(&tum, &normalize(k)))
        .collect();
    if !beceriler.is_empty() {
        let ek = (beceriler.len() as i32 * 6).min(30);
        puan += ek;
        let liste: Vec<&str> = beceriler.iter().map(|s| s.as_str()).collect();
        nedenler.push(format!("🛠 Beceriler: {}", liste.join(", ")));
    }

    // 3) Seviye
    if let Some(k) = ilk_eslesen(&tum, &profil.olumlu_kelimeler) {
        puan += 15;
        nedenler.push(format!("🌱 Seviye uygun: {k}"));
    }
    if let Some(k) = ilk_eslesen(&baslik, &profil.olumsuz_kelimeler) {
        puan -= 40;
        nedenler.push(format!("⛔ Başlıkta üst seviye: {k}"));
    } else if let Some(k) = ilk_eslesen(&govde, &profil.olumsuz_kelimeler) {
        puan -= 10;
        nedenler.push(format!("⚠️ Açıklamada üst seviye: {k}"));
    }
    if let Some(yil) = istenen_deneyim(&tum) {
        if yil > profil.max_deneyim_yili {
            puan -= 30;
            nedenler.push(format!("⚠️ {yil}+ yıl deneyim istiyor"));
        } else {
            nedenler.push(format!("👍 {yil} yıl deneyim istiyor"));
        }
    }

    // 4) Konum (başlıkta da ilçe yazılabiliyor)
    let konum_metni = format!("{konum} {baslik}");
    if !profil.sehir.is_empty() && !konum.is_empty() && !kelime_var(&konum, &normalize(&profil.sehir))
    {
        puan -= 50;
        nedenler.push(format!("📍 Şehir dışı: {}", ilan.konum));
    } else if let Some(k) = ilk_eslesen(&konum_metni, &profil.tercih_edilen_bolgeler) {
        puan += 10;
        nedenler.push(format!("📍 Tercih edilen bölge: {k}"));
    } else if let Some(k) = ilk_eslesen(&konum_metni, &profil.istenmeyen_bolgeler) {
        puan -= 25;
        nedenler.push(format!("📍 Uzak bölge: {k}"));
    }

    Some(Sonuc {
        puan: puan.clamp(0, 100),
        nedenler,
    })
}

#[cfg(test)]
mod testler {
    use super::*;

    fn profil() -> Profil {
        let v = |l: &[&str]| l.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        Profil {
            pozisyon_kelimeleri: v(&["teknik destek", "it destek", "help desk", "IT"]),
            beceri_kelimeleri: v(&["donanım", "windows", "active directory"]),
            olumlu_kelimeler: v(&["junior", "yeni mezun", "lise mezunu"]),
            olumsuz_kelimeler: v(&["senior", "müdür", "kıdemli"]),
            haric_kelimeler: v(&["satış temsilcisi"]),
            sehir: "İstanbul".into(),
            tercih_edilen_bolgeler: v(&["Beşiktaş", "Şişli", "Avrupa"]),
            istenmeyen_bolgeler: v(&["Kadıköy", "Pendik", "Anadolu"]),
            max_deneyim_yili: 2,
        }
    }

    fn ilan(baslik: &str, konum: &str, aciklama: &str) -> Ilan {
        Ilan {
            baslik: baslik.into(),
            konum: konum.into(),
            aciklama: aciklama.into(),
            ..Default::default()
        }
    }

    #[test]
    fn turkce_normalize() {
        assert_eq!(normalize("İSTANBUL Beşiktaş ÇĞÖÜ"), "istanbul besiktas cgou");
        assert_eq!(normalize("IŞIK"), "isik");
    }

    #[test]
    fn kelime_sinirlari() {
        assert!(kelime_var("it destek uzmani", "it"));
        assert!(kelime_var("uzman (it)", "it"));
        assert!(!kelime_var("hemen itibaren", "it"));
        assert!(!kelime_var("bit", "it"));
    }

    #[test]
    fn deneyim_bulma() {
        assert_eq!(istenen_deneyim(&normalize("En az 3 yıl deneyimli")), Some(3));
        assert_eq!(istenen_deneyim("5+ years of experience"), Some(5));
        assert_eq!(istenen_deneyim("2-4 yil tecrube"), Some(2));
        assert_eq!(istenen_deneyim("2024 yilinda kurulan"), None);
        assert_eq!(istenen_deneyim("deneyim sart degil"), None);
    }

    #[test]
    fn uygun_ilan_yuksek_puan() {
        let s = puanla(
            &ilan(
                "Junior IT Destek Uzmanı",
                "Şişli, İstanbul, Türkiye",
                "Windows ve donanım arıza tespiti, Active Directory",
            ),
            &profil(),
        )
        .unwrap();
        assert!(s.puan >= 90, "{s:?}");
    }

    #[test]
    fn senior_ve_uzak_ilan_dusuk_puan() {
        let s = puanla(
            &ilan(
                "Senior IT Destek Müdürü",
                "Pendik, İstanbul",
                "En az 7 yıl deneyim",
            ),
            &profil(),
        )
        .unwrap();
        assert!(s.puan < 20, "{s:?}");
    }

    #[test]
    fn sehir_disi_dusuk_puan() {
        let s = puanla(&ilan("Teknik Destek", "Ankara, Türkiye", ""), &profil()).unwrap();
        assert!(s.puan < 50, "{s:?}");
    }

    #[test]
    fn haric_kelime_eler() {
        assert!(puanla(&ilan("Satış Temsilcisi (IT)", "İstanbul", ""), &profil()).is_none());
    }
}
