  /* smoke-bootstrap */
  var host = typeof window !== 'undefined' ? window : globalThis;
  var shared = host.__YU_ZHAO__;
  if (!shared || shared.__bridgeVersion !== 1) {
    var uiResolve = null;
    shared = {
      __bridgeVersion: 1,
      ready: false,
      ui: null,
      uiReady: new Promise(function (resolve) { uiResolve = resolve; }),
      attachUI: function (app) {
        if (shared.ui && shared.ui !== app && typeof shared.ui.dispose === 'function') {
          try { shared.ui.dispose(); } catch (_) {}
        }
        shared.ui = app;
        shared.ready = true;
        if (uiResolve) uiResolve(app);
      }
    };
    host.__YU_ZHAO__ = shared;
  }

  function callUi(name, event) {
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(event); }, 4000); });
    return Promise.race([
      shared.uiReady.then(function () {
        var app = shared.ui;
        var hooks = app && typeof app.hooks === 'function' ? app.hooks() : {};
        var fn = hooks && hooks[name];
        return typeof fn === 'function' ? fn(event) : event;
      }),
      timeout
    ]).catch(function (error) {
      try { console.warn('[Yu Zhao] UI handler failed: ' + name, error); } catch (_) {}
      return event;
    });
  }

  var plugin = tavo.plugin;
  if (plugin) {
    if (typeof plugin.onInputAction === 'function') plugin.onInputAction('open-jade', function () { return callUi('open'); });
    if (typeof plugin.onSidebarAction === 'function') {
      plugin.onSidebarAction('open-jade', function () { return callUi('open'); });
      plugin.onSidebarAction('resync-history', function () { return callUi('resyncHistory'); });
      plugin.onSidebarAction('clear-data', function () { return callUi('clearData'); });
    }
    if (typeof plugin.on === 'function') {
      plugin.on('chat:opened', function (event) { return callUi('chatOpened', event); });
      plugin.on('chat:updated', function (event) { return callUi('chatUpdated', event); });
      plugin.on('chat:closed', function (event) { return callUi('chatClosed', event); });
      plugin.on('generation:prepare', function (event) { return callUi('generationPrepare', event); });
      plugin.on('generation:success', function (event) { return callUi('generationSuccess', event); });
      plugin.on('message:added', function (event) { return callUi('messageAdded', event); });
      plugin.on('message:updated', function (event) { return callUi('messageUpdated', event); });
      plugin.on('message:deleted', function (event) { return callUi('messageDeleted', event); });
      plugin.on('generation:error', function (event) { return callUi('generationError', event); });
      plugin.on('generation:cancelled', function (event) { return callUi('generationCancelled', event); });
    }
  }
