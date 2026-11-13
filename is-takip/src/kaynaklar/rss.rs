//! Herhangi bir RSS beslemesinden ilan okur (iş sitelerinin RSS/arama beslemeleri için).

use crate::ayar::RssKaynak;
use crate::ilan::Ilan;
use crate::kaynaklar::html_metin;
use anyhow::{Context, Result};

pub async fn oku(istemci: &reqwest::Client, kaynak: &RssKaynak) -> Result<Vec<Ilan>> {
    let govde = istemci
        .get(&kaynak.url)
        .send()
        .await
        .with_context(|| format!("RSS indirilemedi: {}", kaynak.ad))?
        .error_for_status()?
        .bytes()
        .await?;
    ayristir(&kaynak.ad, &govde)
}

pub fn ayristir(ad: &str, xml: &[u8]) -> Result<Vec<Ilan>> {
    let kanal = rss::Channel::read_from(xml).with_context(|| format!("RSS okunamadı: {ad}"))?;
    Ok(kanal
        .items()
        .iter()
        .filter_map(|o| {
            let link = o.link()?.to_string();
            let kimlik = o.guid().map(|g| g.value().to_string()).unwrap_or_else(|| link.clone());
            Some(Ilan {
                id: format!("rss:{ad}:{kimlik}"),
                kaynak: ad.to_string(),
                baslik: o.title().unwrap_or_default().to_string(),
                sirket: o.author().unwrap_or_default().to_string(),
                konum: String::new(),
                aciklama: html_metin(o.description().unwrap_or_default()),
                link,
            })
        })
        .collect())
}

#[cfg(test)]
mod testler {
    #[test]
    fn rss_okur() {
        let xml = br#"<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><link>x</link><description>d</description>
            <item><title>Teknik Destek Personeli</title><link>https://ornek.com/ilan/1</link>
            <description>&lt;p&gt;Be&#351;ikta&#351; ofisimiz i&#231;in&lt;/p&gt;</description></item>
            <item><title>Linksiz</title></item></channel></rss>"#;
        let ilanlar = super::ayristir("Örnek", xml).unwrap();
        assert_eq!(ilanlar.len(), 1);
        assert_eq!(ilanlar[0].id, "rss:Örnek:https://ornek.com/ilan/1");
        assert_eq!(ilanlar[0].aciklama, "Beşiktaş ofisimiz için");
    }
}
