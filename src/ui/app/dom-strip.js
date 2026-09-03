  /* ---------- UI app / dom-strip ---------- */
  function createDomStrip(ctx) {
    var document = ctx.document;
    var getFlags = ctx.getFlags || function () { return { enabled: true, auto_strip: true }; };
    var observer = null;
    var timer = null;

    function stripInElement(rootEl) {
      if (!rootEl) return;
      var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null, false);
      var node;
      var pattern = /<yz_jade[\s\S]*?<\/yz_jade>/gi;
      while ((node = walker.nextNode())) {
        if (node.nodeValue && pattern.test(node.nodeValue)) {
          node.nodeValue = node.nodeValue.replace(pattern, '').trim();
        }
      }
    }

    function scheduleScan() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        var flags = getFlags();
        if (flags && flags.enabled === false) return;
        if (flags && flags.auto_strip === false) return;
        stripInElement(document.body);
      }, 220);
    }

    function start() {
      if (typeof MutationObserver === 'undefined' || !document || !document.body) return;
      if (observer) return;
      observer = new MutationObserver(function (mutations) {
        var hasAdded = mutations.some(function (m) { return m.addedNodes && m.addedNodes.length > 0; });
        if (hasAdded) scheduleScan();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleScan();
    }

    function stop() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    return {
      start: start,
      stop: stop,
      scanNow: scheduleScan
    };
  }
