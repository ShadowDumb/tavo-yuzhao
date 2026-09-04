  /* ---------- UI app / forms ---------- */
  function createForms(ctx) {
    var state = ctx.state;
    var shell = ctx.shell;
    var tr = ctx.tr || function (k) { return k; };
    var dialogs = ctx.dialogs;
    var dataActions = ctx.dataActions;

    function openEntityForm(options) {
      options = options || {};
      state.modal = {
        type: 'entity-form',
        title: options.title || tr('runtime.player.newWord') || '新建条目',
        kind: options.kind,
        targetSpaceId: options.targetSpaceId,
        fields: options.fields || [],
        initialData: options.initialData || {},
        onSubmit: options.onSubmit,
        submitLabel: options.submitLabel || tr('runtime.player.save') || '保存',
        cancelLabel: options.cancelLabel || tr('runtime.cancel') || '取消'
      };
      if (shell) shell.renderDialogs();
    }

    // 常用表单预设
    function openNoteForm(initial) {
      var isEdit = !!(initial && initial.id);
      openEntityForm({
        kind: 'note',
        title: isEdit ? (tr('runtime.player.edit') + ' ' + tr('runtime.player.word.note')) : (tr('runtime.player.newWord') + ' ' + tr('runtime.player.word.note')),
        initialData: initial || {},
        fields: [
          { name: 'folderId', label: tr('runtime.player.word.folder') || '分类/文件夹', type: 'text', required: true, placeholder: '默认' },
          { name: 'title', label: tr('runtime.player.fieldTitle') || '标题', type: 'text', required: true },
          { name: 'body', label: tr('runtime.player.fieldBody') || '正文', type: 'textarea', required: true },
          { name: 'locked', label: tr('runtime.player.fieldLocked') || '禁制锁定', type: 'checkbox' }
        ],
        onSubmit: function (data) {
          dataActions.saveEntity('note', Object.assign({}, initial, data));
        }
      });
    }

    function openContactForm(initial) {
      var isEdit = !!(initial && initial.id);
      openEntityForm({
        kind: 'contact',
        title: isEdit ? (tr('runtime.player.edit') + ' ' + tr('runtime.space.word.contact')) : (tr('runtime.space.addContact') || '新增传讯联系人'),
        initialData: initial || {},
        fields: [
          { name: 'name', label: tr('runtime.space.contactName') || '道号/姓名', type: 'text', required: true },
          { name: 'relation', label: tr('runtime.space.contactRelation') || '关系', type: 'text', placeholder: '同道好友' }
        ],
        onSubmit: function (data) {
          dataActions.saveEntity('contact', Object.assign({}, initial, data));
        }
      });
    }

    function openItemForm(initial) {
      var isEdit = !!(initial && initial.id);
      openEntityForm({
        kind: 'item',
        title: isEdit ? (tr('runtime.player.edit') + ' ' + tr('runtime.player.word.item')) : (tr('runtime.player.newWord') + ' ' + tr('runtime.player.word.item')),
        initialData: initial || {},
        fields: [
          { name: 'name', label: tr('runtime.player.fieldItemName') || '物品名称', type: 'text', required: true },
          { name: 'count', label: tr('runtime.player.fieldQty') || '数量', type: 'number', required: true, defaultValue: 1 },
          { name: 'grade', label: tr('runtime.player.fieldGrade') || '品阶', type: 'text', placeholder: '凡品 / 灵品 / 仙宝' },
          { name: 'desc', label: tr('runtime.player.fieldDesc') || '描述说明', type: 'textarea' }
        ],
        onSubmit: function (data) {
          var payload = Object.assign({}, initial, data);
          if (payload.count != null && payload.qty == null) payload.qty = payload.count;
          if (payload.qty != null && payload.count == null) payload.count = payload.qty;
          dataActions.saveEntity('item', payload);
        }
      });
    }

    function openCurrencyForm(initial) {
      var isEdit = !!(initial && initial.id);
      openEntityForm({
        kind: 'currency',
        title: isEdit ? (tr('runtime.player.edit') + ' ' + tr('runtime.player.word.currency')) : (tr('runtime.player.newWord') + ' ' + tr('runtime.player.word.currency')),
        initialData: initial || {},
        fields: [
          { name: 'kind', label: tr('runtime.player.fieldKind') || '钱财种类', type: 'text', required: true, placeholder: '下品灵石' },
          { name: 'amount', label: tr('runtime.player.fieldAmount') || '数额', type: 'number', required: true, defaultValue: 100 }
        ],
        onSubmit: function (data) {
          dataActions.saveEntity('currency', Object.assign({}, initial, data));
        }
      });
    }

    function openPostForm() {
      openEntityForm({
        kind: 'post',
        title: tr('runtime.player.newWord') + ' ' + tr('runtime.player.word.post'),
        fields: [
          {
            name: 'section', label: tr('runtime.player.fieldSection') || '论坛版块', type: 'select',
            options: [
              { value: '闲聊', label: tr('runtime.player.sectionGeneral') || '闲聊' },
              { value: '修炼心得', label: tr('runtime.player.sectionCultivation') || '修炼心得' },
              { value: '法器交流', label: tr('runtime.player.sectionArtifact') || '法器交流' },
              { value: '悬赏', label: tr('runtime.player.sectionBounty') || '悬赏' },
              { value: '坊市', label: tr('runtime.player.sectionMarket') || '坊市' }
            ]
          },
          { name: 'title', label: tr('runtime.player.fieldTitle') || '帖子标题', type: 'text', required: true },
          { name: 'body', label: tr('runtime.player.fieldBody') || '正文内容', type: 'textarea', required: true }
        ],
        onSubmit: function (data) {
          dataActions.saveEntity('post', Object.assign({ owner: 'player' }, data));
        }
      });
    }

    function openTabletFieldForm(initial) {
      var isEdit = !!(initial && (initial.key || initial.id));
      openEntityForm({
        kind: 'tablet-field',
        title: isEdit ? '编辑玉牌属性' : '新增玉牌属性',
        initialData: initial || {},
        fields: [
          {
            name: 'group', label: '所属分组', type: 'select',
            options: [
              { value: 'basic', label: tr('runtime.group.basic') || '基本' },
              { value: 'look', label: tr('runtime.group.look') || '仪容' },
              { value: 'cult', label: tr('runtime.group.cult') || '修为' },
              { value: 'gong', label: tr('runtime.group.gong') || '功法' },
              { value: 'bond', label: tr('runtime.group.bond') || '羁绊' },
              { value: 'secret', label: tr('runtime.group.secret') || '隐秘' }
            ]
          },
          { name: 'key', label: tr('runtime.player.fieldName') || '属性名', type: 'text', required: true },
          { name: 'value', label: '属性值', type: 'text', required: true }
        ],
        onSubmit: function (data) {
          var payload = Object.assign({}, initial, data);
          dataActions.saveEntity('tablet-field', payload, null, initial && (initial.key || initial.id));
        }
      });
    }

    return {
      openEntityForm: openEntityForm,
      openNoteForm: openNoteForm,
      openContactForm: openContactForm,
      openItemForm: openItemForm,
      openCurrencyForm: openCurrencyForm,
      openPostForm: openPostForm,
      openTabletFieldForm: openTabletFieldForm
    };
  }
