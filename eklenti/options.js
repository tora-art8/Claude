// options.js — Ayarlar sayfası
const $ = (id) => document.getElementById(id);
const DEFAULTS = { engine: 'ucretsiz', apiKey: '', model: 'claude-opus-5-5', minFontPx: 13, uppercase: false, effort: 'medium' };

// Yaklaşık maliyet bilgisi (1 manga sayfası ≈ 4-6 bin girdi + 1-2 bin çıktı token)
const FIYAT = {
  'claude-opus-5-5': 'Girdi 4 $ / çıktı 20 $ (milyon token başına) — sayfa başı yaklaşık 3-6 sent.',
  'claude-sonnet-5-5': 'Girdi 2 $ / çıktı 10 $ (milyon token başına) — sayfa başı yaklaşık 1,5-3 sent.',
  'claude-haiku-5-5': 'Girdi 0,10 $ / çıktı 0,50 $ (milyon token başına) — sayfa başı 0,1 sentten az.',
};

const engineValue = () => document.querySelector('input[name=engine]:checked')?.value || 'ucretsiz';

function showEngine() {
  const e = engineValue();
  $('ucretsizBolum').hidden = e !== 'ucretsiz';
  $('claudeBolum').hidden = e !== 'claude';
}

async function load() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...(settings || {}) };
  document.querySelector(`input[name=engine][value=${s.engine}]`).checked = true;
  $('apiKey').value = s.apiKey;
  $('model').value = s.model;
  $('effort').value = s.effort;
  $('minFontPx').value = s.minFontPx;
  $('uppercase').checked = s.uppercase;
  showEngine();
  showPrice();
  refreshCache();
}

function showPrice() {
  $('fiyat').textContent = FIYAT[$('model').value] || '';
}

async function refreshCache() {
  const r = await chrome.runtime.sendMessage({ type: 'cacheStats' });
  if (r?.ok) $('cache').textContent = `${r.data.pages} sayfa saklanıyor (${(r.data.bytes / 1024).toFixed(0)} KB).`;
}

document.querySelectorAll('input[name=engine]').forEach((r) => (r.onchange = showEngine));
$('model').onchange = showPrice;

$('goster').onclick = () => {
  const i = $('apiKey');
  i.type = i.type === 'password' ? 'text' : 'password';
  $('goster').textContent = i.type === 'password' ? 'Göster' : 'Gizle';
};

$('test').onclick = async () => {
  const key = $('apiKey').value.trim();
  if (!key) { $('testSonuc').textContent = 'Önce anahtarı yapıştırın.'; return; }
  $('testSonuc').textContent = 'Kontrol ediliyor…';
  const r = await chrome.runtime.sendMessage({ type: 'testKey', apiKey: key });
  $('testSonuc').textContent = r?.ok ? '✓ Anahtar geçerli.' : '✗ ' + (r?.error || 'Bilinmeyen hata');
  $('testSonuc').className = r?.ok ? 'ok' : 'err';
};

// Ücretsiz motor: Chrome'un Türkçe paketini indir ve örnek cümle çevir
$('hazirla').onclick = async () => {
  const out = $('hazirlaSonuc');
  out.className = 'muted';
  if (!('Translator' in self)) {
    out.className = 'err';
    out.textContent = '✗ Bu tarayıcıda ücretsiz çeviri motoru yok. Güncel Google Chrome kullanın ' +
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
  const minFont = Math.min(24, Math.max(8, Number($('minFontPx').value) || 13));
  const settings = {
    engine: engineValue(),
    apiKey: $('apiKey').value.trim(),
    model: $('model').value,
    effort: $('effort').value,
    minFontPx: minFont,
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
