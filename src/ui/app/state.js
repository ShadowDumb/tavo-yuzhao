  /* ---------- UI app / state ---------- */
  function createUiState() {
    return {
      open: false,
      chatActive: true,
      activeView: 'wheel',
      viewStack: [],
      activeTab: '',
      searchQuery: '',
      selectedId: null,
      selectedItem: null,
      modal: null,
      toasts: [],
      undoItem: null,
      undoTimer: null
    };
  }
