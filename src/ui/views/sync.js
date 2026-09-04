  /* ---------- UI views / sync detail ---------- */
  var VIEWS_SYNC = {
    render: function (ctx) {
      var runtime = ctx.runtime;
      var tr = ctx.tr || function (k) { return k; };
      var space = runtime ? runtime.activeSpace() : null;
      var current = runtime ? runtime.current() : null;
      var sync = (space && space.sync) || {};
      var issues = CORE.safeArray(sync.issues, 20);

      var statusText = tr('runtime.sync.' + (sync.status || 'empty')) || sync.status || '待同步';
      var headerHtml = VIEWS_SHARED.renderHeader({
        title: tr('runtime.diag.title') || '玉兆天机 · 同步诊断',
        icon: '☯',
        actions: [
          { id: 'yz-btn-resync', label: '从历史重修', primary: true },
          { id: 'yz-btn-clear', label: '清空重置', danger: true }
        ]
      });

      var issuesHtml = issues.length === 0
        ? '<div style="color: var(--yz-jade-light); font-size: 13px;">' + (tr('runtime.diag.noIssues') || '灵气通达，无任何阻断异常') + '</div>'
        : issues.map(function (iss) {
            var label = iss.path || iss.code || '未知异常';
            var trans = tr('assess.issue.' + label) || label;
            return '<div style="padding: 8px 12px; border-radius: 8px; background: var(--yz-danger-bg); border: 1px solid var(--yz-danger); color: var(--yz-danger); font-size: 12px; display: flex; align-items: center; gap: 8px;">' +
              '<span>⚠</span>' +
              '<span>' + CORE.escapeHtml(trans) + '</span>' +
            '</div>';
          }).join('');

      var appliedTags = CORE.safeArray(sync.applied, 10).map(function (ap) {
        return '<span style="padding: 2px 8px; border-radius: 6px; background: rgba(52, 211, 153, 0.2); border: 1px solid var(--yz-border-jade); color: var(--yz-jade-light); font-size: 11px;">' + CORE.escapeHtml(ap) + '</span>';
      }).join(' ');

      return '<div class="yz-subview">' +
        headerHtml +
        '<div class="yz-card-grid" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));">' +
          '<div class="yz-card">' +
            '<div class="yz-card-title">' + (tr('runtime.diag.status') || '同步状态') + '</div>' +
            '<div style="font-size: 16px; font-weight: 600; color: var(--yz-jade-light); margin: 4px 0;">' + CORE.escapeHtml(statusText) + '</div>' +
            '<div class="yz-card-body">' + (tr('runtime.diag.summary') || '摘要') + '：' + CORE.escapeHtml(sync.summary || '-') + '</div>' +
            '<div class="yz-card-footer">' +
              '<span>' + (tr('runtime.diag.turn') || '轮次') + '：' + CORE.escapeHtml(sync.turnId || '-') + '</span>' +
              '<span>' + (tr('runtime.diag.turns') || '累计轮次') + '：' + (sync.totalTurns || 0) + '</span>' +
            '</div>' +
          '</div>' +

          '<div class="yz-card">' +
            '<div class="yz-card-title">' + (tr('runtime.diag.applied') || '本轮已生效分区') + '</div>' +
            '<div style="display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0;">' + (appliedTags || '<span style="color: var(--yz-text-muted); font-size: 12px;">无变化</span>') + '</div>' +
            '<div class="yz-card-footer">' +
              '<span>' + (tr('runtime.diag.chatId') || '聊天标识') + '：' + CORE.escapeHtml(runtime ? runtime.activeChatId : '-') + '</span>' +
              '<span>更新时间：' + CORE.formatDateTime(sync.updatedAt) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="yz-card">' +
          '<div class="yz-card-title">' + (tr('runtime.diag.issues') || '天机异常诊断清单') + '</div>' +
          '<div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">' + issuesHtml + '</div>' +
        '</div>' +
      '</div>';
    },

    bindEvents: function (el, ctx) {
      var dataActions = ctx.dataActions;
      var runtime = ctx.runtime;

      var resyncBtn = el.querySelector('#yz-btn-resync');
      if (resyncBtn) {
        resyncBtn.addEventListener('click', function () {
          if (dataActions && runtime) dataActions.rebuildHistory(runtime.activeChatId);
        });
      }

      var clearBtn = el.querySelector('#yz-btn-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          if (dataActions && runtime) dataActions.clearChatData(runtime.activeChatId);
        });
      }
    }
  };
