//! LinkedIn'in giriş gerektirmeyen herkese açık iş arama sayfası.

use crate::ayar::LinkedInAyar;
use crate::ilan::Ilan;
use anyhow::{Context, Result};
use scraper::{Html, Selector};
use std::time::Duration;

const ARAMA_URL: &str = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const ILAN_URL: &str = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting";

pub async fn ara(istemci: &reqwest::Client, ayar: &LinkedInAyar) -> Result<Vec<Ilan>> {
    let mut ilanlar: Vec<Ilan> = Vec::new();
    let zaman = format!("r{}", ayar.son_saat.max(1) * 3600);
    for arama in &ayar.aramalar {
        for sayfa in 0..ayar.sayfa.max(1) {
            let baslangic = (sayfa * 10).to_string();
            let yanit = istemci
                .get(ARAMA_URL)
                .query(&[
                    ("keywords", arama.as_str()),
                    ("location", ayar.konum.as_str()),
                    ("f_TPR", zaman.as_str()),
                    ("start", baslangic.as_str()),
                ])
                .send()
                .await
                .with_context(|| format!("LinkedIn araması başarısız: {arama}"))?;
            if !yanit.status().is_success() {
                eprintln!("  LinkedIn '{arama}' sayfa {sayfa}: HTTP {}", yanit.status());
                break;
            }
            let html = yanit.text().await?;
            let bulunan = arama_sayfasini_ayristir(&html);
            let bos = bulunan.is_empty();
            for ilan in bulunan {
                if !ilanlar.iter().any(|i| i.id == ilan.id) {
                    ilanlar.push(ilan);
                }
            }
            if bos {
                break;
            }
            tokio::time::sleep(Duration::from_millis(1500)).await;
        }
    }
    Ok(ilanlar)
}

/// Bir ilanın tam açıklamasını indirir.
pub async fn aciklama_getir(istemci: &reqwest::Client, ilan: &mut Ilan) -> Result<()> {
    let Some(no) = ilan.id.strip_prefix("linkedin:") else {
        return Ok(());
    };
    let html = istemci
        .get(format!("{ILAN_URL}/{no}"))
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    if let Some(metin) = aciklama_ayristir(&html) {
        ilan.aciklama = metin;
    }
    Ok(())
}

pub fn arama_sayfasini_ayristir(html: &str) -> Vec<Ilan> {
    let belge = Html::parse_fragment(html);
    let kart = Selector::parse("div.base-card, div.job-search-card").unwrap();
    let baslik = Selector::parse(".base-search-card__title").unwrap();
    let sirket = Selector::parse(".base-search-card__subtitle").unwrap();
    let konum = Selector::parse(".job-search-card__location").unwrap();
    let link = Selector::parse("a.base-card__full-link").unwrap();

    let metin = |e: scraper::ElementRef, s: &Selector| -> String {
        e.select(s)
            .next()
            .map(|x| x.text().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" "))
            .unwrap_or_default()
    };

    let mut sonuc = Vec::new();
    for e in belge.select(&kart) {
        let Some(no) = e
            .value()
            .attr("data-entity-urn")
            .and_then(|u| u.rsplit(':').next())
            .map(str::to_string)
        else {
            continue;
        };
        let href = e
            .select(&link)
            .next()
            .and_then(|a| a.value().attr("href"))
            .map(|h| h.split('?').next().unwrap_or(h).to_string())
            .unwrap_or_else(|| format!("https://www.linkedin.com/jobs/view/{no}"));
        sonuc.push(Ilan {
            id: format!("linkedin:{no}"),
            kaynak: "LinkedIn".into(),
            baslik: metin(e, &baslik),
            sirket: metin(e, &sirket),
            konum: metin(e, &konum),
            aciklama: String::new(),
            link: href,
        });
    }
    sonuc
}

fn aciklama_ayristir(html: &str) -> Option<String> {
    let belge = Html::parse_document(html);
    let s = Selector::parse(".show-more-less-html__markup, .description__text").unwrap();
    belge
        .select(&s)
        .next()
        .map(|e| e.text().map(str::trim).filter(|t| !t.is_empty()).collect::<Vec<_>>().join(" "))
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn arama_kartlarini_okur() {
        let html = r#"
        <li><div class="base-card relative job-search-card" data-entity-urn="urn:li:jobPosting:4012345678">
          <a class="base-card__full-link" href="https://tr.linkedin.com/jobs/view/it-destek-4012345678?position=1&amp;refId=x"></a>
          <div class="base-search-card__info">
            <h3 class="base-search-card__title">
                  IT Destek Uzmanı
            </h3>
            <h4 class="base-search-card__subtitle"><a>Örnek Teknoloji A.Ş.</a></h4>
            <div class="base-search-card__metadata">
              <span class="job-search-card__location">Şişli, İstanbul, Türkiye</span>
            </div>
          </div>
        </div></li>
        <li><div class="base-card" data-entity-urn="urn:li:jobPosting:99">
            <h3 class="base-search-card__title">Help Desk</h3>
        </div></li>"#;
        let ilanlar = arama_sayfasini_ayristir(html);
        assert_eq!(ilanlar.len(), 2);
        assert_eq!(ilanlar[0].id, "linkedin:4012345678");
        assert_eq!(ilanlar[0].baslik, "IT Destek Uzmanı");
        assert_eq!(ilanlar[0].sirket, "Örnek Teknoloji A.Ş.");
        assert_eq!(ilanlar[0].konum, "Şişli, İstanbul, Türkiye");
        assert_eq!(ilanlar[0].link, "https://tr.linkedin.com/jobs/view/it-destek-4012345678");
        assert_eq!(ilanlar[1].link, "https://www.linkedin.com/jobs/view/99");
    }

    #[test]
    fn aciklamayi_okur() {
        let html = r#"<html><body><div class="show-more-less-html__markup">
            <p>Donanım arıza tespiti</p><ul><li>Windows</li></ul></div></body></html>"#;
        assert_eq!(aciklama_ayristir(html).unwrap(), "Donanım arıza tespiti Windows");
    }
}
