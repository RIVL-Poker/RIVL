// Screen modes: the full screen table button (bot practice, online rooms, Ranked) and the collapsible desktop sidebar.
// Loaded in <head> so a collapsed sidebar is applied before the page paints.
(function(){
  const SIDEBAR_KEY = 'rivlSidebar';
  const root = document.documentElement;
  try { if (localStorage.getItem(SIDEBAR_KEY) === 'collapsed') root.classList.add('sidebar-collapsed') } catch(e) {}

  const ICON_ENTER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>';
  const ICON_EXIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>';

  // A match is on screen: the bot table, or an online room (casual or Ranked) that has started.
  function inMatch(){
    return document.body.classList.contains('in-game') || !!document.querySelector('#rooms.active.rivl-match-mode');
  }
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const focused = () => document.body.classList.contains('table-focus');

  function paint(){
    const on = focused();
    document.querySelectorAll('.fs-toggle').forEach(b => {
      b.innerHTML = (on ? ICON_EXIT : ICON_ENTER) + '<span class="fs-label">' + (on ? 'EXIT FULL SCREEN' : 'FULL SCREEN') + '</span>';
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Exit full screen (Esc)' : 'Full screen: show only the table';
    });
  }

  function enter(){
    document.body.classList.add('table-focus');
    paint();
    // iPhone browsers have no full screen for web pages, so there the table-only view stays inside the browser window.
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (request && !fsElement()) {
      try { const p = request.call(root); if (p && p.catch) p.catch(() => {}) } catch(e) {}
    }
  }

  function exit(){
    document.body.classList.remove('table-focus');
    paint();
    if (fsElement()) {
      const leave = document.exitFullscreen || document.webkitExitFullscreen;
      try { const p = leave.call(document); if (p && p.catch) p.catch(() => {}) } catch(e) {}
    }
  }

  function makeButton(id){
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = 'outline fs-toggle';
    b.onclick = () => focused() ? exit() : enter();
    return b;
  }

  function setSidebar(collapsed){
    root.classList.toggle('sidebar-collapsed', collapsed);
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'open') } catch(e) {}
    const b = document.getElementById('sidebarToggle');
    if (b) {
      b.setAttribute('aria-expanded', String(!collapsed));
      b.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      b.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    }
  }

  function init(){
    const botActions = document.querySelector('#table .gamebar-actions');
    if (botActions) botActions.prepend(makeButton('tableFocus'));
    const roomTop = document.querySelector('#rooms .room-topline');
    const leaveRoom = document.getElementById('leaveRoom');
    if (roomTop) roomTop.insertBefore(makeButton('roomFocus'), leaveRoom && leaveRoom.parentElement === roomTop ? leaveRoom : null);
    paint();

    // Leaving the browser's full screen (Esc, or the system gesture) also leaves the table-only view.
    const onFsChange = () => { if (!fsElement() && focused()) exit() };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && focused() && !fsElement()) exit() });

    // The match ending, or the player leaving it, returns to the normal page.
    const watch = new MutationObserver(() => { if (focused() && !inMatch()) exit() });
    watch.observe(document.body, {attributes: true, attributeFilter: ['class']});
    const rooms = document.getElementById('rooms');
    if (rooms) watch.observe(rooms, {attributes: true, attributeFilter: ['class']});

    const brand = document.querySelector('.sidebar .brand');
    if (brand) {
      const t = document.createElement('button');
      t.type = 'button';
      t.id = 'sidebarToggle';
      t.className = 'sidebar-toggle';
      t.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
      t.onclick = () => setSidebar(!root.classList.contains('sidebar-collapsed'));
      brand.after(t);
      setSidebar(root.classList.contains('sidebar-collapsed'));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
