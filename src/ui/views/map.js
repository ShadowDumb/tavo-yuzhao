  /* ---------- UI views / world map (Kun) ---------- */
  var VIEWS_MAP = {
    render: function (ctx) {
      var runtime = ctx.runtime;
      var state = ctx.state;
      var tr = ctx.tr || function (k) { return k; };
      var space = runtime ? runtime.activeSpace() : null;
      var mapData = (space && space.map) || { current: {}, tracks: [], places: [] };

      var currentLoc = mapData.current || {};
      var tracks = CORE.safeArray(mapData.tracks, 50);
      var places = CORE.safeArray(mapData.places, 50);

      var headerHtml = VIEWS_SHARED.renderHeader({
        title: tr('runtime.feature.map') || '天下舆图',
        subtitle: '坤卦 · 地 · 山川步履',
        icon: '☷'
      });

      var currentBannerHtml = '<div class="yz-card" style="border-top: 2px solid var(--yz-gua-kun); background: radial-gradient(circle at 80% 20%, rgba(251, 191, 36, 0.12), var(--yz-bg-card));">' +
        '<div style="font-size: 11px; color: var(--yz-text-muted); letter-spacing: 1px;">当前身处道界舆图</div>' +
        '<div style="font-family: var(--yz-font-serif); font-size: 22px; font-weight: 700; color: var(--yz-gold-accent); margin: 4px 0;">' +
          CORE.escapeHtml(currentLoc.name || '九洲·未明之地') +
          (currentLoc.region ? (' <span style="font-size: 13px; font-weight: normal; color: var(--yz-text-secondary);">(' + CORE.escapeHtml(currentLoc.region) + ')</span>') : '') +
        '</div>' +
        '<div style="font-size: 13px; color: var(--yz-text-secondary); line-height: 1.6;">' +
          CORE.escapeHtml(currentLoc.desc || '天地玄黄，灵气弥漫，静心感知四方动静。') +
        '</div>' +
      '</div>';

      var tracksHtml = tracks.length === 0
        ? '<div style="font-size: 12px; color: var(--yz-text-muted); padding: 12px 0;">暂无近期行踪步履记录</div>'
        : '<div style="display: flex; flex-direction: column; gap: 8px; border-left: 2px solid var(--yz-border-jade); padding-left: 12px; margin-left: 6px;">' +
            tracks.map(function (t) {
              return '<div style="position: relative;">' +
                '<div style="position: absolute; left: -18px; top: 4px; width: 8px; height: 8px; border-radius: 50%; background: var(--yz-jade-light); box-shadow: 0 0 6px var(--yz-jade-light);"></div>' +
                '<div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--yz-text-muted);">' +
                  '<span style="font-weight: 600; color: var(--yz-jade-light);">' + CORE.escapeHtml(t.location || t.place || '') + '</span>' +
                  '<span>' + CORE.escapeHtml(t.time || '') + '</span>' +
                '</div>' +
                '<div style="font-size: 13px; color: var(--yz-text-primary); margin-top: 2px;">' + CORE.escapeHtml(t.action || t.event || '') + '</div>' +
              '</div>';
            }).join('') +
          '</div>';

      var placesHtml = places.length === 0
        ? '<div style="font-size: 12px; color: var(--yz-text-muted); padding: 12px 0;">暂无名山福地名录</div>'
        : '<div class="yz-card-grid">' +
            places.map(function (p) {
              return '<div class="yz-card">' +
                '<div class="yz-card-header">' +
                  '<span class="yz-card-title">' + CORE.escapeHtml(p.name) + '</span>' +
                  '<span style="font-size: 11px; color: var(--yz-text-muted);">' + CORE.escapeHtml(p.region || '') + '</span>' +
                '</div>' +
                '<div class="yz-card-body">' + CORE.escapeHtml(p.desc || '') + '</div>' +
              '</div>';
            }).join('') +
          '</div>';

      return '<div class="yz-subview">' +
        headerHtml +
        currentBannerHtml +
        '<div class="yz-card">' +
          '<div class="yz-card-title" style="font-size: 15px; margin-bottom: 8px;">近期云游行踪</div>' +
          tracksHtml +
        '</div>' +
        '<div class="yz-card">' +
          '<div class="yz-card-title" style="font-size: 15px; margin-bottom: 8px;">天下名山福地名录 (' + places.length + ')</div>' +
          placesHtml +
        '</div>' +
      '</div>';
    },

    bindEvents: function (el, ctx) {}
  };
