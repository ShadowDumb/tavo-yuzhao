  /* ---------- UI app / navigation ---------- */
  function createNavigation(ctx) {
    var state = ctx.state;
    var shell = ctx.shell;
    var runtime = ctx.runtime;

    function open(targetView) {
      state.open = true;
      if (targetView) {
        state.activeView = targetView;
        state.viewStack = ['wheel'];
      }
      shell.updateVisibility();
      shell.render();
    }

    function close() {
      state.open = false;
      state.modal = null;
      shell.updateVisibility();
    }

    function toggle() {
      if (state.open) close();
      else open();
    }

    function navigate(view, options) {
      options = options || {};
      if (state.activeView && state.activeView !== view && !options.replace) {
        state.viewStack.push(state.activeView);
      }
      state.activeView = view || 'wheel';
      state.activeTab = options.tab || '';
      state.searchQuery = '';
      state.selectedId = options.selectedId || null;
      state.selectedItem = options.selectedItem || null;
      state.modal = null;
      
      // 当进入某个具体卦位时，向 runtime 报告已查看该分区
      if (view && view !== 'wheel' && view !== 'sync' && view !== 'spaces' && runtime) {
        var current = runtime.current();
        var space = runtime.activeSpace();
        if (space && space.sync && Array.isArray(space.sync.appliedSeen)) {
          if (space.sync.appliedSeen.indexOf(view) < 0) {
            space.sync.appliedSeen.push(view);
          }
        }
      }

      shell.render();
    }

    function back() {
      if (state.modal) {
        state.modal = null;
        shell.render();
        return;
      }
      if (state.selectedId) {
        state.selectedId = null;
        state.selectedItem = null;
        shell.render();
        return;
      }
      if (state.viewStack.length > 0) {
        var prev = state.viewStack.pop();
        state.activeView = prev || 'wheel';
      } else {
        state.activeView = 'wheel';
      }
      state.searchQuery = '';
      state.selectedId = null;
      state.selectedItem = null;
      shell.render();
    }

    function setTab(tab) {
      state.activeTab = tab;
      shell.render();
    }

    function setSearch(query) {
      state.searchQuery = String(query || '').trim().toLowerCase();
      shell.render();
    }

    function selectItem(id, item) {
      state.selectedId = id;
      state.selectedItem = item || null;
      shell.render();
    }

    return {
      open: open,
      close: close,
      toggle: toggle,
      navigate: navigate,
      back: back,
      setTab: setTab,
      setSearch: setSearch,
      selectItem: selectItem
    };
  }
