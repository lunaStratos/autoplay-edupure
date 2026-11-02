const DEFAULTS = { enabled: false, delaySec: 2, autoPlay: true, muteAlways: false, muteFallback: false };
const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.local.get({ ...DEFAULTS, clickCount: 0, lastClickAt: 0, stopReason: '' });
  $('enabled').checked = s.enabled;
  $('delaySec').value = s.delaySec;
  $('autoPlay').checked = s.autoPlay;
  $('muteAlways').checked = s.muteAlways;
  $('muteFallback').checked = s.muteFallback;
  const last = s.lastClickAt ? new Date(s.lastClickAt).toLocaleTimeString() : '-';
  $('stats').textContent = `자동 클릭 ${s.clickCount}회 · 마지막 ${last}`;
  if (s.stopReason) $('stats').textContent += `\n자동 중지됨: ${s.stopReason}`;
}

for (const id of ['enabled', 'autoPlay', 'muteAlways', 'muteFallback']) {
  $(id).addEventListener('change', (e) => {
    const values = { [id]: e.target.checked };
    if (id === 'enabled' && e.target.checked) values.stopReason = '';
    chrome.storage.local.set(values).then(load);
  });
}
$('delaySec').addEventListener('change', (e) => {
  const v = Math.max(0, Math.min(60, Number(e.target.value) || 0));
  e.target.value = v;
  chrome.storage.local.set({ delaySec: v });
});
$('reset').addEventListener('click', async () => {
  await chrome.storage.local.set({ clickCount: 0, lastClickAt: 0 });
  load();
});

// 각 프레임에서 실행된다. content.js와 같은 isolated world라 findButton을 그대로 쓸 수 있다.
function diagnoseFrame() {
  const norm = (s) => (s || '').replace(/\s+/g, '');
  const matches = [];
  document.querySelectorAll('body *').forEach((el) => {
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('');
    const label = ownText + (el.getAttribute('title') || '') + (el.getAttribute('aria-label') || '') + (el.getAttribute('alt') || '');
    if (norm(label).includes('다음')) {
      matches.push({
        visible: el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }),
        html: el.outerHTML.slice(0, 300),
        parent: el.parentElement?.outerHTML.slice(0, 500),
      });
    }
  });
  const policy = document.permissionsPolicy || document.featurePolicy;
  return {
    url: location.href,
    contentScript: typeof findButton === 'function',
    buttonFound: typeof findButton === 'function' ? (findButton()?.outerHTML.slice(0, 200) ?? false) : null,
    autoplayAllowed: policy ? policy.allowsFeature('autoplay') : null,
    videos: [...document.querySelectorAll('video')].map((v) => ({
      paused: v.paused, ended: v.ended, muted: v.muted, time: Math.round(v.currentTime), duration: Math.round(v.duration),
    })),
    iframes: [...document.querySelectorAll('iframe,frame')].map((f) => ({ src: f.src, allow: f.getAttribute('allow') })),
    matches: matches.slice(0, 8),
  };
}

$('diagnose').addEventListener('click', async () => {
  const out = $('out');
  out.style.display = 'block';
  out.value = '진단 중...';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: diagnoseFrame });
    const scanned = new Set(results.map((r) => r.frameId));
    const report = {
      frames: frames.map((f) => ({ frameId: f.frameId, url: f.url, scanned: scanned.has(f.frameId) })),
      results: results.map((r) => ({ frameId: r.frameId, ...r.result })),
    };
    out.value = JSON.stringify(report, null, 2);
    $('copy').style.display = 'inline-block';
  } catch (e) {
    out.value = `진단 실패: ${e.message}`;
  }
});
$('copy').addEventListener('click', () => navigator.clipboard.writeText($('out').value));

load();
