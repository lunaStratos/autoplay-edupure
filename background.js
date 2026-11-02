// 켜져 있으면 툴바 아이콘에 ON 배지를 표시한다.
async function refreshBadge() {
  const { enabled } = await chrome.storage.local.get({ enabled: false });
  await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  await chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
}

chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'enabled' in changes) refreshBadge();
});
