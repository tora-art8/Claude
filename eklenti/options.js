// options.js — Ayarlar sayfası
const $ = (id) => document.getElementById(id);
const DEFAULTS = { minFontPx: 13, uppercase: false };

async function load() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...(settings || {}) };
  $('minFontPx').value = s.minFontPx;
  $('uppercase').checked = s.uppercase;
  refreshCache();
}

async function refreshCache() {
  const r = await chrome.runtime.sendMessage({ type: 'cacheStats' });
  if (r?.ok) $('cache').textContent = `${r.data.pages} sayfa saklanıyor (${(r.data.bytes / 1024).toFixed(0)} KB).`;
}

// Chrome'un Türkçe paketini indir ve örnek cümle çevir
$('hazirla').onclick = async () => {
  const out = $('hazirlaSonuc');
  out.className = 'muted';
  if (!('Translator' in self)) {
    out.className = 'err';
    out.textContent = '✗ Bu tarayıcıda çeviri motoru yok. Güncel Google Chrome kullanın ' +
      '(Chrome menüsü → Yardım → Google Chrome hakkında ile güncelleyin). Edge/Opera/Brave\'de bulunmayabilir.';
    return;
  }
  const opts = { sourceLanguage: 'en', targetLanguage: 'tr' };
  try {
    const av = await Translator.availability(opts);
    if (av === 'unavailable') throw new Error('Chrome bu bilgisayarda İngilizce→Türkçe paketini desteklemiyor.');
    out.textContent = av === 'available' ? 'Paket hazır, deneniyor…' : 'Türkçe paket indiriliyor…';
    const t = await Translator.create({
      ...opts,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          out.textContent = `Türkçe paket indiriliyor… %${Math.round((e.loaded || 0) * 100)}`;
        });
      },
    });
    const ornek = 'Hey! Wait for me! You promised we would go together!';
    const sonuc = await t.translate(ornek);
    out.className = 'ok';
    out.textContent = `✓ Hazır. Örnek: "${ornek}" → "${sonuc}"`;
  } catch (e) {
    out.className = 'err';
    out.textContent = '✗ ' + (e.message || e);
  }
};

$('kaydet').onclick = async () => {
  const settings = {
    minFontPx: Math.min(24, Math.max(8, Number($('minFontPx').value) || 13)),
    uppercase: $('uppercase').checked,
  };
  await chrome.storage.local.set({ settings });
  $('kaydedildi').hidden = false;
  setTimeout(() => ($('kaydedildi').hidden = true), 2000);
};

$('temizle').onclick = async () => {
  if (!confirm('Tüm kayıtlı çeviriler silinsin mi?')) return;
  await chrome.runtime.sendMessage({ type: 'clearCache' });
  refreshCache();
};

load();
