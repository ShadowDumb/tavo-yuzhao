  /* ---------- UI views / management (Gen) ---------- */
  var VIEWS_MANAGE = {
    render: function (ctx) {
      var runtime = ctx.runtime;
      var state = ctx.state;
      var tr = ctx.tr || function (k) { return k; };
      var current = runtime ? runtime.current() : null;
      var sealed = (current && current.sealed) || {};
      var spaces = (current && current.spaces) || [];

      var headerHtml = VIEWS_SHARED.renderHeader({
        title: tr('runtime.feature.manage') || '玉兆管理',
        subtitle: '艮卦 · 山 · 掌开阖启停',
        icon: '☶'
      });

      var featureList = [
        { id: 'tablet', name: tr('runtime.feature.tablet') || '本命玉牌', symbol: '☰ 乾', desc: '角色基本属性、外貌修为、功法羁绊' },
        { id: 'msg',    name: tr('runtime.feature.msg') || '交流讯息',    symbol: '☱ 兑', desc: '传音符私聊、宗门群聊、未读传讯' },
        { id: 'notes',  name: tr('runtime.feature.notes') || '记事玉册',  symbol: '☲ 离', desc: '分类备忘录、禁制锁定条目' },
        { id: 'market', name: tr('runtime.feature.market') || '交易坊市', symbol: '☳ 震', desc: '在售法宝、珍宝拍卖、订单与求购' },
        { id: 'forum',  name: tr('runtime.feature.forum') || '天下论坛',  symbol: '☴ 巽', desc: '天下修士八方论道、共鸣留言' },
        { id: 'space',  name: tr('runtime.feature.space') || '芥子空间',  symbol: '☵ 坎', desc: '灵石资产、法宝丹药收纳' },
        { id: 'map',    name: tr('runtime.feature.map') || '天下舆图',    symbol: '☷ 坤', desc: '当前所在域、近期行踪步履名录' }
      ];

      var togglesHtml = featureList.map(function (f) {
        var isSealed = !!sealed[f.id];
        return '<div class="yz-card" style="flex-direction: row; align-items: center; justify-content: space-between; padding: 10px 14px;">' +
          '<div>' +
            '<div style="display: flex; align-items: center; gap: 8px;">' +
              '<span style="font-family: var(--yz-font-serif); font-size: 16px; font-weight: 700; color: var(--yz-jade-light);">' + f.symbol + '</span>' +
              '<span style="font-weight: 600; color: var(--yz-text-primary);">' + CORE.escapeHtml(f.name) + '</span>' +
              (isSealed ? '<span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(248, 113, 113, 0.2); color: var(--yz-danger); border: 1px solid var(--yz-danger);">' + (tr('runtime.seal.glyph') || '封印中') + '</span>' : '') +
            '</div>' +
            '<div style="font-size: 11px; color: var(--yz-text-muted); margin-top: 2px;">' + CORE.escapeHtml(f.desc) + '</div>' +
          '</div>' +
          '<label style="display: flex; align-items: center; cursor: pointer;">' +
            '<input type="checkbox" class="yz-seal-toggle" data-feature="' + f.id + '"' + (!isSealed ? ' checked' : '') + ' style="width: 18px; height: 18px; accent-color: var(--yz-jade-light);">' +
          '</label>' +
        '</div>';
      }).join('');

      var activeSpaceId = current ? current.activeSpaceId : CORE.DEFAULT_SPACE_ID;
      var spacesHtml = spaces.map(function (sp) {
        var isActive = String(sp.id) === String(activeSpaceId);
        var isDefault = !!sp.isDefault;
        var name = CORE.spaceDisplayName(sp, isDefault ? (tr('runtime.space.defaultName') || '默认空间') : '');

        return '<div class="yz-card" style="padding: 12px; border-left: 3px solid ' + (isActive ? 'var(--yz-jade-light)' : 'var(--yz-border-jade)') + ';">' +
          '<div class="yz-card-header">' +
            '<div style="display: flex; align-items: center; gap: 8px;">' +
              '<span style="font-weight: 700; color: ' + (isActive ? 'var(--yz-jade-light)' : 'var(--yz-text-primary)') + ';">' + CORE.escapeHtml(name) + '</span>' +
              (isDefault ? '<span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(52, 211, 153, 0.15); color: var(--yz-jade-light); border: 1px solid var(--yz-border-jade);">默认空间</span>' : '') +
              (isActive ? '<span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--yz-jade-light); color: #061514; font-weight: 700;">当前所处</span>' : '') +
            '</div>' +
            '<div style="display: flex; gap: 6px;">' +
              (!isActive ? ('<button class="yz-btn-space-enter yz-btn-primary" data-id="' + CORE.escapeHtml(sp.id) + '" style="padding: 3px 10px; font-size: 11px;">进入</button>') : '') +
              (!isDefault ? ('<button class="yz-btn-space-rename yz-btn-icon" data-id="' + CORE.escapeHtml(sp.id) + '" data-name="' + CORE.escapeHtml(sp.name || '') + '" style="width: 26px; height: 26px;" title="重命名">✎</button>') : '') +
              (!isDefault ? ('<button class="yz-btn-space-delete yz-btn-icon" data-id="' + CORE.escapeHtml(sp.id) + '" data-name="' + CORE.escapeHtml(sp.name || '') + '" style="width: 26px; height: 26px; color: var(--yz-danger);" title="删除空间">🗑</button>') : '') +
            '</div>' +
          '</div>' +
          '<div style="display: flex; gap: 16px; margin-top: 6px; font-size: 12px; color: var(--yz-text-secondary);">' +
            '<label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">' +
              '<input type="checkbox" class="yz-space-flag" data-id="' + CORE.escapeHtml(sp.id) + '" data-flag="allowAIWrite"' + (sp.allowAIWrite !== false ? ' checked' : '') + (isDefault ? ' disabled' : '') + ' style="accent-color: var(--yz-jade-light);">' +
              '<span>AI 可读写</span>' +
            '</label>' +
            '<label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">' +
              '<input type="checkbox" class="yz-space-flag" data-id="' + CORE.escapeHtml(sp.id) + '" data-flag="sendToAI"' + (sp.sendToAI !== false ? ' checked' : '') + ' style="accent-color: var(--yz-jade-light);">' +
              '<span>发送 AI</span>' +
            '</label>' +
          '</div>' +
        '</div>';
      }).join('');

      return '<div class="yz-subview">' +
        headerHtml +

        /* 1. 功能封印总控 (省 token 核心) */
        '<div class="yz-card" style="border-top: 2px solid var(--yz-gua-gen);">' +
          '<div class="yz-card-header">' +
            '<span class="yz-card-title">八卦功能启闭封印（省 Token 核心）</span>' +
            '<span style="font-size: 11px; color: var(--yz-text-muted);">关闭的功能将不再注入提示词，亦不接收大模型生成</span>' +
          '</div>' +
          '<div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">' + togglesHtml + '</div>' +
        '</div>' +

        /* 2. 空间管理 */
        '<div class="yz-card">' +
          '<div class="yz-card-header">' +
            '<span class="yz-card-title">九幽诸天 · 空间管理 (' + spaces.length + '/' + CORE.MAX_SPACES + ')</span>' +
            '<span style="font-size: 11px; color: var(--yz-text-muted);">支持多套独立玉兆数据空间切换</span>' +
          '</div>' +
          '<div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">' + spacesHtml + '</div>' +
          '<div style="display: flex; gap: 8px; margin-top: 10px;">' +
            '<input type="text" id="yz-space-new-input" class="yz-input" placeholder="新建空间名称（如：分身历练空间）...">' +
            '<button id="yz-space-new-btn" class="yz-btn-primary" style="padding: 6px 14px; font-size: 12px; white-space: nowrap;">新建空间</button>' +
          '</div>' +
        '</div>' +

        /* 3. 系统维护 */
        '<div class="yz-card">' +
          '<div class="yz-card-title" style="margin-bottom: 8px;">天机维护与重置</div>' +
          '<div style="display: flex; flex-wrap: wrap; gap: 10px;">' +
            '<button id="yz-btn-reset-fab" class="yz-btn-icon" style="width: auto; padding: 6px 12px; font-size: 12px;">复位悬浮玉佩位置</button>' +
            '<button id="yz-btn-resync-manage" class="yz-btn-icon" style="width: auto; padding: 6px 12px; font-size: 12px;">从历史重修同步</button>' +
            '<button id="yz-btn-clear-manage" class="yz-btn-icon" style="width: auto; padding: 6px 12px; font-size: 12px; color: var(--yz-danger); border-color: var(--yz-danger);">清空当前会话数据</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    },

    bindEvents: function (el, ctx) {
      var runtime = ctx.runtime;
      var shell = ctx.shell;
      var fab = ctx.fab;
      var dialogs = ctx.dialogs;
      var dataActions = ctx.dataActions;

      // 封印开关
      var toggles = el.querySelectorAll('.yz-seal-toggle');
      toggles.forEach(function (tog) {
        tog.addEventListener('change', function () {
          var feat = tog.getAttribute('data-feature');
          var current = runtime ? runtime.current() : null;
          if (current && feat) {
            current.sealed = current.sealed || {};
            current.sealed[feat] = !tog.checked;
            current.pendingFull = true; // 置强制全量标记
            if (runtime.saveChat && runtime.activeChatId) {
              runtime.saveChat(runtime.activeChatId, { force: true });
            }
            dialogs.toast(tog.checked ? ('已解封「' + feat + '」') : ('已封印「' + feat + '」'), 'info');
            shell.render();
          }
        });
      });

      // 空间切换
      var enterBtns = el.querySelectorAll('.yz-btn-space-enter');
      enterBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          if (id && dataActions) dataActions.switchSpace(id);
        });
      });

      // 空间重命名
      var renameBtns = el.querySelectorAll('.yz-btn-space-rename');
      renameBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          var oldName = btn.getAttribute('data-name');
          var newName = window.prompt('请输入新的空间名称：', oldName);
          if (newName && newName.trim() && dataActions) {
            dataActions.renameSpace(id, newName.trim());
          }
        });
      });

      // 空间删除
      var delBtns = el.querySelectorAll('.yz-btn-space-delete');
      delBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          var name = btn.getAttribute('data-name');
          if (id && dataActions) {
            dialogs.confirm({
              title: '删除空间确认',
              message: '确定要删除空间「' + name + '」吗？删除后 6 秒内可撤销。',
              danger: true,
              onConfirm: function () {
                dataActions.deleteSpace(id, name);
              }
            });
          }
        });
      });

      // 空间 Flag 切换
      var flagBoxes = el.querySelectorAll('.yz-space-flag');
      flagBoxes.forEach(function (box) {
        box.addEventListener('change', function () {
          var id = box.getAttribute('data-id');
          var flag = box.getAttribute('data-flag');
          if (id && flag && dataActions) {
            dataActions.setSpaceFlag(id, flag, box.checked);
          }
        });
      });

      // 新建空间
      var newBtn = el.querySelector('#yz-space-new-btn');
      var newInp = el.querySelector('#yz-space-new-input');
      function doCreateSpace() {
        if (!newInp || !dataActions) return;
        var name = String(newInp.value || '').trim();
        if (!name) {
          dialogs.toast('空间名称不能为空', 'warn');
          return;
        }
        dataActions.createSpace(name);
        newInp.value = '';
      }
      if (newBtn) newBtn.addEventListener('click', doCreateSpace);
      if (newInp) {
        newInp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') doCreateSpace();
        });
      }

      // 维护操作
      var resetFabBtn = el.querySelector('#yz-btn-reset-fab');
      if (resetFabBtn && fab) {
        resetFabBtn.addEventListener('click', function () {
          fab.resetPosition();
        });
      }

      var resyncBtn = el.querySelector('#yz-btn-resync-manage');
      if (resyncBtn && dataActions && runtime) {
        resyncBtn.addEventListener('click', function () {
          dataActions.rebuildHistory(runtime.activeChatId);
        });
      }

      var clearBtn = el.querySelector('#yz-btn-clear-manage');
      if (clearBtn && dataActions && runtime) {
        clearBtn.addEventListener('click', function () {
          dataActions.clearChatData(runtime.activeChatId);
        });
      }
    }
  };
