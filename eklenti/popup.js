// popup.js — Eklenti simgesine tıklayınca açılan pencere
const $ = (id) => document.getElementById(id);
let tabId = null;
let timer = null;

const DURUM = {
  idle: 'bekliyor',
  queued: 'sırada',
  working: 'çevriliyor…',
  done: 'çevrildi',
  none: 'balon bulunamadı',
  error: 'hata',
};

function openOptions(e) {
  e?.preventDefault();
  chrome.runtime.openOptionsPage();
}
$('ayarlar').onclick = openOptions;
$('ayarlar2').onclick = openOptions;

async function send(msg) {
  return chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
}

function render(state) {
  const list = $('liste');
  list.textContent = '';
  $('bos').hidden = state.images.length > 0;
  $('baslik').textContent = `Görseller (${state.images.length})` + (state.pending ? ` · ${state.pending} tanesi henüz yüklenmedi` : '');
  $('oto').checked = state.autoMode;

  const done = state.images.filter((i) => i.status === 'done');
  $('gecis').disabled = done.length === 0;
  $('gecis').textContent = done.some((i) => i.showing === 'tr') ? 'Orijinali göster' : 'Çeviriyi göster';

  for (const im of state.images) {
    const li = document.createElement('li');
    const name = decodeURIComponent(im.src.split('?')[0].split('/').pop() || im.src).slice(0, 40);
    let durum = DURUM[im.status] || im.status;
    if (im.status === 'working' && im.step) durum = im.step + '…';
    if (im.status === 'done') durum += ` (${im.count} balon${im.fromCache ? ', önbellekten' : ''})`;
    li.innerHTML = `<span class="dot ${im.status}"></span>
      <span class="name" title=""></span>
      <span class="st"></span>`;
    li.querySelector('.name').textContent = name;
    li.querySelector('.name').title = `${im.src} (${im.w}×${im.h})`;
    li.querySelector('.st').textContent = durum;
    if (im.error) {
      const e = document.createElement('div');
      e.className = 'err';
      e.textContent = im.error;
      li.appendChild(e);
    }
    if (im.status === 'done') {
      li.classList.add('click');
      li.title = 'Tıkla: bu görselde orijinal ↔ çeviri';
      li.onclick = () => send({ type: 'toggleImage', id: im.id }).then(refresh);
    } else if (['idle', 'error', 'none'].includes(im.status)) {
      li.classList.add('click');
      li.title = 'Tıkla: sadece bu görseli çevir';
      li.onclick = () => send({ type: 'translateImage', id: im.id }).then(refresh);
    }
    list.appendChild(li);
  }
}

async function refresh() {
  try {
    render(await send({ type: 'scan' }));
  } catch (e) {
    console.warn(e);
  }
}

async function init() {
  const { settings } = await chrome.storage.local.get('settings');
  $('uyari').hidden = !!settings?.apiKey;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'ensureInjected', tabId });
    if (!r?.ok) throw new Error(r?.error);
  } catch (e) {
    $('kisit').hidden = false;
    $('ana').hidden = true;
    return;
  }
  await refresh();
  timer = setInterval(refresh, 700);
}

$('cevir').onclick = async () => {
  await send({ type: 'translatePage' });
  refresh();
};
$('gecis').onclick = async () => {
  await send({ type: 'toggleAll' });
  refresh();
};
$('oto').onchange = async (e) => {
  await send({ type: 'setAuto', on: e.target.checked });
  refresh();
};

window.addEventListener('unload', () => clearInterval(timer));
init();
