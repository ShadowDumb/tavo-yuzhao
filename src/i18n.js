  var TRANSLATE = null;

  function fillParams(text, params) {
    return String(text == null ? '' : text).replace(/\{(\w+)\}/g, function (match, key) {
      return params && params[key] != null ? String(params[key]) : match;
    });
  }

  function tr(key, params) {
    if (TRANSLATE) {
      var out;
      try { out = TRANSLATE(key, params); } catch (_) { out = key; }
      return typeof out === 'string' ? out : String(out);
    }
    return fillParams(key, params);
  }

  var dictCache = null;

  function buildDict() {
    return {
      appName: tr('runtime.appName'),
      avaFallback: tr('runtime.avaFallback'),
      brand: { title: tr('runtime.brand.title'), sub: tr('runtime.brand.sub') },
      closePhone: tr('runtime.closePhone'),
      back: tr('runtime.back'),
      cancel: tr('runtime.cancel'),
      unseal: tr('runtime.unseal'),
      awaitingSync: tr('runtime.awaitingSync'),
      homeEmpty: tr('runtime.home.empty'),
      emptyTablet: tr('runtime.emptyTablet'),
      tabletPartial: tr('runtime.tablet.partial'),
      tabletPendingGroup: tr('runtime.tablet.pendingGroup'),
      stripFallback: tr('runtime.stripFallback'),
      fabLabel: tr('runtime.fab.label'),
      sealGlyph: tr('runtime.seal.glyph'),
      status: { complete: tr('runtime.sync.complete'), partial: tr('runtime.sync.partial'), invalid: tr('runtime.sync.invalid'), empty: tr('runtime.sync.empty') },
      toast: {
        parseError: tr('runtime.toast.parseError'),
        generationError: tr('runtime.toast.generationError'),
        cancelled: tr('runtime.toast.cancelled'),
        sealed: tr('runtime.toast.sealed'),
        sealedMsg: tr('runtime.toast.sealedMsg'),
        sealedForum: tr('runtime.toast.sealedForum'),
        fabReset: tr('runtime.toast.fabReset'),
        oversized: tr('runtime.toast.oversized'),
        rebuilt: tr('runtime.toast.rebuilt'),
        noSnapshot: tr('runtime.toast.noSnapshot'),
        disabled: tr('runtime.toast.disabled'),
        noChat: tr('runtime.toast.noChat'),
        restoreFailed: tr('runtime.toast.restoreFailed'),
        restoreBusy: tr('runtime.toast.restoreBusy'),
        stale: tr('runtime.toast.stale'),
        persistenceFailed: tr('runtime.toast.persistenceFailed'),
         snapshotCorrupted: tr('runtime.toast.snapshotCorrupted'),
         storageCorrupted: tr('runtime.toast.storageCorrupted'),
         syncConflict: tr('runtime.toast.syncConflict'),
        clearTitle: tr('runtime.toast.clearTitle'),
        clearConfirm: tr('runtime.toast.clearConfirm'),
        clearConfirmAction: tr('runtime.toast.clearConfirmAction'),
        cleared: tr('runtime.toast.cleared'),
        exported: tr('runtime.manage.exportDone'),
        exportFailed: tr('runtime.manage.exportFailed')
      },
      badge: { new: tr('runtime.badge.new'), alert: tr('runtime.badge.alert') },
      coreAria: tr('runtime.core.aria'),
      diag: {
        title: tr('runtime.diag.title'),
        statusLabel: tr('runtime.diag.status'),
        summary: tr('runtime.diag.summary'),
        turn: tr('runtime.diag.turn'),
        source: tr('runtime.diag.source'),
        applied: tr('runtime.diag.applied'),
        none: tr('runtime.diag.none'),
        issuesLabel: tr('runtime.diag.issues'),
        noIssues: tr('runtime.diag.noIssues'),
        lastError: tr('runtime.diag.lastError'),
        updated: tr('runtime.diag.updated'),
        storage: tr('runtime.diag.storage'),
        turns: tr('runtime.diag.turns'),
        chatId: tr('runtime.diag.chatId'),
        tech: tr('runtime.diag.tech'),
        err: {
          'parse-error': tr('runtime.diag.err.parse-error'),
          'oversized-payload': tr('runtime.diag.err.oversized-payload')
        },
        action: { partial: tr('runtime.diag.action.partial'), invalid: tr('runtime.diag.action.invalid') }
      },
      issues: {
        'tablet.basic': tr('assess.issue.tablet.basic'),
        'tablet.look': tr('assess.issue.tablet.look'),
        'tablet.cult': tr('assess.issue.tablet.cult'),
        'tablet.gong': tr('assess.issue.tablet.gong'),
        'tablet.bond': tr('assess.issue.tablet.bond'),
        'tablet.secret': tr('assess.issue.tablet.secret'),
        'msg.contacts': tr('assess.issue.msg.contacts'),
        'msg.groups': tr('assess.issue.msg.groups'),
        'notes.folders': tr('assess.issue.notes.folders'),
        'notes.notes': tr('assess.issue.notes.notes'),
        'forum.posts': tr('assess.issue.forum.posts'),
        'forum.rows': tr('assess.issue.forum.rows'),
        'market.rows': tr('assess.issue.market.rows'),
        'space.rows': tr('assess.issue.space.rows'),
        'map.rows': tr('assess.issue.map.rows'),
         'payload.oversized': tr('assess.issue.payload.oversized'),
         'diff.unknown': tr('assess.issue.diff.unknown'),
         'diff.hidden': tr('assess.issue.diff.hidden'),
         'space.unknown': tr('assess.issue.space.unknown'),
         'space.denied': tr('assess.issue.space.denied'),
         'space.full': tr('assess.issue.space.full'),
         'forum.comments.full': tr('assess.issue.forum.comments.full')
      },
      guards: {
        contacts: tr('runtime.guard.contacts'), groups: tr('runtime.guard.groups'), chat: tr('runtime.guard.chat'), gchat: tr('runtime.guard.gchat'), chatArchived: tr('runtime.guard.chatArchived'),
        folders: tr('runtime.guard.folders'), notes: tr('runtime.guard.notes'), note: tr('runtime.guard.note'),
        posts: tr('runtime.guard.posts'), post: tr('runtime.guard.post'),         listings: tr('runtime.guard.listings'),
        auctions: tr('runtime.guard.auctions'), orders: tr('runtime.guard.orders'), requests: tr('runtime.guard.requests'), currencies: tr('runtime.guard.currencies'),
        items: tr('runtime.guard.items'), tracks: tr('runtime.guard.tracks')
      },
      searchPlaceholder: tr('runtime.search.placeholder'),
      searchClear: tr('runtime.search.clear'),
      searchNoMatch: tr('runtime.search.noMatch'),
      // ---------- 用户空间文案 ----------
      space: {
        meSpaceName: tr('space.meSpaceName'),
        untitled: tr('space.untitled')
      },
      spaceShort: tr('runtime.space.short'),
      spaceSwitchAria: tr('runtime.space.switchAria'),
      spaceDefaultName: tr('runtime.space.defaultName'),
      spaceLocalHint: tr('runtime.space.localHint'),
      spaceManageTitle: tr('runtime.space.manageTitle'),
      spaceManageSub: tr('runtime.space.manageSub'),
      spaceManageInfo: tr('runtime.space.manageInfo'),
      spaceTagDefault: tr('runtime.space.tagDefault'),
      spaceTagSend: tr('runtime.space.tagSend'),
      spaceTagWrite: tr('runtime.space.tagWrite'),
      spaceCurrent: tr('runtime.space.current'),
      spaceEnter: tr('runtime.space.enter'),
      spaceSendToggle: tr('runtime.space.sendToggle'),
      spaceWriteToggle: tr('runtime.space.writeToggle'),
      spaceRenameLabel: tr('runtime.space.renameLabel'),
      spaceRenameBtn: tr('runtime.space.renameBtn'),
      spaceDelete: tr('runtime.space.delete'),
      spaceDeleteDefault: tr('runtime.space.deleteDefault'),
       spaceDeleteConfirm: tr('runtime.space.deleteConfirm'),
       spaceDeleteDefaultConfirm: tr('runtime.space.deleteDefaultConfirm'),
      spaceDeleted: tr('runtime.space.deleted'),
      spaceNewPlaceholder: tr('runtime.space.newPlaceholder'),
      spaceCreateBtn: tr('runtime.space.createBtn'),
      spaceCreated: tr('runtime.space.created'),
      spaceRenamed: tr('runtime.space.renamed'),
      spaceNameRequired: tr('runtime.space.nameRequired'),
      spaceNameClash: tr('runtime.space.nameClash'),
      spaceLimitReached: tr('runtime.space.limitReached'),
      spaceDefaultWrite: tr('runtime.space.defaultWrite'),
      spaceDefaultNameLocked: tr('runtime.space.defaultNameLocked'),
      spaceMissingEntity: tr('runtime.space.missingEntity'),
      spaceEntityFull: tr('runtime.space.entityFull'),
      addContact: tr('runtime.space.addContact'),
      contactFieldName: tr('runtime.space.contactName'),
      contactFieldRelation: tr('runtime.space.contactRelation'),
      msgPlaceholder: tr('runtime.space.msgPlaceholder'),
      send: tr('runtime.space.send'),
      msgThreadEmpty: tr('runtime.space.msgThreadEmpty'),
      msgSentToast: tr('runtime.space.msgSent'),
      commentSentToast: tr('runtime.space.commentSent'),
      emptyInput: tr('runtime.space.emptyInput'),
      playerCommentPlaceholder: tr('runtime.player.commentPlaceholder'),
      playerComment: tr('runtime.player.comment'),
      playerPostTag: tr('runtime.player.postTag'),
      playerLockedHint: tr('runtime.player.lockedHint'),
      playerEditWord: tr('runtime.player.editWord'),
      playerNewWord: tr('runtime.player.newWord'),
      playerWord: {
        folder: tr('runtime.player.word.folder'), note: tr('runtime.player.word.note'), item: tr('runtime.player.word.item'),
        currency: tr('runtime.player.word.currency'), order: tr('runtime.player.word.order'), post: tr('runtime.player.word.post'),
        contact: tr('runtime.space.word.contact')
      },
      playerFieldName: tr('runtime.player.fieldName'),
      playerFieldName: tr('runtime.player.fieldName'),
      playerFieldTitle: tr('runtime.player.fieldTitle'),
      playerFieldBody: tr('runtime.player.fieldBody'),
      playerFieldLocked: tr('runtime.player.fieldLocked'),
      playerFieldQty: tr('runtime.player.fieldQty'),
      playerFieldGrade: tr('runtime.player.fieldGrade'),
      playerFieldDesc: tr('runtime.player.fieldDesc'),
      playerFieldKind: tr('runtime.player.fieldKind'),
      playerFieldAmount: tr('runtime.player.fieldAmount'),
      playerFieldItemName: tr('runtime.player.fieldItemName'),
      playerFieldStatus: tr('runtime.player.fieldStatus'),
      playerFieldPrice: tr('runtime.player.fieldPrice'),
      playerFieldSide: tr('runtime.player.fieldSide'),
      playerFieldSection: tr('runtime.player.fieldSection'),
      playerSectionGeneral: tr('runtime.player.sectionGeneral'),
      playerSectionCultivation: tr('runtime.player.sectionCultivation'),
      playerSectionArtifact: tr('runtime.player.sectionArtifact'),
      playerSectionBounty: tr('runtime.player.sectionBounty'),
      playerSectionMarket: tr('runtime.player.sectionMarket'),
      playerPostTag: tr('runtime.player.postTag'),
      playerLockedHint: tr('runtime.player.lockedHint'),
      playerSideBuy: tr('runtime.player.sideBuy'),
      playerSideSell: tr('runtime.player.sideSell'),
      orderStatusPending: tr('runtime.player.orderStatusPending'),
      orderStatusOpen: tr('runtime.player.orderStatusOpen'),
      orderStatusCompleted: tr('runtime.player.orderStatusCompleted'),
      orderStatusCancelled: tr('runtime.player.orderStatusCancelled'),
      playerSave: tr('runtime.player.save'),
      playerEdit: tr('runtime.player.edit'),
      playerDelete: tr('runtime.player.delete'),
      playerDeleteConfirm: tr('runtime.player.deleteConfirm'),
      deleteConfirmShort: tr('runtime.player.deleteConfirmShort'),
      playerSaved: tr('runtime.player.saved'),
      playerDeleted: tr('runtime.player.deleted'),
      playerUndo: tr('runtime.player.undo'),
      playerRestored: tr('runtime.player.restored'),
      playerFormNeedFolder: tr('runtime.player.formNeedFolder'),
      playerFormKindClash: tr('runtime.player.formKindClash'),
      playerQtyStepDown: tr('runtime.player.qtyStepDown'),
      playerQtyStepUp: tr('runtime.player.qtyStepUp'),
      deleteMessage: tr('runtime.player.deleteMessage'),
      deleteMessageConfirm: tr('runtime.player.deleteMessageConfirm'),
      deleteFolderConfirm: tr('runtime.player.deleteFolderConfirm'),
      deleteContact: tr('runtime.player.deleteContact'),
      deleteContactConfirm: tr('runtime.player.deleteContactConfirm'),
      deleteGroup: tr('runtime.player.deleteGroup'),
      deleteGroupConfirm: tr('runtime.player.deleteGroupConfirm'),
      deleteTrack: tr('runtime.player.deleteTrack'),
      deleteTrackConfirm: tr('runtime.player.deleteTrackConfirm'),
      deletePlace: tr('runtime.player.deletePlace'),
      deletePlaceConfirm: tr('runtime.player.deletePlaceConfirm'),
      playerDiscardTitle: tr('runtime.player.discardTitle'),
      playerDiscardMessage: tr('runtime.player.discardMessage'),
      playerDiscardAction: tr('runtime.player.discardAction'),
      forumCommentsFull: tr('runtime.forum.commentsFull'),
      labels: {
        self: tr('runtime.label.self'), locked: tr('runtime.label.locked'), membersUnit: tr('runtime.label.membersUnit'),
        notesWord: tr('runtime.label.notesWord'), resonance: tr('runtime.label.resonance'), commentsWord: tr('runtime.label.commentsWord'),
        startPrice: tr('runtime.label.startPrice'), bidsUnit: tr('runtime.label.bidsUnit'), buy: tr('runtime.label.buy'), sell: tr('runtime.label.sell')
      },
      tabs: {
        contacts: tr('runtime.tab.contacts'), groups: tr('runtime.tab.groups'), folders: tr('runtime.tab.folders'), notes: tr('runtime.tab.notes'),
        listings: tr('runtime.tab.listings'), requests: tr('runtime.tab.requests'), auctions: tr('runtime.tab.auctions'), orders: tr('runtime.tab.orders'),
        currencies: tr('runtime.tab.currencies'), items: tr('runtime.tab.items')
      },
      features: {
        tablet: tr('runtime.feature.tablet'), msg: tr('runtime.feature.msg'), forum: tr('runtime.feature.forum'), notes: tr('runtime.feature.notes'),
        market: tr('runtime.feature.market'), space: tr('runtime.feature.space'), map: tr('runtime.feature.map'), manage: tr('runtime.feature.manage')
      },
      gua: {
        tablet: tr('runtime.gua.tablet'), msg: tr('runtime.gua.msg'), notes: tr('runtime.gua.notes'), market: tr('runtime.gua.market'),
        forum: tr('runtime.gua.forum'), space: tr('runtime.gua.space'), map: tr('runtime.gua.map'), manage: tr('runtime.gua.manage')
      },
      groups: { basic: tr('runtime.group.basic'), look: tr('runtime.group.look'), cult: tr('runtime.group.cult'), gong: tr('runtime.group.gong'), bond: tr('runtime.group.bond'), secret: tr('runtime.group.secret') },
      fields: {
        name: tr('runtime.field.name'), gender: tr('runtime.field.gender'), height: tr('runtime.field.height'), weight: tr('runtime.field.weight'),
        appearance: tr('runtime.field.appearance'), clothing: tr('runtime.field.clothing'), root: tr('runtime.field.root'), body: tr('runtime.field.body'),
        realm: tr('runtime.field.realm'), status: tr('runtime.field.status'), technique: tr('runtime.field.technique'), bond: tr('runtime.field.bond')
      },
      manage: {
        info: tr('runtime.manage.info'),
        on: tr('runtime.manage.on'),
        off: tr('runtime.manage.off'),
        resetFab: tr('runtime.manage.resetFab'),
        clear: tr('runtime.manage.clear'),
        clearConfirm: tr('runtime.manage.clearConfirm'),
        helpTitle: tr('runtime.manage.helpTitle'),
        helpBody: tr('runtime.manage.helpBody'),
        export: tr('runtime.manage.export'),
        exportNote: tr('runtime.manage.exportNote'),
        import: tr('runtime.manage.import'),
        importBtn: tr('runtime.manage.importBtn'),
        importDone: tr('runtime.manage.importDone'),
        importBad: tr('runtime.manage.importBad'),
        importOversized: tr('runtime.manage.importOversized'),
        importParse: tr('runtime.manage.importParse'),
        importWarn: tr('runtime.manage.importWarn'),
         copyAll: tr('runtime.manage.copyAll'),
         exportTooBig: tr('runtime.manage.exportTooBig'),
          importPlaceholder: tr('runtime.manage.importPlaceholder')
      },
      mapTitles: { current: tr('runtime.map.currentTitle'), tracks: tr('runtime.map.trackTitle'), places: tr('runtime.map.placesTitle') }
    };
  }

  var I18N = {
    tr: tr,
    // 缓存整份翻译字典，onChange（语言切换）时失效重建：
    // 避免每次 render 都对宿主发起上百次 t() 同步调用。
    dict: function () { if (!dictCache) dictCache = buildDict(); return dictCache; },
    invalidate: function () { dictCache = null; },
    setTranslator: function (translator) {
      TRANSLATE = typeof translator === 'function' ? translator : null;
      dictCache = null;
    }
  };

  function makeTranslator(tavoApi) {
    var api = tavoApi && tavoApi.plugin && tavoApi.plugin.i18n;
    if (!api || typeof api.t !== 'function') return fillParams;
    return function (key, params) {
      var out;
      try { out = api.t(key, params); } catch (_) { out = key; }
      return typeof out === 'string' ? out : String(out);
    };
  }
