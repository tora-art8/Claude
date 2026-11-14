//! `profil.toml` dosyasının yapısı.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct Ayar {
    #[serde(default)]
    pub genel: Genel,
    pub profil: Profil,
    #[serde(default)]
    pub kaynaklar: Kaynaklar,
    #[serde(default)]
    pub telegram: TelegramAyar,
}

#[derive(Debug, Deserialize)]
pub struct Genel {
    /// Görülen ilanların tutulduğu dosya (aynı ilan iki kez gönderilmesin diye).
    #[serde(default = "varsayilan_veri_dosyasi")]
    pub veri_dosyasi: String,
    /// Bu puanın altındaki ilanlar bildirilmez (0-100).
    #[serde(default = "varsayilan_min_puan")]
    pub min_puan: i32,
    /// Tek çalıştırmada en fazla kaç ilan bildirilsin.
    #[serde(default = "varsayilan_max_bildirim")]
    pub max_bildirim: usize,
}

impl Default for Genel {
    fn default() -> Self {
        Self {
            veri_dosyasi: varsayilan_veri_dosyasi(),
            min_puan: varsayilan_min_puan(),
            max_bildirim: varsayilan_max_bildirim(),
        }
    }
}

fn varsayilan_veri_dosyasi() -> String {
    "gorulen_ilanlar.json".into()
}
fn varsayilan_min_puan() -> i32 {
    50
}
fn varsayilan_max_bildirim() -> usize {
    15
}

#[derive(Debug, Deserialize, Default)]
pub struct Profil {
    /// İlanın başlığında geçmesi beklenen pozisyon adları.
    pub pozisyon_kelimeleri: Vec<String>,
    /// Bildiğiniz beceriler; ilanda geçtikçe puan artar.
    #[serde(default)]
    pub beceri_kelimeleri: Vec<String>,
    /// Size uygun seviyeyi gösteren kelimeler (junior, yeni mezun...).
    #[serde(default)]
    pub olumlu_kelimeler: Vec<String>,
    /// Size uygun olmayan seviyeyi gösteren kelimeler (senior, müdür...).
    #[serde(default)]
    pub olumsuz_kelimeler: Vec<String>,
    /// Bu kelimelerden biri geçen ilan tamamen elenir.
    #[serde(default)]
    pub haric_kelimeler: Vec<String>,
    /// İlanın şehri bu olmalı (boş bırakılırsa kontrol edilmez).
    #[serde(default)]
    pub sehir: String,
    /// Puan kazandıran ilçeler.
    #[serde(default)]
    pub tercih_edilen_bolgeler: Vec<String>,
    /// Puan kaybettiren ilçeler.
    #[serde(default)]
    pub istenmeyen_bolgeler: Vec<String>,
    /// İlan bundan fazla yıl deneyim istiyorsa puan düşer.
    #[serde(default = "varsayilan_max_deneyim")]
    pub max_deneyim_yili: u32,
}

fn varsayilan_max_deneyim() -> u32 {
    2
}

#[derive(Debug, Deserialize, Default)]
pub struct Kaynaklar {
    pub linkedin: Option<LinkedInAyar>,
    #[serde(default)]
    pub rss: Vec<RssKaynak>,
}

#[derive(Debug, Deserialize)]
pub struct LinkedInAyar {
    /// Her biri ayrı bir arama olarak yapılır.
    pub aramalar: Vec<String>,
    #[serde(default = "varsayilan_konum")]
    pub konum: String,
    /// Son kaç saatte yayınlanan ilanlar.
    #[serde(default = "varsayilan_son_saat")]
    pub son_saat: u32,
    /// Arama başına kaç sayfa (sayfa başına ~10 ilan).
    #[serde(default = "varsayilan_sayfa")]
    pub sayfa: u32,
    /// Yeni ilanların açıklamasını da indir (daha doğru puan, daha yavaş).
    #[serde(default = "varsayilan_true")]
    pub aciklama_cek: bool,
}

fn varsayilan_konum() -> String {
    "Istanbul, Turkey".into()
}
fn varsayilan_son_saat() -> u32 {
    24
}
fn varsayilan_sayfa() -> u32 {
    2
}
fn varsayilan_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct RssKaynak {
    pub ad: String,
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct TelegramAyar {
    /// Bot token'ının okunacağı ortam değişkeni.
    #[serde(default = "varsayilan_token_env")]
    pub token_env: String,
    /// Sohbet kimliğinin okunacağı ortam değişkeni.
    #[serde(default = "varsayilan_chat_env")]
    pub chat_id_env: String,
}

impl Default for TelegramAyar {
    fn default() -> Self {
        Self {
            token_env: varsayilan_token_env(),
            chat_id_env: varsayilan_chat_env(),
        }
    }
}

fn varsayilan_token_env() -> String {
    "TELEGRAM_BOT_TOKEN".into()
}
fn varsayilan_chat_env() -> String {
    "TELEGRAM_CHAT_ID".into()
}

impl Ayar {
    pub fn yukle(yol: &Path) -> Result<Self> {
        let metin = std::fs::read_to_string(yol)
            .with_context(|| format!("Ayar dosyası okunamadı: {}", yol.display()))?;
        toml::from_str(&metin).with_context(|| format!("Ayar dosyası hatalı: {}", yol.display()))
    }
}
