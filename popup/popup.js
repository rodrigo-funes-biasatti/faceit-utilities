chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const dot = document.getElementById('dot');
  const text = document.getElementById('status-text');
  const url = tab?.url ?? '';

  if (url.includes('faceit.com/') && url.includes('/cs2/room/')) {
    dot.className = 'dot dot--active';
    text.textContent = 'En sala de FACEIT ✓';
  } else if (url.includes('faceit.com')) {
    dot.className = 'dot dot--idle';
    text.textContent = 'En FACEIT – esperando sala';
  } else {
    dot.className = 'dot dot--off';
    text.textContent = 'Abre faceit.com para comenzar';
  }
});

document.getElementById('clear-cache').addEventListener('click', () => {
  const btn = document.getElementById('clear-cache');
  chrome.storage.local.clear(() => {
    btn.textContent = '✓ Caché limpiado';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = 'Limpiar caché';
      btn.disabled = false;
    }, 2000);
  });
});
