  /* ---------- UI app / entry ---------- */
  function containsEnvelope(value) {
    return /<yz_[a-z0-9_]+\b/i.test(String(value == null ? '' : value));
  }

  function pickEnvelopePayload(event) {
    event = event || {};
    var text = String(event.text == null ? '' : event.text);
    var content = String(event.content == null ? '' : event.content);
    if (containsEnvelope(text)) return text;
    if (containsEnvelope(content)) return content;
    return text || content;
  }

  function stripEventFields(event) {
    if (!event || typeof event !== 'object') return event;
    ['text', 'content'].forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(event, key) || event[key] == null) return;
      var raw = String(event[key]);
      var visible = PROTOCOL.stripBlocks(raw);
      event[key] = visible;
    });
    return event;
  }

  var APP = {
    pickEnvelopePayload: pickEnvelopePayload,
    stripEventFields: stripEventFields,
    containsEnvelope: containsEnvelope,

    create: function (options) {
      options = options || {};
      var localWindow = options.window || (typeof window !== 'undefined' ? window : globalThis);
      var localDocument = options.document || (typeof document !== 'undefined' ? document : null);
      var tavoApi = options.tavo || (typeof tavo !== 'undefined' ? tavo : {});

      var hostWindow = localWindow;
      var hostDocument = localDocument;
      try {
        if (localWindow && localWindow.top && localWindow.top.document) {
          hostWindow = localWindow.top;
          hostDocument = localWindow.document || localWindow.top.document;
        }
      } catch (_) {}

      var getFlags = function () {
        var config = tavoApi && tavoApi.plugin && tavoApi.plugin.config;
        return {
          enabled: config && typeof config.get === 'function' ? config.get('enabled') !== false : true,
          auto_strip: config && typeof config.get === 'function' ? config.get('auto_strip') !== false : true,
          lang: (config && typeof config.get === 'function' && config.get('lang')) || 'zh'
        };
      };

      var tr = makeTranslator(tavoApi);
      I18N.setTranslator(tr);

      var local = hostWindow && hostWindow.localStorage ? hostWindow.localStorage : null;
      var runtime = RUNTIME.createRuntime(tavoApi, local, getFlags, { window: hostWindow });
      var state = createUiState();

      var ctx = {
        window: hostWindow,
        document: hostDocument,
        tavo: tavoApi,
        state: state,
        runtime: runtime,
        tr: tr,
        getFlags: getFlags
      };

      var dialogs = createDialogs(ctx);
      ctx.dialogs = dialogs;

      // shell 与 navigation 互相引用：shell 通过 ctx.navigation 惰性访问导航；
      // 因此按 dialogs → shell → navigation → dataActions → forms → fab 顺序创建，
      // 保证每个模块在构建期捕获到的依赖都已就绪。
      var shell = createShell(ctx);
      ctx.shell = shell;

      var navigation = createNavigation(ctx);
      ctx.navigation = navigation;

      var dataActions = createDataActions(ctx);
      ctx.dataActions = dataActions;

      var forms = createForms(ctx);
      ctx.forms = forms;

      var fab = createFab(ctx);
      ctx.fab = fab;

      var domStrip = createDomStrip(ctx);
      ctx.domStrip = domStrip;
      domStrip.start();

      var hooks = createHooks(ctx);
      ctx.hooks = hooks;

      // 国际化语言切换订阅
      try {
        var i18nApi = tavoApi && tavoApi.plugin && tavoApi.plugin.i18n;
        if (i18nApi && typeof i18nApi.onChange === 'function') {
          i18nApi.onChange(function () {
            I18N.invalidate();
            if (shell) shell.render();
          });
        }
      } catch (_) {}

      // 启动探测当前聊天
      async function start() {
        try {
          var startChat = tavoApi.chat && typeof tavoApi.chat.current === 'function' ? await Promise.resolve(tavoApi.chat.current()) : null;
          if (startChat && startChat.id != null && CORE.hasText(startChat.id)) {
            state.chatActive = true;
            await runtime.switchChat(startChat.id);
            if (hooks && typeof hooks.updateBadges === 'function') hooks.updateBadges();
          }
        } catch (_) {}
        if (shell) {
          shell.updateVisibility();
          shell.render();
        }
      }
      start();

      var app = {
        state: state,
        runtime: runtime,
        navigation: navigation,
        shell: shell,
        fab: fab,
        dialogs: dialogs,
        forms: forms,
        dataActions: dataActions,
        domStrip: domStrip,
        hooks: function () { return hooks; },
        dispose: function () {
          if (domStrip) domStrip.stop();
          if (runtime) runtime.dispose();
        }
      };

      return app;
    }
  };
