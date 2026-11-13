//! Telegram botu üzerinden bildirim gönderir.

use crate::ilan::Ilan;
use crate::puan::Sonuc;
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

pub struct Telegram {
    istemci: reqwest::Client,
    token: String,
    chat_id: String,
}

fn kacis(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub fn ilan_mesaji(ilan: &Ilan, sonuc: &Sonuc) -> String {
    let mut m = format!(
        "<b>{}</b> — {}/100\n🏢 {}\n📍 {}\n",
        kacis(&ilan.baslik),
        sonuc.puan,
        kacis(if ilan.sirket.is_empty() { "-" } else { &ilan.sirket }),
        kacis(if ilan.konum.is_empty() { "-" } else { &ilan.konum }),
    );
    for n in &sonuc.nedenler {
        m.push_str(&kacis(n));
        m.push('\n');
    }
    m.push_str(&format!("🔗 <a href=\"{}\">İlana git</a> ({})", kacis(&ilan.link), kacis(&ilan.kaynak)));
    m
}

impl Telegram {
    pub fn ortamdan(istemci: reqwest::Client, token_env: &str, chat_env: &str) -> Result<Self> {
        let token = std::env::var(token_env)
            .with_context(|| format!("{token_env} ortam değişkeni tanımlı değil"))?;
        let chat_id = std::env::var(chat_env)
            .with_context(|| format!("{chat_env} ortam değişkeni tanımlı değil"))?;
        Ok(Self { istemci, token, chat_id })
    }

    async fn cagir(&self, metod: &str, govde: Value) -> Result<Value> {
        let url = format!("https://api.telegram.org/bot{}/{metod}", self.token);
        let yanit: Value = self.istemci.post(url).json(&govde).send().await?.json().await?;
        if yanit["ok"] != json!(true) {
            bail!("Telegram hatası: {}", yanit["description"]);
        }
        Ok(yanit)
    }

    pub async fn gonder(&self, metin: &str) -> Result<()> {
        self.cagir(
            "sendMessage",
            json!({
                "chat_id": self.chat_id,
                "text": metin,
                "parse_mode": "HTML",
                "disable_web_page_preview": true,
            }),
        )
        .await?;
        Ok(())
    }
}

/// Bota yazan sohbetlerin kimliklerini listeler (TELEGRAM_CHAT_ID'yi bulmak için).
pub async fn sohbetleri_listele(istemci: reqwest::Client, token_env: &str) -> Result<()> {
    let token = std::env::var(token_env)
        .with_context(|| format!("{token_env} ortam değişkeni tanımlı değil"))?;
    let url = format!("https://api.telegram.org/bot{token}/getUpdates");
    let yanit: Value = istemci.get(url).send().await?.json().await?;
    let mut bulundu = false;
    for g in yanit["result"].as_array().into_iter().flatten() {
        let sohbet = &g["message"]["chat"];
        if let Some(id) = sohbet["id"].as_i64() {
            bulundu = true;
            println!(
                "Sohbet kimliği: {id}  ({} {})",
                sohbet["first_name"].as_str().unwrap_or(""),
                sohbet["username"].as_str().map(|u| format!("@{u}")).unwrap_or_default()
            );
        }
    }
    if !bulundu {
        println!("Mesaj bulunamadı. Telegram'da botunuza bir mesaj (örn. /start) yazıp tekrar deneyin.");
    }
    Ok(())
}
