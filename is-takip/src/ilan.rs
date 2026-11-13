/// Kaynaktan bağımsız tek bir iş ilanı.
#[derive(Debug, Clone, Default)]
pub struct Ilan {
    /// Kaynak önekiyle benzersiz kimlik, örn. `linkedin:123456`.
    pub id: String,
    pub kaynak: String,
    pub baslik: String,
    pub sirket: String,
    pub konum: String,
    pub aciklama: String,
    pub link: String,
}
