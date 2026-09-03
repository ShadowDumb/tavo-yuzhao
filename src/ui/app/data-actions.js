  /* ---------- UI app / data actions ---------- */
  function createDataActions(ctx) {
    var runtime = ctx.runtime;
    var shell = ctx.shell;
    var dialogs = ctx.dialogs;
    var tr = ctx.tr || function (k) { return k; };

    function saveEntity(kind, data, spaceId, existingId) {
      if (!runtime) return;
      var targetSpace = spaceId || (runtime.activeSpace() && runtime.activeSpace().id) || '';
      var res = runtime.spaceSaveEntity(targetSpace, kind, data, existingId || (data && data.id));
      if (res && res.ok) {
        dialogs.toast(tr('runtime.player.saved') || '已保存修改', 'success');
        if (dialogs.closeModal) dialogs.closeModal();
        if (shell) shell.render();
      } else {
        dialogs.toast((res && res.reason) || '保存失败', 'danger');
      }
    }

    function deleteEntity(kind, id, spaceId, name, extraId) {
      if (!runtime) return;
      var targetSpace = spaceId || (runtime.activeSpace() && runtime.activeSpace().id) || '';
      var res = runtime.spaceDeleteEntity(targetSpace, kind, id, extraId);
      if (res && res.ok) {
        var snapshot = res.snapshot;
        var msg = (name ? ('「' + name + '」') : '') + (tr('runtime.player.deleted') || '已删除');
        dialogs.showUndo(msg, function () {
          if (snapshot) runtime.spaceRestoreEntity(snapshot);
          if (shell) shell.render();
        }, 6000);
        if (shell) shell.render();
      } else {
        dialogs.toast('删除失败', 'danger');
      }
    }

    function sendMessage(threadType, threadId, text, spaceId) {
      if (!runtime || !text) return;
      var targetSpace = spaceId || (runtime.activeSpace() && runtime.activeSpace().id) || '';
      var res = runtime.sendSpaceMessage(targetSpace, threadId, text);
      if (res && (res.ok || res.id)) {
        dialogs.toast(tr('runtime.space.msgSent') || '传音符已发出', 'success');
        if (shell) shell.render();
      } else {
        dialogs.toast((res && res.reason) || '发送失败', 'danger');
      }
    }

    function sendComment(postId, text, spaceId) {
      if (!runtime || !text) return;
      var targetSpace = spaceId || (runtime.activeSpace() && runtime.activeSpace().id) || '';
      var res = runtime.sendSpaceComment(targetSpace, postId, text);
      if (res && (res.ok || res.id)) {
        dialogs.toast(tr('runtime.space.commentSent') || '共鸣留言已发布', 'success');
        if (shell) shell.render();
      } else {
        dialogs.toast((res && res.reason) || '评论失败', 'danger');
      }
    }

    function createSpace(name) {
      if (!runtime) return;
      var res = runtime.createSpace(name);
      if (res && res.ok) {
        dialogs.toast(tr('runtime.space.created') || '空间已创建', 'success');
        if (shell) shell.render();
      } else {
        dialogs.toast((res && res.reason) || '创建空间失败', 'danger');
      }
    }

    function renameSpace(spaceId, name) {
      if (!runtime) return;
      var res = runtime.renameSpace(spaceId, name);
      if (res && res.ok) {
        dialogs.toast(tr('runtime.space.renamed') || '空间已重命名', 'success');
        if (shell) shell.render();
      } else {
        dialogs.toast((res && res.reason) || '重命名失败', 'danger');
      }
    }

    function deleteSpace(spaceId, name) {
      if (!runtime) return;
      var res = runtime.deleteSpace(spaceId);
      if (res && res.ok) {
        var removed = res.removed;
        dialogs.showUndo('空间「' + name + '」已删除', function () {
          if (removed) runtime.restoreSpace(removed);
          if (shell) shell.render();
        }, 6000);
        if (shell) shell.render();
      } else {
        dialogs.toast('删除空间失败', 'danger');
      }
    }

    function switchSpace(spaceId) {
      if (!runtime) return;
      runtime.setActiveSpace(spaceId);
      if (shell) shell.render();
    }

    function setSpaceFlag(spaceId, key, val) {
      if (!runtime) return;
      runtime.setSpaceFlag(spaceId, key, val);
      if (shell) shell.render();
    }

    function clearChatData(chatId) {
      if (!runtime) return;
      dialogs.confirm({
        title: tr('runtime.toast.clearTitle') || '清空本会话玉兆数据',
        message: tr('runtime.toast.clearConfirm') || '确定要清空本聊天的所有玉兆数据并从世界书清除吗？此操作无法撤销。',
        danger: true,
        onConfirm: function () {
          runtime.beginClear(chatId);
          dialogs.toast(tr('runtime.toast.cleared') || '数据已清空', 'info');
          if (shell) shell.render();
        }
      });
    }

    function rebuildHistory(chatId) {
      if (!runtime) return;
      runtime.rebuildFromHistory(chatId).then(function (res) {
        if (res && res.ok) {
          dialogs.toast(tr('runtime.toast.rebuilt') || '已从历史重新同步', 'success');
        } else {
          dialogs.toast(tr('runtime.toast.restoreFailed') || '同步重建失败', 'warn');
        }
        if (shell) shell.render();
      });
    }

    return {
      saveEntity: saveEntity,
      deleteEntity: deleteEntity,
      sendMessage: sendMessage,
      sendComment: sendComment,
      createSpace: createSpace,
      renameSpace: renameSpace,
      deleteSpace: deleteSpace,
      switchSpace: switchSpace,
      setSpaceFlag: setSpaceFlag,
      clearChatData: clearChatData,
      rebuildHistory: rebuildHistory
    };
  }
