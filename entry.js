/* Yu Zhao — 修仙传讯法器，协议驱动，八大功能：玉牌/讯息/玉册/论坛/坊市/芥子空间/舆图/管理，i18n 走 tavo.plugin.i18n */
/* Generated file. Edit src/ and run node scripts/build.mjs. */
(function () {
  'use strict';

  /* ---------- Hook bridge ---------- */
  /* smoke-bootstrap */
  /* 说明：UI 层（src/ui、ui/jade.html）已整体移除待重建。此处只保留共享桥骨架，
     供重建后的 UI 通过 shared.attachUI 挂载；generation/message/chat 的 Hook 注册与
     输入/侧边栏动作随 UI 一起回归（删除前由 entry.js 经 callUi 转发到 UI 实例，
     无 UI 时静默超时会拖慢每一轮生成，故先不注册）。 */
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
})();
