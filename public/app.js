/**
 * LibSphere Library Management & Copy Audit System
 * Complete Frontend Controller & State Management
 */

const app = {
  activeTab: 'dashboard',
  books: [],
  members: [],
  categories: [],
  activeTransactions: [],
  selectedBookForCopies: null,

  // ==========================================
  // INITIALIZATION
  // ==========================================
  init() {
    this.bindEvents();
    this.setupBatchPrefixAutoPreview();
    this.loadInitialData();
  },

  bindEvents() {
    // Navigation Tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const target = tab.dataset.tab;
        this.switchTab(target);
      });
    });

    // Global Quick Search
    const globalSearchInput = document.getElementById('globalQuickSearch');
    const globalSearchBtn = document.getElementById('globalQuickSearchBtn');
    const handleGlobalSearch = () => {
      const code = globalSearchInput.value.trim();
      if (code) {
        this.switchTab('inspector');
        this.inspectCopy(code);
      }
    };
    globalSearchBtn.addEventListener('click', handleGlobalSearch);
    globalSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleGlobalSearch();
    });

    // Header Quick Actions
    document.getElementById('btnQuickIssue')?.addEventListener('click', () => {
      this.switchTab('circulation');
      document.getElementById('issueMemberSelect')?.focus();
    });
    document.getElementById('btnQuickReturn')?.addEventListener('click', () => {
      this.switchTab('circulation');
      document.getElementById('returnCopySelect')?.focus();
    });
    document.getElementById('btnOpenAddBookModal')?.addEventListener('click', () => {
      this.openModal('modalAddBook');
    });
    document.getElementById('btnAddNewBook')?.addEventListener('click', () => {
      this.openModal('modalAddBook');
    });
    document.getElementById('btnOpenAddMemberModal')?.addEventListener('click', () => {
      this.openModal('modalAddMember');
    });

    // Catalog Search & Filters
    document.getElementById('catalogSearchInput')?.addEventListener('input', (e) => {
      this.debounce(() => this.loadBooks(), 300)();
    });
    document.getElementById('catalogCategoryFilter')?.addEventListener('change', () => this.loadBooks());
    document.getElementById('catalogStockFilter')?.addEventListener('change', () => this.loadBooks());
    document.getElementById('btnResetCatalogFilters')?.addEventListener('click', () => {
      document.getElementById('catalogSearchInput').value = '';
      document.getElementById('catalogCategoryFilter').value = 'ALL';
      document.getElementById('catalogStockFilter').value = 'ALL';
      this.loadBooks();
    });
    document.getElementById('btnExportBooksCsv')?.addEventListener('click', () => {
      window.location.href = '/api/export/csv/books';
    });

    // Copy Audit Inspector Search
    const inspInput = document.getElementById('inspectorCopyCodeInput');
    const inspBtn = document.getElementById('btnInspectCopy');
    inspBtn?.addEventListener('click', () => {
      const code = inspInput.value.trim();
      if (code) this.inspectCopy(code);
    });
    inspInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const code = inspInput.value.trim();
        if (code) this.inspectCopy(code);
      }
    });

    // Circulation Forms
    const issueForm = document.getElementById('issueBookForm');
    issueForm?.addEventListener('submit', (e) => this.handleIssueSubmit(e));

    const returnForm = document.getElementById('returnBookForm');
    returnForm?.addEventListener('submit', (e) => this.handleReturnSubmit(e));

    // Circulation issue due date helper
    document.getElementById('issueDueDays')?.addEventListener('input', (e) => {
      this.updateCalculatedDueDate(e.target.value);
    });
    this.updateCalculatedDueDate(14);

    // Dynamic copy selection hints in return form
    document.getElementById('returnCopySelect')?.addEventListener('change', (e) => {
      const copyCode = e.target.value;
      const hint = document.getElementById('returnCopyDetailsHint');
      if (!copyCode) {
        hint.textContent = 'Select copy to view current borrower';
        return;
      }
      const match = this.activeTransactions.find(t => t.copy_code === copyCode);
      if (match) {
        hint.innerHTML = `<span class="text-warning">Currently with: <strong>${match.member_name}</strong> (${match.member_code}) | Due: ${this.formatDate(match.due_date)}</span>`;
      }
    });

    // Add Book Form
    document.getElementById('addBookForm')?.addEventListener('submit', (e) => this.handleAddBookSubmit(e));

    // Add Member Form
    document.getElementById('addMemberForm')?.addEventListener('submit', (e) => this.handleAddMemberSubmit(e));

    // Members Search
    document.getElementById('memberSearchInput')?.addEventListener('input', () => {
      this.debounce(() => this.loadMembers(), 300)();
    });
  },

  setupBatchPrefixAutoPreview() {
    const titleInput = document.getElementById('addBookTitle');
    const countInput = document.getElementById('addBookCopiesCount');
    const prefixInput = document.getElementById('addBookCopyPrefix');
    const previewBox = document.getElementById('copyCodePreview');

    const updatePreview = () => {
      const count = Math.max(1, parseInt(countInput.value, 10) || 1);
      let prefix = prefixInput.value.trim();
      if (!prefix && titleInput.value.trim()) {
        prefix = titleInput.value.trim().slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '');
        prefixInput.value = prefix;
      }
      if (!prefix) prefix = 'CPY';

      const firstCode = `${prefix}-001`;
      const lastCode = `${prefix}-${String(count).padStart(3, '0')}`;
      previewBox.textContent = count === 1 ? firstCode : `${firstCode} ... ${lastCode} (${count} copies)`;
    };

    titleInput?.addEventListener('input', () => {
      if (!prefixInput.dataset.manual) {
        const words = titleInput.value.trim().split(/\s+/);
        let suggested = '';
        if (words.length >= 2) {
          suggested = (words[0].slice(0, 2) + words[1].slice(0, 2)).toUpperCase().replace(/[^A-Z0-9]/g, '');
        } else if (words.length === 1 && words[0]) {
          suggested = words[0].slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '');
        }
        if (suggested) {
          prefixInput.value = suggested;
          updatePreview();
        }
      }
    });

    prefixInput?.addEventListener('input', () => {
      prefixInput.dataset.manual = 'true';
      updatePreview();
    });

    countInput?.addEventListener('input', updatePreview);
  },

  // Switch Active Tab
  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.nav-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-pane').forEach(p => {
      p.classList.toggle('active', p.id === `tab-${tabId}`);
    });

    // Load data for newly focused tab
    if (tabId === 'dashboard') this.loadDashboardData();
    if (tabId === 'catalog') this.loadBooks();
    if (tabId === 'circulation') {
      this.loadCirculationDropdowns();
      this.loadActiveLoans();
    }
    if (tabId === 'members') this.loadMembers();
    if (tabId === 'logs') this.loadHistoryLogs();
  },

  // Load All Core Initial Data
  async loadInitialData() {
    await this.loadDashboardData();
    await this.loadCategories();
    this.loadCirculationDropdowns();
  },

  // ==========================================
  // DASHBOARD CONTROLLER
  // ==========================================
  async loadDashboardData() {
    try {
      const res = await fetch('/api/stats');
      const stats = await res.json();

      document.getElementById('metricTitles').textContent = stats.totalTitles || 0;
      document.getElementById('metricCopies').textContent = stats.totalCopies || 0;
      document.getElementById('metricAvailable').textContent = stats.availableCopies || 0;
      document.getElementById('metricIssued').textContent = stats.issuedCopies || 0;
      document.getElementById('metricMembers').textContent = stats.totalMembers || 0;

      const overdueBadge = document.getElementById('metricOverdueAlert');
      if (stats.overdueCount > 0) {
        overdueBadge.textContent = `⚠️ ${stats.overdueCount} overdue`;
        overdueBadge.className = 'metric-sub text-danger';
      } else {
        overdueBadge.textContent = '0 overdue';
        overdueBadge.className = 'metric-sub text-success';
      }

      // Populate dashboard active loans
      this.loadDashboardActiveLoans();

      // Populate activity feed
      this.renderActivityFeed(stats.recentActivity || []);
    } catch (err) {
      console.error('Error loading dashboard stats:', err);
    }
  },

  async loadDashboardActiveLoans() {
    try {
      const res = await fetch('/api/transactions/active');
      const loans = await res.json();
      const tbody = document.getElementById('dashActiveLoansTable');
      if (!tbody) return;

      if (loans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 24px; color: var(--text-dim);">No active loans right now. All books are on shelves!</td></tr>`;
        return;
      }

      tbody.innerHTML = loans.slice(0, 5).map(l => {
        const isOverdue = l.is_overdue === 1;
        return `
          <tr>
            <td><span class="code-tag">${l.copy_code}</span></td>
            <td><strong>${this.escape(l.book_title)}</strong></td>
            <td>${this.escape(l.member_name)} <span class="badge-sub">(${l.member_code})</span></td>
            <td>${this.formatDate(l.due_date)}</td>
            <td>
              ${isOverdue 
                ? `<span class="badge badge-danger">OVERDUE (${l.days_overdue}d)</span>` 
                : `<span class="badge badge-warning">ISSUED</span>`
              }
            </td>
            <td>
              <button class="btn btn-xs btn-outline" onclick="app.quickReturnFromTable('${l.copy_code}')" title="Return Book">
                <i class="fa-solid fa-arrow-rotate-left"></i> Return
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load active loans for dashboard:', err);
    }
  },

  renderActivityFeed(activities) {
    const feed = document.getElementById('dashActivityFeed');
    if (!feed) return;

    if (activities.length === 0) {
      feed.innerHTML = `<div class="empty-state p-3"><p>No circulation activity recorded yet.</p></div>`;
      return;
    }

    feed.innerHTML = activities.map(act => {
      const isReturn = act.status === 'RETURNED';
      return `
        <div class="activity-item">
          <div class="activity-icon ${isReturn ? 'return' : 'issue'}">
            <i class="fa-solid ${isReturn ? 'fa-arrow-down' : 'fa-arrow-up'}"></i>
          </div>
          <div class="activity-content">
            <div class="activity-title">
              <strong>${this.escape(act.member_name)}</strong> 
              ${isReturn ? 'returned' : 'borrowed'} 
              <span class="code-tag">${act.copy_code}</span>
            </div>
            <div class="activity-meta">
              <span>${this.escape(act.book_title)}</span>
              <span>•</span>
              <span>${this.formatDateTime(isReturn ? act.return_date : act.issue_date)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  // ==========================================
  // BOOKS CATALOG & COPIES INVENTORY
  // ==========================================
  async loadCategories() {
    try {
      const res = await fetch('/api/categories');
      this.categories = await res.json();
      const select = document.getElementById('catalogCategoryFilter');
      if (select) {
        select.innerHTML = '<option value="ALL">All Categories</option>' +
          this.categories.map(c => `<option value="${this.escape(c)}">${this.escape(c)}</option>`).join('');
      }
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  },

  async loadBooks() {
    try {
      const search = document.getElementById('catalogSearchInput')?.value || '';
      const category = document.getElementById('catalogCategoryFilter')?.value || 'ALL';
      const stock = document.getElementById('catalogStockFilter')?.value || 'ALL';

      const params = new URLSearchParams();
      if (search) params.append('q', search);
      if (category !== 'ALL') params.append('category', category);
      if (stock !== 'ALL') params.append('status', stock);

      const res = await fetch(`/api/books?${params.toString()}`);
      this.books = await res.json();
      this.renderBooksCatalog();
    } catch (err) {
      console.error('Failed to load books:', err);
      this.showToast('Failed to load books catalog', 'error');
    }
  },

  renderBooksCatalog() {
    const tbody = document.getElementById('catalogTableBody');
    const emptyState = document.getElementById('catalogEmptyState');
    if (!tbody) return;

    if (this.books.length === 0) {
      tbody.innerHTML = '';
      emptyState?.classList.remove('hidden');
      return;
    }

    emptyState?.classList.add('hidden');

    tbody.innerHTML = this.books.map(b => {
      const isAvailable = b.available_copies > 0;
      return `
        <tr>
          <td>
            <button class="btn btn-xs btn-outline" onclick="app.viewBookCopies(${b.id})" title="View all physical copies">
              <i class="fa-solid fa-layer-group"></i>
            </button>
          </td>
          <td>
            <strong style="font-size: 14px; color: #fff;">${this.escape(b.title)}</strong>
            <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">
              <span>ISBN: ${this.escape(b.isbn_or_code || 'N/A')}</span>
              ${b.edition ? ` • <span>${this.escape(b.edition)}</span>` : ''}
            </div>
          </td>
          <td><span style="color: #cbd5e1;">${this.escape(b.author)}</span></td>
          <td><span class="badge badge-secondary">${this.escape(b.category)}</span></td>
          <td><span style="color: var(--text-dim);"><i class="fa-solid fa-location-dot"></i> ${this.escape(b.shelf_location || 'General')}</span></td>
          <td>
            ${isAvailable 
              ? `<span class="stock-pill stock-in"><i class="fa-solid fa-circle-check"></i> IN STOCK (${b.available_copies}/${b.total_copies})</span>` 
              : `<span class="stock-pill stock-out"><i class="fa-solid fa-circle-xmark"></i> OUT OF STOCK (0/${b.total_copies})</span>`
            }
          </td>
          <td style="text-align: right;">
            <button class="btn btn-xs btn-secondary" onclick="app.viewBookCopies(${b.id})" title="Manage Copies">
              <i class="fa-solid fa-barcode"></i> Copies (${b.total_copies})
            </button>
            <button class="btn btn-xs btn-outline" onclick="app.deleteBook(${b.id}, '${this.escape(b.title)}')" title="Delete Title">
              <i class="fa-solid fa-trash text-danger"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  async viewBookCopies(bookId) {
    try {
      const res = await fetch(`/api/books/${bookId}`);
      const book = await res.json();
      this.selectedBookForCopies = book;

      document.getElementById('modalBookCopiesTitle').textContent = book.title;
      document.getElementById('modalBookCopiesSubtitle').textContent = `${book.author} • ${book.category} • Shelf: ${book.shelf_location || 'N/A'}`;

      const availableCount = book.copies.filter(c => c.status === 'AVAILABLE').length;
      document.getElementById('modalBookCopiesStats').innerHTML = `
        <span><strong>Total Physical Copies:</strong> ${book.copies.length}</span>
        <span class="text-success ml-3"><strong>Available:</strong> ${availableCount}</span>
        <span class="text-warning ml-3"><strong>Issued:</strong> ${book.copies.length - availableCount}</span>
      `;

      const tbody = document.getElementById('modalBookCopiesTableBody');
      tbody.innerHTML = book.copies.map(c => {
        let statusBadge = '<span class="badge badge-success">AVAILABLE</span>';
        if (c.status === 'ISSUED') statusBadge = '<span class="badge badge-warning">ISSUED</span>';
        else if (c.status === 'DAMAGED') statusBadge = '<span class="badge badge-danger">DAMAGED</span>';
        else if (c.status === 'MAINTENANCE') statusBadge = '<span class="badge badge-info">MAINTENANCE</span>';

        return `
          <tr>
            <td><strong class="code-tag">${c.copy_code}</strong></td>
            <td>${statusBadge}</td>
            <td><span class="condition-note-text">${this.escape(c.condition_note || 'Good')}</span></td>
            <td>
              ${c.current_borrower_name 
                ? `<span>${this.escape(c.current_borrower_name)} <span class="badge-sub">(${c.current_borrower_code})</span></span>` 
                : `<span class="badge-sub">—</span>`
              }
            </td>
            <td>${c.due_date ? this.formatDate(c.due_date) : '<span class="badge-sub">—</span>'}</td>
            <td style="text-align: right;">
              <button class="btn btn-xs btn-outline" onclick="app.closeModal('modalBookCopies'); app.switchTab('inspector'); app.inspectCopy('${c.copy_code}');" title="Audit this copy">
                <i class="fa-solid fa-fingerprint text-primary"></i> Inspect
              </button>
            </td>
          </tr>
        `;
      }).join('');

      this.openModal('modalBookCopies');
    } catch (err) {
      console.error('Error fetching book copies:', err);
      this.showToast('Failed to load copies', 'error');
    }
  },

  async deleteBook(bookId, title) {
    if (!confirm(`Are you sure you want to delete "${title}" and all its physical copies from the library?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/books/${bookId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete book');

      this.showToast(data.message, 'success');
      this.loadBooks();
      this.loadDashboardData();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async handleAddBookSubmit(e) {
    e.preventDefault();
    const payload = {
      title: document.getElementById('addBookTitle').value,
      author: document.getElementById('addBookAuthor').value,
      category: document.getElementById('addBookCategory').value,
      edition: document.getElementById('addBookEdition').value,
      shelf_location: document.getElementById('addBookShelf').value,
      isbn_or_code: document.getElementById('addBookIsbn').value,
      copy_count: document.getElementById('addBookCopiesCount').value,
      copy_prefix: document.getElementById('addBookCopyPrefix').value
    };

    try {
      const res = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create book');

      this.showToast(data.message, 'success');
      this.closeModal('modalAddBook');
      document.getElementById('addBookForm').reset();
      this.loadBooks();
      this.loadCategories();
      this.loadDashboardData();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // ==========================================
  // TAB 3: COPY AUDIT INSPECTOR (DAMAGE TRACKER)
  // ==========================================
  async inspectCopy(copyCode) {
    try {
      const code = copyCode.trim();
      document.getElementById('inspectorCopyCodeInput').value = code;

      const res = await fetch(`/api/transactions/copy-history/${encodeURIComponent(code)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Copy "${code}" not found.`);
      }

      const emptyState = document.getElementById('inspectorEmptyState');
      const resultsContainer = document.getElementById('inspectorResults');
      emptyState.classList.add('hidden');
      resultsContainer.classList.remove('hidden');

      // Populate Copy Profile Card
      const copy = data.copy;
      document.getElementById('inspCopyCode').textContent = copy.copy_code;
      document.getElementById('inspBookTitle').textContent = copy.book_title;
      document.getElementById('inspBookAuthor').textContent = copy.book_author;
      document.getElementById('inspBookCategory').textContent = copy.category;
      document.getElementById('inspBookShelf').textContent = copy.shelf_location || 'Shelf A-1';
      document.getElementById('inspBookEdition').textContent = copy.edition || 'Standard';
      document.getElementById('inspConditionNote').textContent = copy.condition_note || 'Good condition';
      document.getElementById('inspTotalLoans').textContent = data.totalBorrowCount;

      const statusTag = document.getElementById('inspCopyStatus');
      statusTag.textContent = copy.status;
      statusTag.className = 'copy-status-tag';
      if (copy.status === 'AVAILABLE') statusTag.classList.add('badge-success');
      else if (copy.status === 'ISSUED') statusTag.classList.add('badge-warning');
      else statusTag.classList.add('badge-danger');

      // Action button
      const quickActionBtn = document.getElementById('btnInspQuickIssueReturn');
      if (copy.status === 'AVAILABLE') {
        quickActionBtn.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i> Issue This Copy';
        quickActionBtn.className = 'btn btn-primary btn-sm';
        quickActionBtn.onclick = () => {
          this.switchTab('circulation');
          const select = document.getElementById('issueCopySelect');
          if (select) select.value = copy.copy_code;
        };
      } else if (copy.status === 'ISSUED') {
        quickActionBtn.innerHTML = '<i class="fa-solid fa-arrow-down-left-and-up-right-to-center"></i> Return This Copy';
        quickActionBtn.className = 'btn btn-secondary btn-sm';
        quickActionBtn.onclick = () => {
          this.switchTab('circulation');
          const select = document.getElementById('returnCopySelect');
          if (select) {
            select.value = copy.copy_code;
            select.dispatchEvent(new Event('change'));
          }
        };
      } else {
        quickActionBtn.innerHTML = '<i class="fa-solid fa-wrench"></i> Mark Available';
        quickActionBtn.className = 'btn btn-outline btn-sm';
        quickActionBtn.onclick = async () => {
          await this.updateCopyStatus(copy.id, 'AVAILABLE', 'Restored to good condition');
          this.inspectCopy(copy.copy_code);
        };
      }

      // 1. Current Active Borrower (If Issued)
      const activeCard = document.getElementById('inspActiveBorrowerCard');
      const activeDetails = document.getElementById('inspActiveBorrowerDetails');
      if (data.activeCheckout) {
        activeCard.classList.remove('hidden');
        const ac = data.activeCheckout;
        activeDetails.innerHTML = `
          <div class="borrower-profile">
            <div class="borrower-name-row">
              <span class="borrower-name">${this.escape(ac.member_name)}</span>
              <span class="member-code">${this.escape(ac.member_code)}</span>
            </div>
            <div class="borrower-meta-list">
              <div><strong>Role:</strong> ${ac.role || 'Student'}</div>
              <div><strong>Phone:</strong> ${ac.phone || 'N/A'}</div>
              <div><strong>Issued Date:</strong> ${this.formatDate(ac.issue_date)}</div>
              <div><strong>Due Date:</strong> ${this.formatDate(ac.due_date)}</div>
            </div>
            ${ac.notes ? `<div class="form-hint"><strong>Loan Notes:</strong> ${this.escape(ac.notes)}</div>` : ''}
          </div>
        `;
      } else {
        activeCard.classList.add('hidden');
      }

      // 2. LAST BORROWER SPOTLIGHT (CRUCIAL FOR DAMAGED BOOK INVESTIGATION)
      const lastBorrowerCard = document.getElementById('inspLastBorrowerCard');
      const lastDetails = document.getElementById('inspLastBorrowerDetails');
      if (data.lastBorrower) {
        lastBorrowerCard.classList.remove('hidden');
        const lb = data.lastBorrower;
        const isDamaged = lb.return_condition && (lb.return_condition.toLowerCase().includes('torn') || lb.return_condition.toLowerCase().includes('damage'));

        lastDetails.innerHTML = `
          <div class="borrower-profile">
            <div class="borrower-name-row">
              <span class="borrower-name">${this.escape(lb.member_name)}</span>
              <span class="member-code">${this.escape(lb.member_code)}</span>
            </div>
            <div class="borrower-meta-list">
              <div><strong>Role:</strong> ${lb.role || 'Student'}</div>
              <div><strong>Phone:</strong> ${lb.phone || 'N/A'}</div>
              <div><strong>Borrowed:</strong> ${this.formatDate(lb.issue_date)}</div>
              <div><strong>Returned On:</strong> ${this.formatDate(lb.return_date)}</div>
            </div>
            <div class="condition-highlight-box ${isDamaged ? '' : 'intact'}">
              <div class="condition-highlight-title"><i class="fa-solid fa-clipboard-check"></i> Condition Recorded at Return:</div>
              <div style="font-weight: 600; color: ${isDamaged ? '#ef4444' : '#10b981'};">
                ${this.escape(lb.return_condition || 'Normal return')}
              </div>
              ${lb.fine > 0 ? `<div style="font-size: 11px; margin-top: 4px; color: #f59e0b;">Fine Charged: ₹${lb.fine}</div>` : ''}
            </div>
          </div>
        `;
      } else {
        lastDetails.innerHTML = `<p class="badge-sub">No previous returned loans recorded for this copy yet.</p>`;
      }

      // 3. Chronological Audit Timeline
      const timeline = document.getElementById('inspTimeline');
      if (!data.history || data.history.length === 0) {
        timeline.innerHTML = `<div class="empty-state p-3"><p>No checkout history for this copy yet. It has remained on the shelf since addition.</p></div>`;
      } else {
        timeline.innerHTML = data.history.map(item => {
          const isAct = item.status === 'ACTIVE';
          const hasDamage = item.return_condition && (item.return_condition.toLowerCase().includes('torn') || item.return_condition.toLowerCase().includes('damage'));

          return `
            <div class="timeline-item">
              <div class="timeline-marker ${isAct ? 'active' : 'returned'}">
                <i class="fa-solid ${isAct ? 'fa-hourglass-half' : 'fa-check'}"></i>
              </div>
              <div class="timeline-card">
                <div class="timeline-header">
                  <div>
                    <span class="timeline-user">${this.escape(item.member_name)}</span>
                    <span class="badge-sub">(${this.escape(item.member_code)} • ${item.role})</span>
                  </div>
                  <div>
                    ${isAct 
                      ? '<span class="badge badge-warning">CURRENTLY ACTIVE</span>' 
                      : '<span class="badge badge-success">RETURNED</span>'
                    }
                  </div>
                </div>

                <div class="timeline-dates">
                  <span><i class="fa-solid fa-arrow-up text-warning"></i> Issued: <strong>${this.formatDate(item.issue_date)}</strong></span>
                  <span><i class="fa-solid fa-calendar-day text-info"></i> Due: <strong>${this.formatDate(item.due_date)}</strong></span>
                  ${item.return_date ? `<span><i class="fa-solid fa-arrow-down text-success"></i> Returned: <strong>${this.formatDate(item.return_date)}</strong></span>` : ''}
                </div>

                ${item.return_condition ? `
                  <div class="condition-highlight-box ${hasDamage ? '' : 'intact'}" style="margin-top: 6px; padding: 6px 10px;">
                    <span style="font-size: 12px; font-weight: 600; color: ${hasDamage ? '#ef4444' : '#10b981'};">
                      <i class="fa-solid fa-tag"></i> Condition: ${this.escape(item.return_condition)}
                    </span>
                    ${item.fine > 0 ? `<span style="font-size: 11px; margin-left: 10px; color: #f59e0b;">(Fine: ₹${item.fine})</span>` : ''}
                  </div>
                ` : ''}

                ${item.notes ? `
                  <div class="form-hint" style="margin-top: 4px;">Notes: ${this.escape(item.notes)}</div>
                ` : ''}
              </div>
            </div>
          `;
        }).join('');
      }

      this.showToast(`Loaded copy audit details for ${code}`, 'info');
    } catch (err) {
      console.error('Audit inspector error:', err);
      this.showToast(err.message, 'error');
    }
  },

  async updateCopyStatus(copyId, status, note) {
    try {
      const res = await fetch(`/api/copies/${copyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, condition_note: note })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update copy');
      this.showToast(data.message, 'success');
      this.loadBooks();
      this.loadDashboardData();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // ==========================================
  // TAB 4: CIRCULATION DESK (ISSUE & RETURN)
  // ==========================================
  async loadCirculationDropdowns() {
    try {
      // 1. Members
      const membersRes = await fetch('/api/members');
      const members = await membersRes.json();
      this.members = members;

      const memberSelect = document.getElementById('issueMemberSelect');
      if (memberSelect) {
        memberSelect.innerHTML = '<option value="">-- Choose Member --</option>' +
          members.map(m => `<option value="${m.member_code}">${this.escape(m.name)} (${m.member_code} • ${m.role})</option>`).join('');
      }

      // 2. Available Copies for Issue
      const availRes = await fetch('/api/copies/search?available_only=true');
      const availCopies = await availRes.json();

      const copySelect = document.getElementById('issueCopySelect');
      if (copySelect) {
        copySelect.innerHTML = '<option value="">-- Choose Available Copy --</option>' +
          availCopies.map(c => `<option value="${c.copy_code}">${c.copy_code} — ${this.escape(c.book_title)} (${c.condition_note || 'Good'})</option>`).join('');
      }

      // 3. Active Loans for Return Dropdown
      this.loadReturnDropdown();
    } catch (err) {
      console.error('Error loading circulation dropdowns:', err);
    }
  },

  async loadReturnDropdown() {
    try {
      const res = await fetch('/api/transactions/active');
      const loans = await res.json();
      this.activeTransactions = loans;

      const returnSelect = document.getElementById('returnCopySelect');
      if (returnSelect) {
        returnSelect.innerHTML = '<option value="">-- Choose Issued Copy to Return --</option>' +
          loans.map(l => `<option value="${l.copy_code}">${l.copy_code} — ${this.escape(l.book_title)} (With: ${this.escape(l.member_name)})</option>`).join('');
      }
    } catch (err) {
      console.error('Error loading return dropdown:', err);
    }
  },

  async loadActiveLoans() {
    try {
      const res = await fetch('/api/transactions/active');
      const loans = await res.json();
      this.activeTransactions = loans;

      const tbody = document.getElementById('activeLoansTableBody');
      const badge = document.getElementById('activeLoansCountBadge');
      if (badge) badge.textContent = `${loans.length} active loans`;
      if (!tbody) return;

      if (loans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 24px; color: var(--text-dim);">No books currently on loan. All copies are in stock!</td></tr>`;
        return;
      }

      tbody.innerHTML = loans.map(l => {
        const isOverdue = l.is_overdue === 1;
        return `
          <tr>
            <td><strong class="code-tag">${l.copy_code}</strong></td>
            <td><strong>${this.escape(l.book_title)}</strong></td>
            <td>${this.escape(l.member_name)} <span class="badge-sub">(${l.member_code})</span></td>
            <td>${this.formatDate(l.issue_date)}</td>
            <td>${this.formatDate(l.due_date)}</td>
            <td>
              ${isOverdue 
                ? `<span class="badge badge-danger">OVERDUE (+${l.days_overdue} days)</span>` 
                : `<span class="badge badge-success">ON SCHEDULE</span>`
              }
            </td>
            <td style="text-align: right;">
              <button class="btn btn-xs btn-primary" onclick="app.quickReturnFromTable('${l.copy_code}')">
                <i class="fa-solid fa-arrow-rotate-left"></i> Return
              </button>
              <button class="btn btn-xs btn-outline" onclick="app.switchTab('inspector'); app.inspectCopy('${l.copy_code}');">
                <i class="fa-solid fa-fingerprint"></i> Audit
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load active loans:', err);
    }
  },

  quickReturnFromTable(copyCode) {
    this.switchTab('circulation');
    const returnSelect = document.getElementById('returnCopySelect');
    if (returnSelect) {
      returnSelect.value = copyCode;
      returnSelect.dispatchEvent(new Event('change'));
      returnSelect.scrollIntoView({ behavior: 'smooth' });
    }
  },

  updateCalculatedDueDate(days) {
    const numDays = parseInt(days, 10) || 14;
    const d = new Date();
    d.setDate(d.getDate() + numDays);
    const box = document.getElementById('issueCalculatedDueDate');
    if (box) box.textContent = d.toDateString();
  },

  async handleIssueSubmit(e) {
    e.preventDefault();
    const payload = {
      member_code: document.getElementById('issueMemberSelect').value,
      copy_code: document.getElementById('issueCopySelect').value,
      due_days: document.getElementById('issueDueDays').value,
      notes: document.getElementById('issueNotes').value
    };

    if (!payload.member_code || !payload.copy_code) {
      this.showToast('Please select both Member and Physical Copy', 'error');
      return;
    }

    try {
      const res = await fetch('/api/transactions/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to issue copy');

      this.showToast(data.message, 'success');
      document.getElementById('issueBookForm').reset();
      this.updateCalculatedDueDate(14);

      // Refresh data
      this.loadCirculationDropdowns();
      this.loadActiveLoans();
      this.loadDashboardData();
      this.loadBooks();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async handleReturnSubmit(e) {
    e.preventDefault();
    const condition = document.getElementById('returnConditionSelect').value;
    const customRemarks = document.getElementById('returnConditionRemarks').value.trim();
    const finalCondition = customRemarks ? `${condition} — ${customRemarks}` : condition;

    const payload = {
      copy_code: document.getElementById('returnCopySelect').value,
      return_condition: finalCondition,
      fine: document.getElementById('returnFine').value,
      notes: customRemarks,
      mark_status: document.getElementById('returnMarkStatus').value
    };

    if (!payload.copy_code) {
      this.showToast('Please select a copy to return', 'error');
      return;
    }

    try {
      const res = await fetch('/api/transactions/return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to return copy');

      this.showToast(data.message, 'success');
      document.getElementById('returnBookForm').reset();
      document.getElementById('returnCopyDetailsHint').textContent = 'Select copy to view current borrower';

      // Refresh data
      this.loadCirculationDropdowns();
      this.loadActiveLoans();
      this.loadDashboardData();
      this.loadBooks();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // ==========================================
  // TAB 5: MEMBERS DIRECTORY
  // ==========================================
  async loadMembers() {
    try {
      const q = document.getElementById('memberSearchInput')?.value || '';
      const res = await fetch(`/api/members?q=${encodeURIComponent(q)}`);
      this.members = await res.json();
      this.renderMembersGrid();
    } catch (err) {
      console.error('Failed to load members:', err);
    }
  },

  renderMembersGrid() {
    const grid = document.getElementById('membersGrid');
    if (!grid) return;

    if (this.members.length === 0) {
      grid.innerHTML = `<div class="empty-state col-12"><i class="fa-solid fa-users-slash"></i><h4>No members found</h4></div>`;
      return;
    }

    grid.innerHTML = this.members.map(m => {
      const hasActive = m.active_loans_count > 0;
      return `
        <div class="member-card">
          <div class="member-card-header">
            <div>
              <span class="member-name">${this.escape(m.name)}</span>
              <span class="badge badge-secondary ml-2">${m.role}</span>
            </div>
            <span class="member-code">${m.member_code}</span>
          </div>

          <div class="member-contact-info">
            <span><i class="fa-solid fa-phone"></i> ${m.phone || 'No phone'}</span>
            <span><i class="fa-solid fa-envelope"></i> ${m.email || 'No email'}</span>
          </div>

          <div class="member-stats-row">
            <span>Active Loans: <strong class="${hasActive ? 'text-warning' : 'text-success'}">${m.active_loans_count}</strong></span>
            <span>Lifetime: <strong>${m.total_borrowed_count}</strong></span>
          </div>

          <div style="display: flex; gap: 8px; margin-top: auto;">
            <button class="btn btn-xs btn-outline btn-block" onclick="app.viewMemberHistory(${m.id}, '${this.escape(m.name)}', '${m.member_code}')">
              <i class="fa-solid fa-clock-rotate-left"></i> History
            </button>
            <button class="btn btn-xs btn-outline" onclick="app.deleteMember(${m.id}, '${this.escape(m.name)}')" title="Delete Member">
              <i class="fa-solid fa-trash text-danger"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  async handleAddMemberSubmit(e) {
    e.preventDefault();
    const payload = {
      name: document.getElementById('addMemberName').value,
      member_code: document.getElementById('addMemberCode').value,
      role: document.getElementById('addMemberRole').value,
      phone: document.getElementById('addMemberPhone').value,
      email: document.getElementById('addMemberEmail').value
    };

    try {
      const res = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register member');

      this.showToast(data.message, 'success');
      this.closeModal('modalAddMember');
      document.getElementById('addMemberForm').reset();
      this.loadMembers();
      this.loadDashboardData();
      this.loadCirculationDropdowns();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async viewMemberHistory(memberId, name, code) {
    try {
      const res = await fetch(`/api/members/${memberId}/history`);
      const history = await res.json();

      document.getElementById('modalMemberHistoryName').textContent = `${name}'s Borrowing History`;
      document.getElementById('modalMemberHistoryCode').textContent = code;

      const tbody = document.getElementById('modalMemberHistoryTableBody');
      if (history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 24px; color: var(--text-dim);">No borrowing history on record for this member yet.</td></tr>`;
      } else {
        tbody.innerHTML = history.map(h => `
          <tr>
            <td><strong class="code-tag">${h.copy_code}</strong></td>
            <td><strong>${this.escape(h.book_title)}</strong></td>
            <td>${this.formatDate(h.issue_date)}</td>
            <td>${this.formatDate(h.due_date)}</td>
            <td>${h.return_date ? this.formatDate(h.return_date) : '<span class="badge badge-warning">NOT RETURNED</span>'}</td>
            <td>${this.escape(h.return_condition || h.notes || '—')}</td>
            <td>
              ${h.status === 'ACTIVE' 
                ? '<span class="badge badge-warning">ACTIVE</span>' 
                : '<span class="badge badge-success">RETURNED</span>'
              }
            </td>
          </tr>
        `).join('');
      }

      this.openModal('modalMemberHistory');
    } catch (err) {
      this.showToast('Failed to load member history', 'error');
    }
  },

  async deleteMember(memberId, name) {
    if (!confirm(`Are you sure you want to remove member "${name}"?`)) return;

    try {
      const res = await fetch(`/api/members/${memberId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete member');

      this.showToast(data.message, 'success');
      this.loadMembers();
      this.loadDashboardData();
      this.loadCirculationDropdowns();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // ==========================================
  // TAB 6: CIRCULATION LOGS & HISTORY
  // ==========================================
  async loadHistoryLogs() {
    try {
      const res = await fetch('/api/transactions/history?limit=150');
      const logs = await res.json();

      const tbody = document.getElementById('historyLogsTableBody');
      if (!tbody) return;

      if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="padding: 24px; color: var(--text-dim);">No transaction logs recorded yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = logs.map(l => {
        const isDamaged = l.return_condition && (l.return_condition.toLowerCase().includes('torn') || l.return_condition.toLowerCase().includes('damage'));

        return `
          <tr>
            <td>#${l.id}</td>
            <td>
              <button class="btn btn-link btn-xs" onclick="app.switchTab('inspector'); app.inspectCopy('${l.copy_code}');">
                <span class="code-tag">${l.copy_code}</span>
              </button>
            </td>
            <td><strong>${this.escape(l.book_title)}</strong></td>
            <td>${this.escape(l.member_name)} <span class="badge-sub">(${l.member_code})</span></td>
            <td>${this.formatDateTime(l.issue_date)}</td>
            <td>${l.return_date ? this.formatDateTime(l.return_date) : '<span class="badge badge-warning">CURRENT LOAN</span>'}</td>
            <td>
              <span style="color: ${isDamaged ? '#ef4444' : 'var(--text-main)'}; font-weight: ${isDamaged ? '600' : 'normal'};">
                ${this.escape(l.return_condition || l.notes || '—')}
              </span>
            </td>
            <td>${l.fine > 0 ? `<span class="text-warning">₹${l.fine}</span>` : '—'}</td>
            <td>
              ${l.status === 'ACTIVE' 
                ? '<span class="badge badge-warning">ACTIVE</span>' 
                : '<span class="badge badge-success">RETURNED</span>'
              }
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load transaction logs:', err);
    }
  },

  // ==========================================
  // MODALS & UTILITIES
  // ==========================================
  openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('hidden');
  },

  closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('hidden');
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = '<i class="fa-solid fa-circle-info text-info"></i>';
    if (type === 'success') icon = '<i class="fa-solid fa-circle-check text-success"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-circle-exclamation text-danger"></i>';

    toast.innerHTML = `
      ${icon}
      <span>${this.escape(message)}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.25s';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  },

  formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + 
           d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  },

  escape(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }
};

// Auto-run when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
