  /* ---------- UI views / taiji bagua wheel ---------- */
  var VIEWS_WHEEL = {
    render: function (ctx) {
      var runtime = ctx.runtime;
      var tr = ctx.tr || function (k) { return k; };
      var space = runtime ? runtime.activeSpace() : null;
      var current = runtime ? runtime.current() : null;
      var sync = (space && space.sync) || {};
      var sealed = (current && current.sealed) || {};
      var applied = CORE.safeArray(sync.applied, 20);
      var appliedSeen = CORE.safeArray(sync.appliedSeen, 20);

      // 八卦方位配置 (先天八卦/后天取象八方平衡环形排列)
      // R = 158px for wheel stage (440x440)
      var trigrams = [
        { id: 'tablet', name: tr('runtime.gua.tablet') || '乾', feat: tr('runtime.feature.tablet') || '本命玉牌', symbol: '☰', angle: -90, color: 'var(--yz-gua-qian)', desc: '天·本命' },
        { id: 'msg',    name: tr('runtime.gua.msg') || '兑',    feat: tr('runtime.feature.msg') || '交流讯息', symbol: '☱', angle: -45, color: 'var(--yz-gua-dui)',  desc: '泽·传讯' },
        { id: 'notes',  name: tr('runtime.gua.notes') || '离',  feat: tr('runtime.feature.notes') || '记事玉册', symbol: '☲', angle: 0,   color: 'var(--yz-gua-li)',   desc: '火·刻录' },
        { id: 'market', name: tr('runtime.gua.market') || '震', feat: tr('runtime.feature.market') || '交易坊市', symbol: '☳', angle: 45,  color: 'var(--yz-gua-zhen)', desc: '雷·交易' },
        { id: 'map',    name: tr('runtime.gua.map') || '坤',    feat: tr('runtime.feature.map') || '天下舆图', symbol: '☷', angle: 90,  color: 'var(--yz-gua-kun)',  desc: '地·舆图' },
        { id: 'manage', name: tr('runtime.gua.manage') || '艮', feat: tr('runtime.feature.manage') || '玉兆管理', symbol: '☶', angle: 135, color: 'var(--yz-gua-gen)',  desc: '山·管控' },
        { id: 'space',  name: tr('runtime.gua.space') || '坎',  feat: tr('runtime.feature.space') || '芥子空间', symbol: '☵', angle: 180, color: 'var(--yz-gua-kan)',  desc: '水·储物' },
        { id: 'forum',  name: tr('runtime.gua.forum') || '巽',  feat: tr('runtime.feature.forum') || '天下论坛', symbol: '☴', angle: 225, color: 'var(--yz-gua-xun)',  desc: '风·论坛' }
      ];

      var R = 158;
      var cardsHtml = trigrams.map(function (g) {
        var rad = (g.angle * Math.PI) / 180;
        var x = Math.round(R * Math.cos(rad));
        var y = Math.round(R * Math.sin(rad));

        var isSealed = g.id !== 'manage' && !!sealed[g.id];
        var unread = 0;
        if (space && !isSealed) {
          if (g.id === 'msg' && space.chats) {
            CORE.safeArray(space.chats.contacts).forEach(function (c) { unread += Number(c.unread) || 0; });
            CORE.safeArray(space.chats.groups).forEach(function (gr) { unread += Number(gr.unread) || 0; });
          } else if (g.id === 'forum' && space.forum) {
            CORE.safeArray(space.forum.posts).forEach(function (p) { unread += Number(p.unread) || 0; });
          }
        }

        var isNew = !isSealed && applied.indexOf(g.id) >= 0 && appliedSeen.indexOf(g.id) < 0;

        var badgeHtml = '';
        if (unread > 0) {
          badgeHtml = '<div class="yz-gua-badge">' + (unread > 99 ? '99+' : unread) + '</div>';
        } else if (isNew) {
          badgeHtml = '<div class="yz-gua-badge yz-new">' + (tr('runtime.badge.new') || '新') + '</div>';
        }

        var sealHtml = isSealed ? '<div class="yz-gua-seal-tag">' + (tr('runtime.seal.glyph') || '封印') + '</div>' : '';

        return '<div class="yz-gua-card' + (isSealed ? ' yz-gua-sealed' : '') + '" data-view="' + g.id + '" style="--gua-x: ' + x + 'px; --gua-y: ' + y + 'px; --gua-accent: ' + g.color + '; transform: translate(' + x + 'px, ' + y + 'px);">' +
          sealHtml +
          badgeHtml +
          '<span class="yz-gua-symbol">' + g.symbol + '</span>' +
          '<span class="yz-gua-name">' + CORE.escapeHtml(g.name) + '</span>' +
          '<span class="yz-gua-feature">' + CORE.escapeHtml(g.feat) + '</span>' +
        '</div>';
      }).join('');

      var syncStatus = sync.status || 'empty';
      var statusDotClass = syncStatus === 'complete' ? '' : (syncStatus === 'partial' ? ' yz-partial' : ' yz-invalid');
      var statusText = tr('runtime.sync.' + syncStatus) || (syncStatus === 'complete' ? '天道完备' : (syncStatus === 'partial' ? '部分感应' : '待同步'));
      var roleName = sync.roleName || (space && space.isDefault ? '当前仙友' : (space ? space.name : '玉兆道友'));
      var summaryText = sync.summary ? sync.summary : (tr('runtime.awaitingSync') || '万象初开，静候灵气流转');

      return '<div class="yz-wheel-container">' +
        '<div class="yz-wheel-stage">' +
          '<div class="yz-wheel-ring"></div>' +
          '<div class="yz-wheel-ring-inner"></div>' +
          
          /* 太极中枢 */
          '<div id="yz-taiji-core" class="yz-taiji-hub" title="点击查看玉兆灵气与同步诊断">' +
            '<svg class="yz-taiji-svg" viewBox="0 0 100 100">' +
              '<defs>' +
                '<radialGradient id="yz-yin-grad" cx="35%" cy="35%" r="65%"><stop offset="0%" stop-color="#34d399"/><stop offset="100%" stop-color="#064e3b"/></radialGradient>' +
                '<radialGradient id="yz-yang-grad" cx="35%" cy="35%" r="65%"><stop offset="0%" stop-color="#0f2b26"/><stop offset="100%" stop-color="#041210"/></radialGradient>' +
              '</defs>' +
              '<circle cx="50" cy="50" r="48" fill="url(#yz-yang-grad)" stroke="rgba(52,211,153,0.4)" stroke-width="1.5"/>' +
              '<path d="M 50,2 A 48,48 0 0,1 50,98 A 24,24 0 0,1 50,50 A 24,24 0 0,0 50,2 Z" fill="url(#yz-yin-grad)"/>' +
              '<circle cx="50" cy="26" r="6.5" fill="#041210"/>' +
              '<circle cx="50" cy="74" r="6.5" fill="#34d399"/>' +
            '</svg>' +
            '<span class="yz-taiji-label">' + CORE.escapeHtml(statusText) + '</span>' +
          '</div>' +

          cardsHtml +
        '</div>' +

        /* 底部状态条 */
        '<div class="yz-wheel-footer">' +
          '<span class="yz-sync-dot' + statusDotClass + '"></span>' +
          '<span>' + CORE.escapeHtml(roleName) + '</span>' +
          '<span style="opacity: 0.4;">|</span>' +
          '<span style="max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + CORE.escapeHtml(summaryText) + '</span>' +
        '</div>' +
      '</div>';
    },

    bindEvents: function (el, ctx) {
      var navigation = ctx.navigation;
      var cards = el.querySelectorAll('.yz-gua-card');
      cards.forEach(function (card) {
        card.addEventListener('click', function () {
          var viewId = card.getAttribute('data-view');
          if (viewId) navigation.navigate(viewId);
        });
      });

      var taiji = el.querySelector('#yz-taiji-core');
      if (taiji) {
        taiji.addEventListener('click', function () {
          navigation.navigate('sync');
        });
      }
    }
  };
