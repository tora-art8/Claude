//! is-takip: profilinize uygun iş ilanlarını bulur, puanlar ve Telegram'a gönderir.

mod ayar;
mod ilan;
mod kayit;
mod kaynaklar;
mod puan;
mod telegram;

use anyhow::Result;
use ayar::Ayar;
use clap::{Parser, Subcommand};
use ilan::Ilan;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Parser)]
#[command(name = "is-takip", version, about = "Size uygun iş ilanlarını bulur ve Telegram'a gönderir")]
struct Arg {
    /// Ayar dosyası
    #[arg(short, long, global = true, default_value = "profil.toml")]
    ayar: PathBuf,
    #[command(subcommand)]
    komut: Komut,
}

#[derive(Subcommand)]
enum Komut {
    /// İlanları tara, puanla ve uygun olanları bildir
    Calistir {
        /// Telegram'a gönderme ve ilanları "görüldü" işaretleme; sadece ekrana yaz
        #[arg(long)]
        kuru: bool,
    },
    /// Elle girilen bir ilanı puanla (profilinizi denemek için)
    Puanla {
        #[arg(long)]
        baslik: String,
        #[arg(long, default_value = "")]
        konum: String,
        #[arg(long, default_value = "")]
        aciklama: String,
    },
    /// Telegram'a deneme mesajı gönder
    TelegramTest,
    /// Bota yazan sohbetlerin kimliğini göster (TELEGRAM_CHAT_ID için)
    SohbetKimligi,
}

#[tokio::main]
async fn main() -> Result<()> {
    let arg = Arg::parse();
    let istemci = kaynaklar::http_istemci()?;

    match arg.komut {
        Komut::SohbetKimligi => {
            let tg = Ayar::yukle(&arg.ayar).map(|a| a.telegram).unwrap_or_default();
            telegram::sohbetleri_listele(istemci, &tg.token_env).await
        }
        Komut::TelegramTest => {
            let ayar = Ayar::yukle(&arg.ayar)?;
            let tg = telegram::Telegram::ortamdan(istemci, &ayar.telegram.token_env, &ayar.telegram.chat_id_env)?;
            tg.gonder("✅ is-takip bağlantısı çalışıyor.").await?;
            println!("Deneme mesajı gönderildi.");
            Ok(())
        }
        Komut::Puanla { baslik, konum, aciklama } => {
            let ayar = Ayar::yukle(&arg.ayar)?;
            let ilan = Ilan { baslik, konum, aciklama, ..Default::default() };
            match puan::puanla(&ilan, &ayar.profil) {
                None => println!("Elendi (hariç tutulan kelime geçiyor)."),
                Some(s) => {
                    println!("Puan: {}/100", s.puan);
                    for n in s.nedenler {
                        println!("  {n}");
                    }
                }
            }
            Ok(())
        }
        Komut::Calistir { kuru } => calistir(Ayar::yukle(&arg.ayar)?, istemci, kuru).await,
    }
}

async fn calistir(ayar: Ayar, istemci: reqwest::Client, kuru: bool) -> Result<()> {
    let mut kayit = kayit::Kayit::ac(&ayar.genel.veri_dosyasi)?;

    // Telegram ayarı eksikse taramaya başlamadan söyle.
    let tg = if kuru {
        None
    } else {
        Some(telegram::Telegram::ortamdan(
            istemci.clone(),
            &ayar.telegram.token_env,
            &ayar.telegram.chat_id_env,
        )?)
    };

    // 1) Topla
    let mut ilanlar: Vec<Ilan> = Vec::new();
    if let Some(li) = &ayar.kaynaklar.linkedin {
        match kaynaklar::linkedin::ara(&istemci, li).await {
            Ok(v) => {
                println!("LinkedIn: {} ilan", v.len());
                ilanlar.extend(v);
            }
            Err(e) => eprintln!("LinkedIn hatası: {e:#}"),
        }
    }
    for kaynak in &ayar.kaynaklar.rss {
        match kaynaklar::rss::oku(&istemci, kaynak).await {
            Ok(v) => {
                println!("{}: {} ilan", kaynak.ad, v.len());
                ilanlar.extend(v);
            }
            Err(e) => eprintln!("{} hatası: {e:#}", kaynak.ad),
        }
    }

    // 2) Daha önce görülenleri at
    let mut yeniler: Vec<Ilan> = ilanlar.into_iter().filter(|i| !kayit.goruldu_mu(&i.id)).collect();
    println!("Yeni ilan: {}", yeniler.len());

    // 3) Umut vadeden LinkedIn ilanlarının açıklamasını indir
    let aciklama_cek = ayar.kaynaklar.linkedin.as_ref().is_some_and(|l| l.aciklama_cek);
    if aciklama_cek {
        for ilan in yeniler.iter_mut().filter(|i| i.id.starts_with("linkedin:")) {
            let on_puan = puan::puanla(ilan, &ayar.profil).map_or(0, |s| s.puan);
            if on_puan + 30 < ayar.genel.min_puan {
                continue;
            }
            if let Err(e) = kaynaklar::linkedin::aciklama_getir(&istemci, ilan).await {
                eprintln!("  Açıklama alınamadı ({}): {e:#}", ilan.baslik);
            }
            tokio::time::sleep(Duration::from_millis(1000)).await;
        }
    }

    // 4) Puanla ve sırala
    let mut uygunlar: Vec<(Ilan, puan::Sonuc)> = Vec::new();
    let mut gonderilmeyecek: Vec<String> = Vec::new();
    for ilan in yeniler {
        match puan::puanla(&ilan, &ayar.profil) {
            Some(s) if s.puan >= ayar.genel.min_puan => uygunlar.push((ilan, s)),
            _ => gonderilmeyecek.push(ilan.id),
        }
    }
    uygunlar.sort_by_key(|u| std::cmp::Reverse(u.1.puan));
    println!("Uygun ilan (≥{}): {}\n", ayar.genel.min_puan, uygunlar.len());

    for (ilan, s) in &uygunlar {
        println!("[{:>3}] {} — {} ({})\n      {}", s.puan, ilan.baslik, ilan.sirket, ilan.konum, ilan.link);
    }

    if kuru {
        println!("\n(Kuru çalıştırma: hiçbir şey gönderilmedi ve kaydedilmedi.)");
        return Ok(());
    }

    // 5) Bildir
    let tg = tg.expect("kuru değilse Telegram hazır");
    for id in &gonderilmeyecek {
        kayit.isaretle(id);
    }
    let fazla = uygunlar.len().saturating_sub(ayar.genel.max_bildirim);
    for (ilan, s) in uygunlar.iter().take(ayar.genel.max_bildirim) {
        match tg.gonder(&telegram::ilan_mesaji(ilan, s)).await {
            Ok(()) => kayit.isaretle(&ilan.id),
            Err(e) => eprintln!("Telegram gönderimi başarısız ({}): {e:#}", ilan.baslik),
        }
        tokio::time::sleep(Duration::from_millis(1100)).await;
    }
    if fazla > 0 {
        let _ = tg
            .gonder(&format!("…ve {fazla} uygun ilan daha var; bir sonraki taramada gönderilecek."))
            .await;
    }
    kayit.kaydet()?;
    Ok(())
}
