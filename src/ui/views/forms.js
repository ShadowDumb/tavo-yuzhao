  function playerEntityWord(kind, t) {
    return t.playerWord[kind] || kind;
  }

  // 英文「NewFolder/EditNote」缺空格：动词与名词间按语言补一个空格（中文无需空格）。
  // 表单标题与新建 CTA 共用，避免 en 界面出现粘连的 "NewFolder"。
  function playerVerbNoun(verb, noun) {
    return /^[A-Za-z]/.test(String(noun)) ? verb + ' ' + noun : verb + noun;
  }

  function playerFormTitle(kind, isEdit, t) {
    return playerVerbNoun(isEdit ? t.playerEditWord : t.playerNewWord, playerEntityWord(kind, t));
  }

  function playerActionLabel(action, kind, name, t) {
    t = t || I18N.dict();
    var base = playerVerbNoun(action, playerEntityWord(kind, t));
    return base + (CORE.hasText(name) ? (/^[A-Za-z]/.test(String(playerEntityWord(kind, t))) ? ': ' : '：') + String(name) : '');
  }

  function playerDeleteConfirmFor(kind, t) {
    t = t || I18N.dict();
    return kind === 'folder' ? t.deleteFolderConfirm : t.playerDeleteConfirm;
  }

  // 行尾编辑按钮（复用管理页清空按钮的样式语义，操作是进入表单）。
  function playerEditBtn(kind, id, name) {
    return '<button type="button" class="yz-edit-btn" data-action="entity-edit" data-kind="' + CORE.escapeHtml(kind) + '" data-id="' + CORE.escapeHtml(String(id)) + '" aria-label="' + CORE.escapeHtml(playerActionLabel(I18N.dict().playerEdit, kind, name)) + '">✎</button>';
  }

  // 可编辑列表行：主区（导航或静态展示）+ 行尾编辑/删除按钮（button 嵌 button 非法，外层用 div）。
  function editableListRow(mainHtml, kind, id, armed, name) {
    var t = I18N.dict();
    var confirm = playerDeleteConfirmFor(kind, t);
    var deleteLabel = playerActionLabel(armed ? confirm : t.playerDelete, kind, name, t);
    var delBtn = '<button type="button" class="yz-clear-btn' + (armed ? ' armed' : '') + '" data-action="entity-delete" data-kind="' + CORE.escapeHtml(kind) + '" data-id="' + CORE.escapeHtml(String(id)) + '" aria-label="' + CORE.escapeHtml(deleteLabel) + '"' + (armed ? ' data-wipe-base="' + CORE.escapeHtml(confirm) + '"' : '') + '>' + CORE.escapeHtml(armed ? confirm : t.playerDelete) + '</button>';
    return '<div class="yz-row yz-static yz-manage-row">' + mainHtml + playerEditBtn(kind, id, name) + delBtn + '</div>';
  }

  // 列表底部新建 CTA（note 需要携带父玉册夹 id）。
  function playerAddBtn(kind, folderId) {
    var t = I18N.dict();
    var extra = folderId ? ' data-folder="' + CORE.escapeHtml(String(folderId)) + '"' : '';
    return '<button type="button" class="yz-add-btn" data-action="entity-new" data-kind="' + CORE.escapeHtml(kind) + '"' + extra + '>＋ ' + CORE.escapeHtml(playerVerbNoun(t.playerNewWord, playerEntityWord(kind, t))) + '</button>';
  }

  // 表单字段描述：key 与 data-form-field 对应，保存时由 App 层统一读取。
  function playerFormFields(kind, entity, t) {
    function field(key, label, type, value, options, max) {
      return { key: key, label: label, type: type || 'text', value: value == null ? '' : value, options: options, max: max };
    }
    if (kind === 'contact') return [
      field('name', t.contactFieldName, 'text', entity && entity.name, null, 120),
      field('relation', t.contactFieldRelation, 'text', entity && entity.relation, null, 120)
    ];
    if (kind === 'folder') return [field('name', t.playerFieldName, 'text', entity && entity.name, null, 120)];
    if (kind === 'note') {
      return [
        field('title', t.playerFieldTitle, 'text', entity && entity.title, null, 200),
        field('body', t.playerFieldBody, 'textarea', entity && entity.body, null, 3000),
        field('locked', t.playerFieldLocked, 'checkbox', !!(entity && entity.locked))
      ];
    }
    if (kind === 'item') {
      return [
        field('name', t.playerFieldName, 'text', entity && entity.name, null, 120),
        field('qty', t.playerFieldQty, 'number', entity && entity.qty),
        field('grade', t.playerFieldGrade, 'text', entity && entity.grade, null, 60),
        field('desc', t.playerFieldDesc, 'textarea', entity && entity.desc, null, 3000)
      ];
    }
    if (kind === 'currency') {
      return [
        field('kind', t.playerFieldKind, 'text', entity && entity.kind, null, 60),
        field('amount', t.playerFieldAmount, 'text', entity && entity.amount, null, 80)
      ];
    }
    if (kind === 'order') {
      var rawStatus = String(entity && entity.status || 'pending').trim();
       var status = orderStatusKey(rawStatus) || 'pending';
       var statusOptions = [['pending', t.orderStatusPending], ['open', t.orderStatusOpen], ['completed', t.orderStatusCompleted], ['cancelled', t.orderStatusCancelled]];
       if (!statusOptions.some(function (option) { return option[0] === status; })) statusOptions.unshift([status, orderStatusLabel(rawStatus)]);
      return [
        field('name', t.playerFieldItemName, 'text', entity && entity.name, null, 120),
        field('status', t.playerFieldStatus, 'select', status, statusOptions),
        field('price', t.playerFieldPrice, 'text', entity && entity.price, null, 80),
        field('side', t.playerFieldSide, 'select', entity && entity.side || 'buy', [['buy', t.playerSideBuy], ['sell', t.playerSideSell]])
      ];
    }
    if (kind === 'post') {
      // 版块用下拉（预设与角色侧一致的版块），避免自由文本把版块碎片化；
      // 已存在的自定义版块保留为选项，不丢用户已有数据。
       var sectionOptions = [
         ['general', t.playerSectionGeneral],
         ['cultivation', t.playerSectionCultivation],
         ['artifact', t.playerSectionArtifact],
         ['bounty', t.playerSectionBounty],
         ['market', t.playerSectionMarket]
       ];
       var curSection = CORE.cleanText(entity && entity.section, 60);
       var curSectionKey = forumSectionKey(curSection);
       if (curSection && !sectionOptions.some(function (o) { return o[0] === curSectionKey; })) {
         sectionOptions.push([curSectionKey, forumSectionLabel(curSection)]);
       }
       return [
         field('title', t.playerFieldTitle, 'text', entity && entity.title, null, 200),
         field('section', t.playerFieldSection, 'select', curSectionKey || 'general', sectionOptions),
        field('body', t.playerFieldBody, 'textarea', entity && entity.body, null, 3000)
      ];
    }
    return [];
  }

  // 玩家域编辑/新建表单页：新建时 id 为空；编辑时预填现有实体。
  // 删除按钮走两击确认（ui.armed 复用管理页武装状态机）。
  function renderSpaceForm(pstate, nav, ui) {
    var t = I18N.dict();
    var params = nav.params || {};
    var kind = params.kind;
    var entity = CORE.playerFindEntity(pstate, kind, params.id);
    var isEdit = !!entity;
    var fields = playerFormFields(kind, entity, t);
    var title = playerFormTitle(kind, isEdit, t);
    var body = '<div class="yz-form">';
    if (kind === 'note') {
      var folderId = params.folderId || (entity && entity.folderId) || '';
      body += '<input type="hidden" data-form-field="folderId" value="' + CORE.escapeHtml(String(folderId)) + '">';
      // 锁定是角色扮演标记（剧情里「禁制」），不影响本机编辑——给一句说明，
      // 否则用户以为锁定后不可改。
      if (entity && entity.locked) {
        body += '<div class="yz-io-warn">' + CORE.escapeHtml(t.playerLockedHint) + '</div>';
      }
    }
    fields.forEach(function (field) {
      var label = '<label for="yz-form-' + field.key + '">' + CORE.escapeHtml(field.label) + '</label>';
      // 超长由 cleanText 静默截断（runtime 兜底），输入侧同步 maxlength 提示上限，避免「存少了一截」。
       var maxAttr = field.max ? ' maxlength="' + field.max + '"' : '';
       var lengthCounter = field.max ? '<span class="yz-length-counter" data-length-counter="' + CORE.escapeHtml(field.key) + '" aria-live="polite">' + CORE.escapeHtml(String(String(field.value == null ? '' : field.value).length) + '/' + field.max) + '</span>' : '';
       if (field.type === 'textarea') {
         body += label + '<div class="yz-input-wrap"><textarea class="yz-form-input" id="yz-form-' + field.key + '" data-form-field="' + field.key + '" rows="6"' + maxAttr + '>' + CORE.escapeHtml(String(field.value)) + '</textarea>' + lengthCounter + '</div>';
      } else if (field.type === 'checkbox') {
        body += '<label class="yz-form-check" for="yz-form-' + field.key + '"><input type="checkbox" id="yz-form-' + field.key + '" data-form-field="' + field.key + '"' + (field.value ? ' checked' : '') + '>' + CORE.escapeHtml(field.label) + '</label>';
      } else if (field.type === 'select') {
        body += label + '<select class="yz-form-input" id="yz-form-' + field.key + '" data-form-field="' + field.key + '">' + field.options.map(function (option) {
          return '<option value="' + CORE.escapeHtml(option[0]) + '"' + (String(field.value) === option[0] ? ' selected' : '') + '>' + CORE.escapeHtml(option[1]) + '</option>';
        }).join('') + '</select>';
      } else if (field.type === 'number') {
        // 数量字段带 −/+ 快捷步进（数量是纯数字，增减无需打开键盘输入）。
        var minusDisabled = Number(field.value) <= 0 ? ' disabled' : '';
        body += label + '<div class="yz-stepper">' +
          '<button type="button" class="yz-step" data-action="qty-step" data-delta="-1" aria-label="' + CORE.escapeHtml(t.playerQtyStepDown) + '"' + minusDisabled + '>−</button>' +
          '<input class="yz-form-input" id="yz-form-' + field.key + '" data-form-field="' + field.key + '" type="number" min="0" step="1" value="' + CORE.escapeHtml(String(field.value)) + '">' +
          '<button type="button" class="yz-step" data-action="qty-step" data-delta="1" aria-label="' + CORE.escapeHtml(t.playerQtyStepUp) + '">+</button></div>';
       } else {
         body += label + '<div class="yz-input-wrap"><input class="yz-form-input" id="yz-form-' + field.key + '" data-form-field="' + field.key + '" type="' + (field.type === 'number' ? 'number' : 'text') + '" value="' + CORE.escapeHtml(String(field.value)) + '"' + maxAttr + '>' + lengthCounter + '</div>';
      }
    });
    body += '</div>';
     var armed = !!(ui && ui.armed && ui.armed.id === kind + ':' + String(params.id));
     var deleteConfirm = playerDeleteConfirmFor(kind, t);
     var deleteName = entity && (entity.name || entity.title || entity.kind || '');
     body += '<div class="yz-form-actions">' +
       '<button type="button" class="yz-send" data-action="entity-save" data-kind="' + CORE.escapeHtml(kind) + '" data-id="' + CORE.escapeHtml(String(params.id || '')) + '">' + CORE.escapeHtml(t.playerSave) + '</button>' +
       (isEdit ? '<button type="button" class="yz-clear-btn' + (armed ? ' armed' : '') + '" data-action="entity-delete" data-kind="' + CORE.escapeHtml(kind) + '" data-id="' + CORE.escapeHtml(String(params.id)) + '" aria-label="' + CORE.escapeHtml(playerActionLabel(armed ? deleteConfirm : t.playerDelete, kind, deleteName, t)) + '"' + (armed ? ' data-wipe-base="' + CORE.escapeHtml(deleteConfirm) + '"' : '') + '>' + CORE.escapeHtml(armed ? deleteConfirm : t.playerDelete) + '</button>' : '') +
      '</div>';
    return '<main class="yz-page-inner" data-marker="player-form">' +
      yzHeader(title) + body + '</main>';
  }

