  function renderMap(state, search, tag) {
    var t = I18N.dict();
    var map = CORE.safeObject(state.map);
    var kw = searchKw(search);
    var cur = CORE.safeObject(map.current);
    var tracks = CORE.safeArray(map.tracks, 20).filter(function (track) {
      return filterMatch(kw, [track.place, track.action, track.time]);
    });
    var places = CORE.safeArray(map.places, 20).filter(function (place) {
      return filterMatch(kw, [place.name, place.domain, place.desc]);
    });
    var hero = '';
    if (CORE.hasText(cur.place)) {
      hero = '<div class="yz-map-current"><h3>' + CORE.escapeHtml(t.mapTitles.current) + '</h3>' +
        '<div class="yz-hero"><span class="yz-map-pin">◈</span><div><b>' + CORE.escapeHtml(cur.place) + '</b>' + (CORE.hasText(cur.domain) ? '<small>' + CORE.escapeHtml(cur.domain) + '</small>' : '') + '</div></div>' +
        (CORE.hasText(cur.desc) ? '<p class="yz-map-desc">' + CORE.escapeHtml(cur.desc) + '</p>' : '') + '</div>';
    }
    // 行踪按时间逆序（最新在上，紧贴当前所在地）：数据按追加顺序存（旧→新），倒排展示。
    var timeline = tracks.length ? '<div class="yz-map-tracks"><h3>' + CORE.escapeHtml(t.mapTitles.tracks) + '</h3><div class="yz-timeline">' +
      tracks.slice().reverse().map(function (track) {
         var trackDel = ' <button type="button" class="yz-map-delete" data-action="delete-track" data-id="' + CORE.escapeHtml(String(track.id)) + '" aria-label="' + CORE.escapeHtml(t.deleteTrack) + '">×</button>';
        return '<div class="yz-track" style="display:flex;align-items:center;gap:8px"><time>' + CORE.escapeHtml(track.time || '') + '</time><div><b>' + CORE.escapeHtml(track.place) + '</b>' + (CORE.hasText(track.action) ? '<p>' + CORE.escapeHtml(track.action) + '</p>' : '') + '</div>' + trackDel + '</div>';
      }).join('') + '</div></div>' : '';
    var roster = places.length ? '<div class="yz-map-places"><h3>' + CORE.escapeHtml(t.mapTitles.places) + '</h3><div class="yz-page-list">' +
      places.map(function (place) {
         var placeDel = ' <button type="button" class="yz-map-delete" data-action="delete-place" data-id="' + CORE.escapeHtml(String(place.id)) + '" aria-label="' + CORE.escapeHtml(t.deletePlace) + '">×</button>';
        return '<div class="yz-row yz-static" style="display:flex;align-items:center;gap:8px"><span class="yz-map-pin">◈</span><span class="yz-row-copy"><b>' + CORE.escapeHtml(place.name) + '</b>' +
          (CORE.hasText(place.domain) ? '<i>' + CORE.escapeHtml(place.domain) + '</i>' : '') +
          (CORE.hasText(place.desc) ? '<em>' + CORE.escapeHtml(place.desc) + '</em>' : '') + '</span>' + placeDel + '</div>';
      }).join('') + '</div></div>' : '';
    // 整页空态只出一处：全空（无当前地点/行踪/地点）时渲染总体空态；hero 不再单独判空，
    // 避免空态文案重复出现。玩家域（无写入途径）用专属文案，避免与角色域「暂无行踪」混淆。
    var empty = '';
    var hasData = CORE.hasText(cur.place) || CORE.safeArray(map.tracks, 20).length || CORE.safeArray(map.places, 20).length;
    if (kw) {
      var curMatch = filterMatch(kw, [cur.place, cur.domain, cur.desc]);
      if (!curMatch && !tracks.length && !places.length) empty = '<div class="yz-empty">' + CORE.escapeHtml(t.searchNoMatch) + '</div>';
    } else if (!hasData) {
      empty = '<div class="yz-empty">' + CORE.escapeHtml(t.guards.tracks) + '</div>';
    }
    return '<main class="yz-page-inner" data-marker="map">' + yzHeader(t.features.map, false, tag) + searchBoxIf(hasData, search) + hero + timeline + roster + empty + '</main>';
  }

