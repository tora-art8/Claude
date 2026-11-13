//! Daha önce görülen ilanları JSON dosyasında tutar.

use anyhow::Result;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const SAKLAMA_GUN: u64 = 60;

pub struct Kayit {
    yol: PathBuf,
    /// ilan kimliği → ilk görüldüğü zaman (unix saniye)
    gorulen: HashMap<String, u64>,
}

fn simdi() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

impl Kayit {
    pub fn ac(yol: impl Into<PathBuf>) -> Result<Self> {
        let yol = yol.into();
        let gorulen = match std::fs::read_to_string(&yol) {
            Ok(m) => serde_json::from_str(&m).unwrap_or_default(),
            Err(_) => HashMap::new(),
        };
        Ok(Self { yol, gorulen })
    }

    pub fn goruldu_mu(&self, id: &str) -> bool {
        self.gorulen.contains_key(id)
    }

    pub fn isaretle(&mut self, id: &str) {
        self.gorulen.entry(id.to_string()).or_insert_with(simdi);
    }

    pub fn kaydet(&mut self) -> Result<()> {
        let sinir = simdi().saturating_sub(SAKLAMA_GUN * 86_400);
        self.gorulen.retain(|_, t| *t >= sinir);
        let gecici = self.yol.with_extension("tmp");
        std::fs::write(&gecici, serde_json::to_string_pretty(&self.gorulen)?)?;
        std::fs::rename(&gecici, &self.yol)?;
        Ok(())
    }
}
