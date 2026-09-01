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
      var sent = runtime.sendSpaceMessage(space.id, id, text);
      if (!sent) { showToast(I18N.dict().spaceMissingEntity, true); return; }
      var persisted = await Promise.resolve(sent.saved);
      if (!persisted || !persisted.ok) { showToast(I18N.dict().toast.persistenceFailed, true); render(); return; }
      box.value = '';
      showToast(I18N.dict().msgSentToast);
      render();
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
      var sent = runtime.sendSpaceComment(space.id, postId, text);
      if (sent && sent.ok === false && sent.reason === 'full') { showToast(I18N.dict().forumCommentsFull, true); return; }
      if (!sent) { showToast(I18N.dict().spaceMissingEntity, true); return; }
      var persisted = await Promise.resolve(sent.saved);
      if (!persisted || !persisted.ok) { showToast(I18N.dict().toast.persistenceFailed, true); render(); return; }
      box.value = '';
      showToast(I18N.dict().commentSentToast);
      render();
    }

    // ---------- 空间实体 CRUD UI 动作 ----------

    // 用户直写不经模型评估；表单页通过 nav.view='form' + params 承载。
    // 联系人表单挂在 msg app 的 contact-view 下（renderMsg 识别）。
