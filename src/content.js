// 학습창(edupure.net)과 그 안의 콘텐츠 iframe(edge.naverncp.com)에서 모두 실행된다.
// - 콘텐츠 iframe: '다음 페이지 학습' 버튼이 보이면 클릭하고, 새 페이지 영상이 멈춰 있으면 재생 버튼을 누른다.
// - 학습창(최상위): 콘텐츠 iframe에 autoplay 권한을 위임하고, '학습시작[PLAY]' 알림을 닫고,
//   진행이 막히는 알림이 뜨면 자동 클릭을 끈다.

const TARGET = '다음페이지학습';
const DEFAULTS = { enabled: false, delaySec: 2, autoPlay: true, muteAlways: false, muteFallback: false };
const COOLDOWN_MS = 8000;
const PLAY_RETRY_MS = 3000;
const MAX_PLAY_ATTEMPTS = 5;
// 이 문구가 든 알림이 뜨면 더 진행할 수 없으므로 자동 클릭을 끈다
const STOP_WORDS = ['마지막 페이지', '익일', '불가능', '완료되지 않았', '더 진행하셔야', '응시 후', '제출 후'];

let settings = { ...DEFAULTS };
let pendingTimer = null;
let cooldownUntil = 0;
let playAttempts = 0;
let nextPlayAt = 0;

const norm = (s) => (s || '').replace(/\s+/g, '');

function isVisible(el) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (el.checkVisibility) return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  return el.offsetParent !== null;
}

function isEnabled(el) {
  return !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.classList.contains('disabled');
}

function findButton() {
  if (!document.body) return null;

  // edupure 플레이어: 영상이 끝나면 .complete-alarm-wrap('다음 페이지 학습' 안내)이 보이고,
  // 실제 클릭 대상은 그 안의 빈 버튼 #complete-next 이다
  const completeNext = document.getElementById('complete-next');
  if (completeNext) {
    const wrap = completeNext.closest('.complete-alarm-wrap') || completeNext;
    return isVisible(wrap) && isEnabled(completeNext) ? completeNext : null;
  }

  const hits = new Set();

  // 텍스트가 여러 span으로 쪼개져 있어도 찾을 수 있도록, '다음'이 든 텍스트 노드에서 위로 올라가며 확인
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.includes('다음')) continue;
    let el = node.parentElement;
    while (el && el !== document.body && !norm(el.textContent).includes(TARGET)) el = el.parentElement;
    if (el && el !== document.body && norm(el.textContent).length <= 20) hits.add(el);
  }

  // 이미지 버튼이나 title/aria-label로만 표시된 경우
  document.querySelectorAll('[title],[aria-label],img[alt],input[type="button"],input[type="image"]').forEach((el) => {
    const label = el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('alt') || el.value;
    if (norm(label).includes(TARGET)) hits.add(el);
  });

  for (const el of hits) {
    if (!isVisible(el)) continue;
    // 안내 문구 옆에 따로 있는 버튼이 실제 클릭 대상인 경우도 처리
    const target =
      el.closest('a,button,[role="button"],[onclick]') ||
      el.parentElement?.querySelector('a,button,[role="button"],[onclick]') ||
      el;
    if (isEnabled(target)) return target;
  }
  return null;
}

function safeStorageSet(values) {
  try {
    chrome.storage.local.set(values);
  } catch {
    // 확장 프로그램이 다시 로드되어 컨텍스트가 끊긴 경우 무시
  }
}

function tick() {
  if (!settings.enabled || pendingTimer || Date.now() < cooldownUntil) return;
  if (!findButton()) return;

  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    // 지연 시간 동안 끄거나 버튼이 사라졌으면 누르지 않는다
    const btn = settings.enabled && findButton();
    if (!btn) return;
    console.info('[AutoNext] 다음 페이지 학습 클릭', btn);
    cooldownUntil = Date.now() + COOLDOWN_MS;
    btn.click();
    chrome.storage.local.get({ clickCount: 0 }, ({ clickCount }) => {
      safeStorageSet({ clickCount: clickCount + 1, lastClickAt: Date.now() });
    });
  }, settings.delaySec * 1000);
}

// 새 페이지의 영상이 처음(0초)에서 멈춰 있으면 플레이어의 재생 버튼(#play)을 누른다.
// 플레이어 버튼을 거쳐야 플레이어 쪽 학습시간 기록도 함께 시작된다.
// 중간에 사용자가 일시정지한 경우(0초 이후)는 건드리지 않는다.
// 재생이 막히면(autoplay 권한 위임이 안 된 경우) 옵션에 따라 음소거 후 다시 시도한다.
function startPlayback() {
  if (!settings.enabled || !settings.autoPlay) return;
  if (playAttempts >= MAX_PLAY_ATTEMPTS || Date.now() < nextPlayAt) return;
  const video = document.querySelector('video');
  if (!video || !video.paused || video.ended || video.currentTime > 1) return;

  if (settings.muteAlways || (playAttempts > 0 && settings.muteFallback)) video.muted = true;
  playAttempts++;
  nextPlayAt = Date.now() + PLAY_RETRY_MS;

  const playBtn = document.getElementById('play');
  console.info(`[AutoNext] 재생 시도 ${playAttempts}/${MAX_PLAY_ATTEMPTS}`, playBtn || video);
  if (playBtn && isEnabled(playBtn)) playBtn.click();
  else video.play().catch(() => {});
}

// '재생 시 음소거'가 켜져 있으면 영상을 계속 음소거 상태로 둔다.
// 플레이어가 페이지를 넘기면서 음소거를 풀어도 다시 음소거한다.
function keepMuted() {
  if (!settings.enabled || !settings.muteAlways) return;
  document.querySelectorAll('video').forEach((v) => {
    if (!v.muted) v.muted = true;
  });
}

// 학습창(최상위 프레임): 콘텐츠 iframe에 autoplay 권한을 위임한다.
// 이 과정의 iframe에는 allow="autoplay"가 없어서, 플레이어가 재생 버튼을 눌러도
// 브라우저가 소리 있는 자동재생을 막는다. 학습창은 사용자가 이미 클릭한 상태라
// 권한을 위임하면 iframe 안에서도 재생이 허용된다.
// allow는 iframe 문서가 로드되기 시작할 때 정해져서, 이미 로드 중인 문서에는 속성만 바꿔서는
// 반영되지 않는다(같은 src를 다시 넣어도 로드 중이면 무시된다). 그래서 allow를 가진 복제 요소로
// 바꿔 끼워 새 정책으로 다시 로드한다. 학습창은 매번 #bodyf를 새로 찾아 쓰므로 바꿔 끼워도 안전하다.
function delegateAutoplay() {
  if (!settings.enabled || !settings.autoPlay || window !== window.top) return;
  const iframe = document.getElementById('bodyf');
  if (!iframe || iframe.dataset.autonextAllow) return;
  iframe.dataset.autonextAllow = '1';
  if (/\bautoplay\b/.test(iframe.getAttribute('allow') || '')) return;
  console.info('[AutoNext] 콘텐츠 iframe에 autoplay 권한 위임 후 다시 로드');
  const fresh = iframe.cloneNode(false);
  fresh.setAttribute('allow', 'autoplay; fullscreen');
  iframe.replaceWith(fresh);
}

// 학습창(최상위 프레임)의 kendo 알림창 처리
function handleDialogs() {
  if (!settings.enabled || window !== window.top) return;
  const content = document.getElementById('alertDialog');
  const dialog = content?.closest('.k-dialog');
  if (!dialog || !isVisible(dialog)) return;

  const text = content.innerText.trim();
  if (STOP_WORDS.some((w) => text.includes(w))) {
    console.info('[AutoNext] 진행 불가 알림으로 자동 클릭을 끕니다:', text);
    safeStorageSet({ enabled: false, stopReason: text });
    return;
  }
  if (text.includes('PLAY')) dialog.querySelector('.k-dialog-buttongroup button')?.click();
}

function applySettings(next) {
  settings = { ...DEFAULTS, ...next };
  if (!settings.enabled && pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

chrome.storage.local.get(DEFAULTS, applySettings);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const next = { ...settings };
  for (const key of Object.keys(DEFAULTS)) if (key in changes) next[key] = changes[key].newValue;
  applySettings(next);
});

setInterval(() => {
  tick();
  keepMuted();
  startPlayback();
  delegateAutoplay();
  handleDialogs();
}, 1000);
new MutationObserver(() => {
  tick();
  delegateAutoplay();
}).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['style', 'class', 'disabled', 'hidden'],
});
