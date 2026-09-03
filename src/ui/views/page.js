  /* ---------- UI views / page dispatch ---------- */
  var PAGE = {
    getView: function (name) {
      switch (name) {
        case 'tablet': return VIEWS_TABLET;
        case 'msg': return VIEWS_MESSAGES;
        case 'notes': return VIEWS_NOTES;
        case 'market': return VIEWS_MARKET;
        case 'forum': return VIEWS_FORUM;
        case 'space': return VIEWS_SPACE;
        case 'map': return VIEWS_MAP;
        case 'manage':
        case 'spaces': return VIEWS_MANAGE;
        case 'sync': return VIEWS_SYNC;
        case 'wheel':
        default:
          return VIEWS_WHEEL;
      }
    },

    render: function (ctx) {
      var viewName = (ctx.state && ctx.state.activeView) || 'wheel';
      var view = PAGE.getView(viewName);
      if (view && typeof view.render === 'function') {
        return view.render(ctx);
      }
      return VIEWS_WHEEL.render(ctx);
    },

    bindEvents: function (el, ctx) {
      var viewName = (ctx.state && ctx.state.activeView) || 'wheel';
      var view = PAGE.getView(viewName);
      if (view && typeof view.bindEvents === 'function') {
        view.bindEvents(el, ctx);
      }
    }
  };
