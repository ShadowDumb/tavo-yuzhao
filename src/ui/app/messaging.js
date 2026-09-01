    async function sendThreadMessage(threadId) {
      if (!enabled()) return;
      if (featureFlags.msg === false) { showToast(I18N.dict().toast.sealedMsg, true); return; }
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var box = overlay && overlay.querySelector('[data-thread-input]');
      if (!box) return;
      var id = threadId || box.getAttribute('data-thread-id') || '';
      var text = String(box.value || '');
      if (!CORE.hasText(text.trim())) { showToast(I18N.dict().emptyInput, true); return; }
      var space = runtime.activeSpace();
      if (!space) return;
      var button = box.parentNode && box.parentNode.querySelector ? box.parentNode.querySelector('[data-action="send-thread-msg"]') : null;
      var busy = beginBusy(busyKey('thread', id), [box, button]);
      if (!busy) return;
      var context = captureUiContext();
      try {
        var sent = runtime.sendSpaceMessage(space.id, id, text);
        if (!sent) { showToast(I18N.dict().spaceMissingEntity, true); return; }
        var persisted = await Promise.resolve(sent.saved);
        if (!persisted || !persisted.ok) {
          showToast(I18N.dict().toast.persistenceFailed, true);
          return;
        }
        var currentOverlay = hostDocument.getElementById(OVERLAY_ID);
        var currentBox = currentOverlay && currentOverlay.querySelector('[data-thread-input]');
        if (uiContextMatches(context) && currentBox === box) {
          box.value = '';
          showToast(I18N.dict().msgSentToast);
          render();
        }
      } catch (error) {
        dbg('thread message failed', error);
        showToast(I18N.dict().toast.persistenceFailed, true);
      } finally {
        endBusy(busy);
      }
    }

    // 论坛评论（当前空间内的帖子）：同样本机直写。
    async function sendPostComment() {
      if (!enabled()) return;
      if (featureFlags.forum === false) { showToast(I18N.dict().toast.sealedForum, true); return; }
      var overlay = hostDocument.getElementById(OVERLAY_ID);
      var box = overlay && overlay.querySelector('[data-comment-input]');
      if (!box) return;
      var postId = box.getAttribute('data-post-id');
      var text = String(box.value || '');
      if (!CORE.hasText(text.trim())) { showToast(I18N.dict().emptyInput, true); return; }
      var space = runtime.activeSpace();
      if (!space) return;
      var button = box.parentNode && box.parentNode.querySelector ? box.parentNode.querySelector('[data-action="send-comment"]') : null;
      var busy = beginBusy(busyKey('comment', postId), [box, button]);
      if (!busy) return;
      var context = captureUiContext();
      try {
        var sent = runtime.sendSpaceComment(space.id, postId, text);
        if (sent && sent.ok === false && sent.reason === 'full') { showToast(I18N.dict().forumCommentsFull, true); return; }
        if (!sent) { showToast(I18N.dict().spaceMissingEntity, true); return; }
        var persisted = await Promise.resolve(sent.saved);
        if (!persisted || !persisted.ok) {
          showToast(I18N.dict().toast.persistenceFailed, true);
          return;
        }
        var currentOverlay = hostDocument.getElementById(OVERLAY_ID);
        var currentBox = currentOverlay && currentOverlay.querySelector('[data-comment-input]');
        if (uiContextMatches(context) && currentBox === box) {
          box.value = '';
          showToast(I18N.dict().commentSentToast);
          render();
        }
      } catch (error) {
        dbg('post comment failed', error);
        showToast(I18N.dict().toast.persistenceFailed, true);
      } finally {
        endBusy(busy);
      }
    }

    // ---------- 空间实体 CRUD UI 动作 ----------

    // 用户直写不经模型评估；表单页通过 nav.view='form' + params 承载。
    // 联系人表单挂在 msg app 的 contact-view 下（renderMsg 识别）。
