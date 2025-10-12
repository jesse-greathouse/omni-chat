// renderer/installer.js
(function () {
  const statusEl = document.getElementById('status');
  const btnRun   = document.getElementById('btnRun');
  const btnOpen  = document.getElementById('btnOpenLogs');
  const btnGo    = document.getElementById('btnProceed');
  const logEl    = document.getElementById('log');

  if (!window.api || !window.api.bootstrap) {
    console.error('preload/api missing');
    return;
  }

  function appendLog(s) {
    if (!logEl) return;
    logEl.textContent += String(s);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // Subscribe and keep unsubscribe handles
  const offLog  = window.api.bootstrap.onLog((line) => appendLog(line));
  const offDone = window.api.bootstrap.onDone(() => {
    statusEl.textContent = 'OK';
    statusEl.classList.add('ok');
  });
  const offErr  = window.api.bootstrap.onError((code) => {
    statusEl.textContent = 'Error';
    statusEl.classList.add('err');
    appendLog('\n[bootstrap] exited with code ' + code + '\n');
  });

  // Use the handles so they aren't "unused"
  window.addEventListener('beforeunload', () => {
    try { offLog?.(); }  catch (e) { console.error('offLog()', e); }
    try { offDone?.(); } catch (e) { console.error('offDone()', e); }
    try { offErr?.(); }  catch (e) { console.error('offErr()', e); }
  });

  btnRun.addEventListener('click', () => {
    statusEl.textContent = 'Installing...';
    statusEl.classList.remove('ok', 'err');
    window.api.bootstrap.runInTerminal();
  });

  btnOpen.addEventListener('click', () => window.api.bootstrap.openLogsDir());
  btnGo.addEventListener('click',   () => window.api.bootstrap.proceedIfReady());
})();
