// options.js — Ayarlar sayfası
const $ = (id) => document.getElementById(id);
const DEFAULTS = { apiKey: '', model: 'claude-opus-5-5', minFontPx: 13, uppercase: false, effort: 'medium' };

// Yaklaşık maliyet bilgisi (1 manga sayfası ≈ 4-6 bin girdi + 1-2 bin çıktı token)
const FIYAT = {
  'claude-opus-5-5': 'Girdi 4 $ / çıktı 20 $ (milyon token başına) — sayfa başı yaklaşık 3-6 sent.',
  'claude-sonnet-5-5': 'Girdi 2 $ / çıktı 10 $ (milyon token başına) — sayfa başı yaklaşık 1,5-3 sent.',
  'claude-haiku-5-5': 'Girdi 0,10 $ / çıktı 0,50 $ (milyon token başına) — sayfa başı 0,1 sentten az.',
};

async function load() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...(settings || {}) };
  $('apiKey').value = s.apiKey;
  $('model').value = s.model;
  $('effort').value = s.effort;
  $('minFontPx').value = s.minFontPx;
  $('uppercase').checked = s.uppercase;
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

$('kaydet').onclick = async () => {
  const minFont = Math.min(24, Math.max(8, Number($('minFontPx').value) || 13));
  const settings = {
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
