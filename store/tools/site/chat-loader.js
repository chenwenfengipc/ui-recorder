// A chat widget the way real ones work: a small cross-origin iframe (localhost vs 127.0.0.1) that asks the page to resize it.
(function () {
  var f = document.createElement('iframe');
  f.id = 'chat';
  f.title = 'Chat widget';
  f.src = 'http://localhost:8781/chat.html';
  document.body.appendChild(f);
  window.addEventListener('message', function (e) {
    if (!e.data || !e.data.chatWidget) return;
    f.classList.toggle('open', e.data.chatWidget === 'open');
  });
})();
