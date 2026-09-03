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
      // 8 等分空心圆环形扇面配置：以 (220, 220) 为中枢，内径 R_in = 76，外径 R_out = 214
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

      var cx = 220;
      var cy = 220;
      var R_in = 76;
      var R_out = 214;
      var R_mid = 145;
      var degToRad = function (d) { return (d * Math.PI) / 180; };
      var gap = 2.5;
      var half_span = (45 - gap) / 2;

      function sectorPath(a1, a2, r1, r2) {
        var x1 = (cx + r2 * Math.cos(degToRad(a1))).toFixed(1);
        var y1 = (cy + r2 * Math.sin(degToRad(a1))).toFixed(1);
        var x2 = (cx + r2 * Math.cos(degToRad(a2))).toFixed(1);
        var y2 = (cy + r2 * Math.sin(degToRad(a2))).toFixed(1);
        var x3 = (cx + r1 * Math.cos(degToRad(a2))).toFixed(1);
        var y3 = (cy + r1 * Math.sin(degToRad(a2))).toFixed(1);
        var x4 = (cx + r1 * Math.cos(degToRad(a1))).toFixed(1);
        var y4 = (cy + r1 * Math.sin(degToRad(a1))).toFixed(1);
        return 'M ' + x1 + ' ' + y1 + ' A ' + r2 + ' ' + r2 + ' 0 0 1 ' + x2 + ' ' + y2 + ' L ' + x3 + ' ' + y3 + ' A ' + r1 + ' ' + r1 + ' 0 0 0 ' + x4 + ' ' + y4 + ' Z';
      }

      var sectorsHtml = trigrams.map(function (g) {
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

        var a1 = g.angle - half_span;
        var a2 = g.angle + half_span;
        var pathD = sectorPath(a1, a2, R_in, R_out);
        var rimD = sectorPath(a1 + 0.8, a2 - 0.8, R_in + 3, R_out - 3);

        var rad = degToRad(g.angle);
        var xm = (cx + R_mid * Math.cos(rad)).toFixed(1);
        var ym = (cy + R_mid * Math.sin(rad)).toFixed(1);

        var shiftX = (5 * Math.cos(rad)).toFixed(1);
        var shiftY = (5 * Math.sin(rad)).toFixed(1);

        var badgeX = (cx + (R_out - 16) * Math.cos(rad)).toFixed(1);
        var badgeY = (cy + (R_out - 16) * Math.sin(rad)).toFixed(1);

        var badgeSvg = '';
        if (unread > 0) {
          badgeSvg = '<g class="yz-sector-badge">' +
            '<circle cx="' + badgeX + '" cy="' + badgeY + '" r="9.5" class="yz-sector-badge-bg" />' +
            '<text x="' + badgeX + '" y="' + badgeY + '" class="yz-sector-badge-text">' + (unread > 99 ? '99+' : unread) + '</text>' +
          '</g>';
        }

        var sealSvg = isSealed ? (
          '<g class="yz-sector-seal">' +
            '<rect x="' + (Number(badgeX) - 15).toFixed(1) + '" y="' + (Number(badgeY) - 8).toFixed(1) + '" width="30" height="16" rx="4" class="yz-sector-seal-bg" />' +
            '<text x="' + badgeX + '" y="' + badgeY + '" class="yz-sector-seal-text">' + CORE.escapeHtml(tr('runtime.seal.glyph') || '封印') + '</text>' +
          '</g>'
        ) : '';

        return '<g class="yz-gua-card yz-gua-sector' + (isSealed ? ' yz-gua-sealed' : '') + (isNew ? ' yz-gua-new' : '') + '" data-view="' + g.id + '" role="button" tabindex="0" aria-label="' + CORE.escapeHtml(g.name + ' · ' + g.feat) + '" style="--gua-accent: ' + g.color + '; --shift-x: ' + shiftX + 'px; --shift-y: ' + shiftY + 'px;">' +
          '<path class="yz-sector-path" d="' + pathD + '" />' +
          '<path class="yz-sector-inner-rim" d="' + rimD + '" />' +
          '<text class="yz-sector-symbol" x="' + xm + '" y="' + (Number(ym) - 16).toFixed(1) + '">' + g.symbol + '</text>' +
          '<text class="yz-sector-name" x="' + xm + '" y="' + (Number(ym) + 2).toFixed(1) + '">' + CORE.escapeHtml(g.name) + '</text>' +
          '<text class="yz-sector-feature" x="' + xm + '" y="' + (Number(ym) + 18).toFixed(1) + '">' + CORE.escapeHtml(g.feat) + '</text>' +
          badgeSvg +
          sealSvg +
        '</g>';
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

          /* 八等分空心圆 SVG 扇面 */
          '<svg class="yz-bagua-annulus-svg" viewBox="0 0 440 440" width="440" height="440">' +
            '<circle cx="220" cy="220" r="218" fill="none" stroke="rgba(74, 222, 128, 0.12)" stroke-width="1" />' +
            '<circle cx="220" cy="220" r="73" fill="none" stroke="rgba(52, 211, 153, 0.2)" stroke-width="1" stroke-dasharray="3 3" />' +
            sectorsHtml +
          '</svg>' +

          /* 太极中枢 (中央空心处) */
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
      var cards = el.querySelectorAll('.yz-gua-card, .yz-gua-sector, [data-view]');
      cards.forEach(function (card) {
        function activate() {
          var viewId = card.getAttribute('data-view');
          if (viewId && navigation) navigation.navigate(viewId);
        }
        card.addEventListener('click', activate);
        card.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        });
      });

      var taiji = el.querySelector('#yz-taiji-core');
      if (taiji) {
        taiji.addEventListener('click', function () {
          if (navigation) navigation.navigate('sync');
        });
      }
    }
  };
