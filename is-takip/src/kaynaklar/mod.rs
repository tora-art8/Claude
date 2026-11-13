pub mod linkedin;
pub mod rss;

use std::time::Duration;

/// Tüm kaynakların kullandığı HTTP istemcisi.
pub fn http_istemci() -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(30))
        .build()?)
}

/// HTML'i düz metne çevirir (RSS açıklamaları ve LinkedIn açıklaması için).
pub fn html_metin(html: &str) -> String {
    let belge = scraper::Html::parse_fragment(html);
    let parcalar: Vec<&str> = belge.root_element().text().map(str::trim).filter(|s| !s.is_empty()).collect();
    parcalar.join(" ")
}
