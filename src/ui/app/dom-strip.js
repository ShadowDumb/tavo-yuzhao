    function isOwnNode(node) {
      var el = node && node.nodeType === 1 ? node : node && node.parentElement;
      if (!el || typeof el.closest !== 'function') return false;
      return !!(el.closest('#' + OVERLAY_ID) || el.closest('#' + FAB_ID));
    }

    function looksLikeEnvelope(value) {
      return /(?:<|&lt;)y(?:z|$)/i.test(String(value == null ? '' : value));
    }

    function stripNodes(nodes) {
      Array.prototype.forEach.call(nodes, function (node) {
        if (isOwnNode(node)) return;
        if (!node.nodeValue || !looksLikeEnvelope(node.nodeValue)) return;
        var next = PROTOCOL.stripStreamTail(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
      });
    }

    function collectTextNodes(root, out) {
      if (!root || isOwnNode(root)) return;
      if (root.nodeType === 3) { out.push(root); return; }
      if (root.nodeType !== 1) return;
      try {
        var walker = hostDocument.createTreeWalker(root, hostWindow.NodeFilter.SHOW_TEXT);
        var node;
        while ((node = walker.nextNode())) out.push(node);
      } catch (_) {}
    }

    // 全量扫描：启动时与每条协议消息后执行（协议消息可能含旧协议残留）。
    function stripVisibleBlocks() {
      if (!enabled() || !autoStrip()) return;
      var nodes = [];
      collectTextNodes(hostDocument.body, nodes);
      stripNodes(nodes);
    }

    // 只处理本批变更实际触及的文本节点：
    // characterData 的 target 就是文本节点本身；childList 取新增节点内的文本。
    function stripFromMutations(mutations) {
      if (!enabled() || !autoStrip() || !mutations.length) return;
      var nodes = [];
      mutations.forEach(function (mutation) {
        if (mutation.type === 'characterData') {
          if (mutation.target && mutation.target.nodeType === 3) nodes.push(mutation.target);
          return;
        }
        if (mutation.addedNodes && mutation.addedNodes.length) {
          Array.prototype.forEach.call(mutation.addedNodes, function (added) { collectTextNodes(added, nodes); });
        }
      });
      stripNodes(nodes);
    }

