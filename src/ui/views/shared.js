  var FEATURES = [
    { id: 'tablet', glyph: '☰', tone: 'gold', pos: [50, 5], toggleable: true },
    { id: 'msg', glyph: '☱', tone: 'silver', pos: [17, 20], toggleable: true },
    { id: 'notes', glyph: '☲', tone: 'vermilion', pos: [4, 50], toggleable: true },
    { id: 'market', glyph: '☳', tone: 'jade', pos: [17, 80], toggleable: true },
    { id: 'forum', glyph: '☴', tone: 'green', pos: [83, 20], toggleable: true },
    { id: 'space', glyph: '☵', tone: 'azure', pos: [96, 50], toggleable: true },
    { id: 'manage', glyph: '☶', tone: 'rock', pos: [83, 80] },
    { id: 'map', glyph: '☷', tone: 'ocre', pos: [50, 95], toggleable: true }
  ];

  // 悬浮玉佩图标：玉璧形（渐变玉质 + 刻纹环 + 璧孔 + 高光），FAB 与管理页复位行共用。
  var FAB_ICON = '<svg viewBox="0 0 44 44" aria-hidden="true"><defs><radialGradient id="yzJadeFace" cx="34%" cy="28%" r="85%"><stop offset="0%" stop-color="#d6ffe9"/><stop offset="42%" stop-color="#57c49a"/><stop offset="78%" stop-color="#17805d"/><stop offset="100%" stop-color="#0b4632"/></radialGradient></defs><circle cx="22" cy="22" r="20.4" fill="url(#yzJadeFace)" stroke="rgba(215,255,238,.6)" stroke-width="1.4"/><circle cx="22" cy="22" r="14" fill="none" stroke="rgba(238,255,247,.32)" stroke-width=".9" stroke-dasharray="3.2 2.8"/><circle cx="22" cy="22" r="8.2" fill="#06231a" stroke="rgba(190,255,225,.55)" stroke-width="1.3"/><circle cx="14.5" cy="12" r="4.2" fill="rgba(255,255,255,.22)"/></svg>';

  function grouped(tablet, id) {
    var found = null;
    CORE.safeArray(tablet && tablet.groups, 10).forEach(function (g) { if (g.id === id) found = g; });
    return found || null;
  }

  function fieldValue(tablet, groupId, canonicalKey) {
    var group = grouped(tablet, groupId);
    var rows = CORE.safeArray(group && group.fields, 30);
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      if (CORE.keyId(row.key) === canonicalKey) return row.value;
    }
    return '';
  }

  function groupName(id) {
    var t = I18N.dict();
    return t.groups[id] || id;
  }

  // 字段键显示层本地化：键先按 CANONICAL 别名归一到 canonical id，再查显示字典；
  // 未知键（模型自定义字段）回退原文，绝不显示半生不熟的英文键。
  // 字段键显示层本地化：键先按 CANONICAL 别名归一到 canonical id，再查显示字典；
  // 未知键（模型自定义字段）做人性化清洗（下划线/驼峰拆词、首字母大写），
  // 绝不显示半生不熟的裸英文键（如 luck/sect 直接上屏）。
  function humanizeKey(key) {
    var s = String(key == null ? '' : key).trim();
    if (!s) return s;
    return s
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function contextualLabel(label, name) {
    return String(label || '') + (CORE.hasText(name) ? (/^[A-Za-z]/.test(String(label || '')) ? ': ' : '：') + String(name) : '');
  }
  function fieldName(key) {
    var t = I18N.dict();
    var id = keyId(key);
    return (id && t.fields[id]) || humanizeKey(key);
  }

  function forumSectionKey(value) {
    var raw = String(value == null ? '' : value).trim();
    var aliases = {
      general: 'general', cultivation: 'cultivation', artifact: 'artifact', bounty: 'bounty', market: 'market',
      '闲聊': 'general', '修炼心得': 'cultivation', '法器交流': 'artifact', '悬赏委托': 'bounty', '坊市见闻': 'market',
      'General chat': 'general', 'Cultivation insights': 'cultivation', 'Artifact exchange': 'artifact',
      Bounties: 'bounty', 'Market tales': 'market'
    };
    return aliases[raw] || raw;
  }

  function forumSectionLabel(value) {
    var t = I18N.dict();
    var labels = {
      general: t.playerSectionGeneral,
      cultivation: t.playerSectionCultivation,
      artifact: t.playerSectionArtifact,
      bounty: t.playerSectionBounty,
      market: t.playerSectionMarket
    };
    var key = forumSectionKey(value);
    return labels[key] || String(value == null ? '' : value);
  }

  function orderStatusKey(value) {
    var raw = String(value == null ? '' : value).trim();
    var aliases = {
      pending: 'pending', open: 'open', completed: 'completed', cancelled: 'cancelled',
      '待处理': 'pending', '进行中': 'open', '已完成': 'completed', '已成交': 'completed', '已取消': 'cancelled'
    };
    return aliases[raw.toLowerCase()] || aliases[raw] || raw;
  }

  function orderStatusLabel(value) {
    var t = I18N.dict();
    var labels = {
      pending: t.orderStatusPending,
      open: t.orderStatusOpen,
      completed: t.orderStatusCompleted,
      cancelled: t.orderStatusCancelled
    };
    var key = orderStatusKey(value);
    return labels[key] || humanizeKey(value);
  }

  function syncStatusOf(state) {
    var sync = (state && state.sync) || {};
    var t = I18N.dict();
    var text = t.status[sync.status] || t.status.empty;
    if (sync.lastError === 'parse-error' && state.revision) text = t.status.partial;
    return { status: sync.status || 'empty', text: text };
  }

  function snapshotUsage(state) {
    var bytes = 0;
    try { bytes = JSON.stringify(state || {}).length; } catch (_) { bytes = MAX_SNAPSHOT_BYTES; }
    return { bytes: bytes, limit: MAX_SNAPSHOT_BYTES, percent: Math.min(100, (bytes / MAX_SNAPSHOT_BYTES) * 100) };
  }

  function unreadTotal(state) {
    var chats = CORE.safeObject(state && state.chats);
    var sum = 0;
    CORE.safeArray(chats.contacts, 10).forEach(function (c) { sum += Number(c && c.unread) || 0; });
    CORE.safeArray(chats.groups, 6).forEach(function (g) { sum += Number(g && g.unread) || 0; });
    return sum;
  }

  // 卦位三态徽标，互斥优先级：警示 > 未读 > 新；封印态不显示任何徽标。
  function nodeBadge(feature, disabled, state) {
    if (!!feature.toggleable && disabled[feature.id] === false) return null;
    var sync = (state && state.sync) || {};
    var issues = CORE.safeArray(sync.issues, 20);
    for (var i = 0; i < issues.length; i += 1) {
      if (String((issues[i] && issues[i].path) || '').indexOf(feature.id + '.') === 0) return { kind: 'alert' };
    }
    if (feature.id === 'msg') {
      var total = unreadTotal(state);
      if (total > 0) return { kind: 'unread', label: total > 99 ? '99+' : String(total) };
    }
    var seen = CORE.safeArray(sync.appliedSeen, 20);
    if (CORE.safeArray(sync.applied, 10).indexOf(feature.id) >= 0 && seen.indexOf(feature.id) < 0) return { kind: 'new' };
    return null;
  }

  function renderNodes(disabled, state) {
    var t = I18N.dict();
    disabled = disabled || {};
    return FEATURES.map(function (feature) {
      var name = t.features[feature.id];
      var off = !!feature.toggleable && disabled[feature.id] === false;
      var cls = 'yz-node t-' + feature.tone + (off ? ' sealed' : '');
      var badge = off ? null : nodeBadge(feature, disabled, state);
      var badgeHtml = '';
      // 标点随语言（zh '，' / en ', '），避免 en 界面泄漏中文标点。
      var sep = tr('runtime.sep.badge');
       var aria = off ? name + sep + t.manage.off : name;
      if (badge) {
        cls += ' b-' + badge.kind;
        if (badge.kind === 'alert') { badgeHtml = '<i class="yz-badge yz-badge-alert">!</i>'; aria = name + sep + t.badge.alert; }
        else if (badge.kind === 'unread') { badgeHtml = '<i class="yz-badge yz-badge-unread">' + CORE.escapeHtml(badge.label) + '</i>'; aria = name + sep + tr('runtime.badge.unread', { n: badge.label }); }
        else {
          badgeHtml = '<i class="yz-badge yz-badge-new">' + CORE.escapeHtml(t.badge.new) + '</i>';
          aria = name + sep + t.badge.new;
        }
      }
      var seal = off ? '<i class="yz-seal">' + CORE.escapeHtml(t.sealGlyph) + '</i>' : '';
      return '<button type="button" class="' + cls + '" data-action="open-feature" data-feature="' + feature.id + '" style="left:' + feature.pos[0] + '%;top:' + feature.pos[1] + '%" aria-label="' + CORE.escapeHtml(aria) + '"' + (off ? ' aria-disabled="true"' : '') + ' title="' + CORE.escapeHtml(name) + ' (' + CORE.escapeHtml(t.gua[feature.id] || '') + ')"><span class="yz-glyph">' + feature.glyph + '</span><b>' + CORE.escapeHtml(name) + '</b><em>' + CORE.escapeHtml(t.gua[feature.id] || '') + '</em>' + seal + badgeHtml + '</button>';
    }).join('');
  }

  // 主界面：卦盘徽标与统计都取「当前空间」的数据；hero 展示空间名与最近一轮摘要。
  function renderHome(state, flags, ui) {
    var t = I18N.dict();
    ui = ui || {};
    var space = ui.space || (state && state.spaces ? (CORE.defaultSpaceState(state) || state.spaces[0]) : state) || {};
    var spaceName = ui.spaceName || CORE.spaceDisplayName(state, space, t.appName);
    var sync = space.sync || {};
    var st = syncStatusOf(space);
    // 直接传入旧式单空间视图时没有 isDefault 字段，按默认空间处理；
    // 只有明确的自定义空间才隐藏角色同步诊断入口。
    var isDefault = space.isDefault !== false;
    var isEmpty = isDefault && (sync.status === 'empty' || !CORE.safeArray(space.processedTurns, 1).length);
    var heroText = sync.summary || (isEmpty ? t.homeEmpty : (isDefault ? t.awaitingSync : t.spaceLocalHint));
    var hero = '<div class="yz-hero-line"><b>' + CORE.escapeHtml(spaceName) + '</b><p>' + CORE.escapeHtml(heroText) + '</p></div>';
    var footer = isDefault
      ? '<button type="button" class="yz-sync ' + CORE.escapeHtml(st.status) + '" data-action="sync-detail" data-sync><i></i><span>' + CORE.escapeHtml(st.text) + '</span></button>'
      : '<div class="yz-sync yz-sync-static ' + CORE.escapeHtml(st.status) + '" data-sync><i></i><span>' + CORE.escapeHtml(st.text) + '</span></div>';
    return '<div class="yz-home" data-home>' +
      '<div class="yz-disc">' +
      '<div class="yz-ring"></div>' +
      renderNodes(flags, space) +
      '<div class="yz-scroll-ring"></div>' +
      '<button type="button" class="yz-core" data-action="core" aria-label="' + CORE.escapeHtml(t.coreAria) + '"><span class="yz-taiji">☯</span></button>' +
      '</div>' +
      hero +
      footer +
      '</div>';
  }

  // 检索关键词：去空白、统一小写，匹配两端同规一化（中文不受影响）。
  function searchKw(search) {
    return String(search == null ? '' : search).trim().toLowerCase();
  }

  function contains(keyword, value) {
    if (!keyword) return true;
    return String(value == null ? '' : value).toLowerCase().indexOf(keyword) >= 0;
  }

  // 任一字段命中即匹配；keyword 为空时恒匹配。
  function filterMatch(keyword, values) {
    for (var i = 0; i < values.length; i += 1) if (contains(keyword, values[i])) return true;
    return false;
  }

  // 列表页顶部检索框：纯前端过滤，不改动数据。value 非空时渲染清除按钮。
  function searchBox(value) {
    var t = I18N.dict();
    return '<div class="yz-search"><input type="search" data-search-input value="' + CORE.escapeHtml(value || '') +
      '" placeholder="' + CORE.escapeHtml(t.searchPlaceholder) + '" aria-label="' + CORE.escapeHtml(t.searchPlaceholder) + '">' +
      '<button type="button" class="yz-search-clear' + (value ? '' : ' hidden') + '" data-action="clear-search" aria-label="' + CORE.escapeHtml(t.searchClear) + '">×</button></div>';
  }

  // 空列表/少条目不渲染检索框（纯占位）：只有有数据（或正在检索）时才值得展示搜索入口。
  function searchBoxIf(hasItems, search) {
    return hasItems || searchKw(search) ? searchBox(search) : '';
  }
