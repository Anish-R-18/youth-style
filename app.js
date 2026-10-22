document.addEventListener('DOMContentLoaded', () => {
    // Form & Views
    const form = document.getElementById('order-form');
    const tableBody = document.getElementById('table-body');
    const mobileCardsContainer = document.getElementById('mobile-cards-container');
    const searchInput = document.getElementById('search');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const submitBtnText = document.getElementById('submit-btn-text');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const formHeading = document.getElementById('form-heading');
    const formSubheading = document.getElementById('form-subheading');

    // Navigation & Tabs
    const tabOrdersBtn = document.getElementById('tab-orders-btn');
    const tabNewBtn = document.getElementById('tab-new-btn');
    const tabNewText = document.getElementById('tab-new-text');
    const ordersView = document.getElementById('orders-view');
    const newOrderView = document.getElementById('new-order-view');
    const fabAddOrder = document.getElementById('fab-add-order');
    const tabOrdersCount = document.getElementById('tab-orders-count');
    const visibleOrdersCount = document.getElementById('visible-orders-count');
    const filterPills = document.querySelectorAll('.filter-pill');

    // Header stats
    const statTotalOrders = document.getElementById('stat-total-orders');
    const statTotalBalance = document.getElementById('stat-total-balance');

    // Auto-calc inputs
    const addAmountInput = document.getElementById('addAmount');
    const balanceInput = document.getElementById('balance');
    const totalAmountInput = document.getElementById('totalAmount');

    // Measurement Slip Modal
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalClose = document.getElementById('modal-close');
    const modalOrderId = document.getElementById('modal-order-id');
    const modalCustomerInfo = document.getElementById('modal-customer-info');
    const modalContent = document.getElementById('modal-content');
    const modalWhatsappBtn = document.getElementById('modal-whatsapp-btn');
    const modalPrintBtn = document.getElementById('modal-print-btn');
    const modalPaidBtn = document.getElementById('modal-paid-btn');

    // Double Confirm Delete Modal
    const deleteModalBackdrop = document.getElementById('delete-modal-backdrop');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    const deleteStepTitle = document.getElementById('delete-step-title');
    const deleteStepDesc = document.getElementById('delete-step-desc');
    const deleteOrderPreview = document.getElementById('delete-order-preview');

    let currentViewingId = null;
    let editingOrderId = null;
    let pendingDeleteRecord = null;
    let deleteConfirmationStep = 1;
    let currentFilter = 'all'; // 'all', 'pending', 'paid'

    // Load records from local storage
    let records = (JSON.parse(localStorage.getItem('tailorRecords')) || []).map(r => ({
        id: r.id || Date.now().toString(),
        name: r.name || '',
        phone: r.phone || '',
        orderId: r.orderId || '',
        deliveryDate: r.deliveryDate || '',
        shirt: r.shirt || '',
        pant: r.pant || '',
        others: r.others || '',
        addAmount: r.addAmount !== undefined ? r.addAmount : (r.advance || ''),
        balance: r.balance !== undefined ? r.balance : '',
        totalAmount: r.totalAmount !== undefined ? r.totalAmount : computeTotal(r.addAmount !== undefined ? r.addAmount : (r.advance || ''), r.balance || ''),
        date: r.date || new Date().toLocaleDateString()
    }));

    // Auto-compute Total = Balance + Advance
    function autoCalcTotal() {
        const advNum = parseNumeric(addAmountInput.value);
        const balNum = parseNumeric(balanceInput.value);
        if (addAmountInput.value.trim() !== '' || balanceInput.value.trim() !== '') {
            totalAmountInput.value = (advNum + balNum).toString();
        }
    }

    addAmountInput.addEventListener('input', autoCalcTotal);
    balanceInput.addEventListener('input', autoCalcTotal);

    // Initial render
    updateStats();
    renderAllViews();

    // Tab Navigation for Mobile
    function switchTab(target) {
        if (target === 'orders-view') {
            ordersView.classList.add('active');
            newOrderView.classList.remove('active');
            tabOrdersBtn.classList.add('active');
            tabNewBtn.classList.remove('active');
            if (fabAddOrder) fabAddOrder.style.display = 'flex';
        } else {
            ordersView.classList.remove('active');
            newOrderView.classList.add('active');
            tabOrdersBtn.classList.remove('active');
            tabNewBtn.classList.add('active');
            if (fabAddOrder) fabAddOrder.style.display = 'none';
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    tabOrdersBtn.addEventListener('click', () => switchTab('orders-view'));
    tabNewBtn.addEventListener('click', () => {
        if (!editingOrderId) resetEditState();
        switchTab('new-order-view');
    });

    if (fabAddOrder) {
        fabAddOrder.addEventListener('click', () => {
            resetEditState();
            switchTab('new-order-view');
            document.getElementById('name').focus();
        });
    }

    // Quick Filter Pills (All / Balance Due / Paid)
    filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            filterPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentFilter = pill.dataset.filter;
            renderAllViews();
        });
    });

    // Form Submission
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const name = document.getElementById('name').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const orderId = document.getElementById('orderId').value.trim();
        const deliveryDate = document.getElementById('deliveryDate').value;
        const shirt = document.getElementById('shirt').value.trim();
        const pant = document.getElementById('pant').value.trim();
        const others = document.getElementById('others').value.trim();
        const addAmount = document.getElementById('addAmount').value.trim();
        const balance = document.getElementById('balance').value.trim();
        let totalAmount = document.getElementById('totalAmount').value.trim();

        if (!totalAmount) {
            totalAmount = computeTotal(addAmount, balance);
        }

        if (name && phone && orderId) {
            if (editingOrderId) {
                const targetIndex = records.findIndex(r => r.id === editingOrderId);
                if (targetIndex !== -1) {
                    records[targetIndex] = {
                        ...records[targetIndex],
                        name,
                        phone,
                        orderId,
                        deliveryDate,
                        shirt,
                        pant,
                        others,
                        addAmount,
                        balance,
                        totalAmount
                    };
                }
                resetEditState();
            } else {
                const newRecord = {
                    id: Date.now().toString(),
                    name,
                    phone,
                    orderId,
                    deliveryDate,
                    shirt,
                    pant,
                    others,
                    addAmount,
                    balance,
                    totalAmount,
                    date: new Date().toLocaleDateString()
                };
                records.unshift(newRecord);
                form.reset();
            }

            saveRecords();
            updateStats();
            renderAllViews();

            // On mobile, auto-switch back to Orders tab to view the result
            if (window.innerWidth <= 900) {
                switchTab('orders-view');
            }
        }
    });

    cancelEditBtn.addEventListener('click', () => {
        resetEditState();
        if (window.innerWidth <= 900) {
            switchTab('orders-view');
        }
    });

    function startEdit(recordId) {
        const record = records.find(r => r.id === recordId);
        if (!record) return;

        editingOrderId = record.id;
        document.getElementById('name').value = record.name;
        document.getElementById('phone').value = record.phone;
        document.getElementById('orderId').value = record.orderId;
        document.getElementById('deliveryDate').value = record.deliveryDate || '';
        document.getElementById('shirt').value = record.shirt || '';
        document.getElementById('pant').value = record.pant || '';
        document.getElementById('others').value = record.others || '';
        document.getElementById('addAmount').value = record.addAmount || '';
        document.getElementById('balance').value = record.balance || '';
        document.getElementById('totalAmount').value = record.totalAmount || computeTotal(record.addAmount, record.balance);

        submitBtnText.textContent = 'Update Order';
        tabNewText.textContent = 'Editing...';
        formHeading.textContent = `✏️ Edit Order #${record.orderId}`;
        formSubheading.textContent = `Updating measurements for ${record.name}`;
        cancelEditBtn.classList.remove('hidden');

        // Switch to form tab and scroll
        switchTab('new-order-view');
        newOrderView.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('name').focus();
    }

    function resetEditState() {
        editingOrderId = null;
        form.reset();
        submitBtnText.textContent = 'Save Order';
        tabNewText.textContent = 'New Order';
        formHeading.textContent = '✂️ New Order / Job Card';
        formSubheading.textContent = 'Record customer measurements and payments';
        cancelEditBtn.classList.add('hidden');
    }

    // Search input handling
    searchInput.addEventListener('input', () => {
        if (searchInput.value.trim()) {
            clearSearchBtn.classList.remove('hidden');
        } else {
            clearSearchBtn.classList.add('hidden');
        }
        renderAllViews();
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        searchInput.focus();
        renderAllViews();
    });

    function getFilteredRecords() {
        const query = searchInput.value.toLowerCase().trim();
        let list = records;

        // Apply tab filter
        if (currentFilter === 'pending') {
            list = list.filter(r => !isBalanceCleared(r.balance));
        } else if (currentFilter === 'paid') {
            list = list.filter(r => isBalanceCleared(r.balance));
        }

        // Apply text search
        if (query) {
            list = list.filter(r => 
                (r.name && r.name.toLowerCase().includes(query)) ||
                (r.phone && r.phone.toLowerCase().includes(query)) ||
                (r.orderId && r.orderId.toLowerCase().includes(query)) ||
                (r.shirt && r.shirt.toLowerCase().includes(query)) ||
                (r.pant && r.pant.toLowerCase().includes(query)) ||
                (r.others && r.others.toLowerCase().includes(query)) ||
                (r.balance && r.balance.toLowerCase().includes(query)) ||
                (r.totalAmount && r.totalAmount.toLowerCase().includes(query))
            );
        }

        return list;
    }

    function renderAllViews() {
        const filtered = getFilteredRecords();
        visibleOrdersCount.textContent = filtered.length;
        tabOrdersCount.textContent = records.length;
        renderDesktopTable(filtered);
        renderMobileCards(filtered);
    }

    // Click delegation for actions on both table and mobile cards
    function handleActionClick(e) {
        const viewBtn = e.target.closest('.btn-view');
        const editBtn = e.target.closest('.btn-edit');
        const deleteBtn = e.target.closest('.btn-danger');

        if (viewBtn) {
            openModal(viewBtn.dataset.id);
        } else if (editBtn) {
            startEdit(editBtn.dataset.id);
        } else if (deleteBtn) {
            openDoubleConfirmDelete(deleteBtn.dataset.id);
        }
    }

    tableBody.addEventListener('click', handleActionClick);
    mobileCardsContainer.addEventListener('click', handleActionClick);

    // Double Confirm Delete Logic
    function openDoubleConfirmDelete(id) {
        const record = records.find(r => r.id === id);
        if (!record) return;

        pendingDeleteRecord = record;
        deleteConfirmationStep = 1;

        deleteStepTitle.textContent = '⚠️ Confirm Deletion (1/2)';
        deleteStepDesc.textContent = `Are you sure you want to delete order #${record.orderId}?`;
        deleteOrderPreview.innerHTML = `
            <strong>Order #${escapeHTML(record.orderId)}</strong> &bull; ${escapeHTML(record.name)}<br>
            <span style="color:var(--text-muted);font-size:0.8rem;">Phone: ${escapeHTML(record.phone)} | Balance: ₹${escapeHTML(record.balance || '0')}</span>
        `;

        confirmDeleteBtn.textContent = 'Yes, Proceed to Delete';
        confirmDeleteBtn.className = 'btn-danger-solid';

        deleteModalBackdrop.classList.remove('hidden');
    }

    confirmDeleteBtn.addEventListener('click', () => {
        if (!pendingDeleteRecord) return;

        if (deleteConfirmationStep === 1) {
            deleteConfirmationStep = 2;
            deleteStepTitle.textContent = '🚨 Final Confirmation (2/2)';
            deleteStepDesc.textContent = `PERMANENT: Delete order #${pendingDeleteRecord.orderId} for "${pendingDeleteRecord.name}" permanently?`;
            confirmDeleteBtn.textContent = 'Permanently Delete Now';
            confirmDeleteBtn.className = 'btn-danger-solid stage-2';
        } else if (deleteConfirmationStep === 2) {
            records = records.filter(record => record.id !== pendingDeleteRecord.id);
            if (editingOrderId === pendingDeleteRecord.id) {
                resetEditState();
            }
            saveRecords();
            updateStats();
            renderAllViews();
            closeDeleteModal();
        }
    });

    cancelDeleteBtn.addEventListener('click', closeDeleteModal);
    deleteModalBackdrop.addEventListener('click', (e) => {
        if (e.target === deleteModalBackdrop) closeDeleteModal();
    });

    function closeDeleteModal() {
        deleteModalBackdrop.classList.add('hidden');
        pendingDeleteRecord = null;
        deleteConfirmationStep = 1;
    }

    // Modal Events
    modalClose.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!modalBackdrop.classList.contains('hidden')) closeModal();
            if (!deleteModalBackdrop.classList.contains('hidden')) closeDeleteModal();
        }
    });

    modalPrintBtn.addEventListener('click', () => {
        window.print();
    });

    modalPaidBtn.addEventListener('click', () => {
        if (!currentViewingId) return;
        const target = records.find(r => r.id === currentViewingId);
        if (target) {
            target.balance = '0';
            target.totalAmount = computeTotal(target.addAmount, target.balance);
            saveRecords();
            updateStats();
            renderAllViews();
            openModal(currentViewingId);
        }
    });

    // WhatsApp Direct Share for Tailor Slips
    modalWhatsappBtn.addEventListener('click', () => {
        if (!currentViewingId) return;
        const record = records.find(r => r.id === currentViewingId);
        if (!record) return;

        const totalDisplay = record.totalAmount || computeTotal(record.addAmount, record.balance);
        const text = `*Youth Style - Tailor Order Slip* ✂️
Order #: ${record.orderId}
Customer: ${record.name}
${record.deliveryDate ? `Delivery Date: ${formatDate(record.deliveryDate)}` : ''}

*Payment Details:*
• Total: ₹${totalDisplay}
• Advance Paid: ₹${record.addAmount || '0'}
• Balance Due: ₹${record.balance || '0'}

${record.shirt ? `*Shirt:* ${record.shirt}\n` : ''}${record.pant ? `*Pant:* ${record.pant}\n` : ''}${record.others ? `*Notes:* ${record.others}\n` : ''}
Thank you for choosing Youth Style!`;

        const cleanPhone = record.phone.replace(/[^0-9]/g, '');
        const waUrl = cleanPhone.length >= 10
            ? `https://wa.me/91${cleanPhone.slice(-10)}?text=${encodeURIComponent(text)}`
            : `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(waUrl, '_blank');
    });

    function openModal(id) {
        const record = records.find(r => r.id === id);
        if (!record) return;

        currentViewingId = id;
        modalOrderId.textContent = `Order Slip #${record.orderId}`;
        modalCustomerInfo.textContent = `${record.name} | Phone: ${record.phone} | Created: ${record.date}`;

        const isPaid = isBalanceCleared(record.balance);
        modalPaidBtn.style.display = isPaid ? 'none' : 'inline-flex';

        const totalDisplay = record.totalAmount || computeTotal(record.addAmount, record.balance);

        modalContent.innerHTML = `
            <div class="slip-detail-grid">
                <div class="slip-detail-item">
                    <span class="slip-label">Total Bill</span>
                    <span class="slip-val" style="color:#38bdf8; font-size:1.15rem; font-family:'JetBrains Mono',monospace;">₹ ${escapeHTML(totalDisplay)}</span>
                </div>
                <div class="slip-detail-item">
                    <span class="slip-label">Advance (Add) Paid</span>
                    <span class="slip-val">${record.addAmount ? `₹ ${escapeHTML(record.addAmount)}` : 'None'}</span>
                </div>
                <div class="slip-detail-item">
                    <span class="slip-label">Balance Remaining</span>
                    <span class="slip-val ${isPaid ? 'badge badge-paid' : 'badge badge-balance'}">
                        ${isPaid ? '✓ Paid in Full' : `₹ ${escapeHTML(record.balance)}`}
                    </span>
                </div>
                <div class="slip-detail-item">
                    <span class="slip-label">Delivery Date</span>
                    <span class="slip-val">${record.deliveryDate ? formatDate(record.deliveryDate) : 'Not specified'}</span>
                </div>
                <div class="slip-detail-item" style="grid-column: 1 / -1;">
                    <span class="slip-label">Customer Contact</span>
                    <span class="slip-val">
                        <a href="tel:${escapeHTML(record.phone)}" style="color:#93c5fd; text-decoration:none; display:inline-flex; align-items:center; gap:0.3rem;">
                            📞 Call ${escapeHTML(record.phone)}
                        </a>
                    </span>
                </div>
            </div>

            <div class="measurement-card">
                <div class="measurement-card-title">👔 Shirt Measurements & Notes</div>
                <div class="measurement-card-content">${record.shirt ? escapeHTML(record.shirt) : '<em>No shirt measurements noted</em>'}</div>
            </div>

            <div class="measurement-card">
                <div class="measurement-card-title">👖 Pant Measurements & Notes</div>
                <div class="measurement-card-content">${record.pant ? escapeHTML(record.pant) : '<em>No pant measurements noted</em>'}</div>
            </div>

            <div class="measurement-card">
                <div class="measurement-card-title">🧵 Others / Special Instructions</div>
                <div class="measurement-card-content">${record.others ? escapeHTML(record.others) : '<em>No additional items or instructions</em>'}</div>
            </div>
        `;

        modalBackdrop.classList.remove('hidden');
    }

    function closeModal() {
        modalBackdrop.classList.add('hidden');
        currentViewingId = null;
    }

    function saveRecords() {
        localStorage.setItem('tailorRecords', JSON.stringify(records));
    }

    function updateStats() {
        statTotalOrders.textContent = records.length;
        let totalBalance = 0;
        records.forEach(r => {
            if (r.balance) {
                totalBalance += parseNumeric(r.balance);
            }
        });
        statTotalBalance.textContent = `₹${totalBalance.toLocaleString()}`;
    }

    // Render Desktop Table
    function renderDesktopTable(data) {
        tableBody.innerHTML = '';

        if (data.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">No matching orders found.</td>
                </tr>
            `;
            return;
        }

        data.forEach(record => {
            const row = document.createElement('tr');
            const totalDisplay = record.totalAmount || computeTotal(record.addAmount, record.balance);
            const isPaid = isBalanceCleared(record.balance);
            const balanceHtml = isPaid
                ? `<span class="badge badge-paid">✓ Paid</span>`
                : `<span class="badge badge-balance">₹ ${escapeHTML(record.balance || 'Due')}</span>`;

            let chips = '';
            if (record.shirt) chips += `<span class="chip chip-shirt">Shirt</span>`;
            if (record.pant) chips += `<span class="chip chip-pant">Pant</span>`;
            if (record.others) chips += `<span class="chip chip-others">Others</span>`;
            if (!chips) chips = `<span style="color:var(--text-dim);font-size:0.75rem;">None</span>`;

            row.innerHTML = `
                <td><span class="order-pill">${escapeHTML(record.orderId)}</span></td>
                <td>
                    <div class="customer-cell">
                        <span class="customer-name">${escapeHTML(record.name)}</span>
                        <a href="tel:${escapeHTML(record.phone)}" class="customer-phone" style="text-decoration:none;">${escapeHTML(record.phone)}</a>
                    </div>
                </td>
                <td><span style="font-size:0.82rem; color:var(--text-muted);">${record.deliveryDate ? formatDate(record.deliveryDate) : '-'}</span></td>
                <td><span class="total-pill">₹ ${escapeHTML(totalDisplay)}</span></td>
                <td><strong>₹ ${record.addAmount ? escapeHTML(record.addAmount) : '0'}</strong></td>
                <td>${balanceHtml}</td>
                <td><div class="chips-container">${chips}</div></td>
                <td>
                    <div class="action-buttons">
                        <button type="button" class="btn-icon-sm btn-view" data-id="${record.id}" title="View Slip">👁️ Slip</button>
                        <button type="button" class="btn-icon-sm btn-edit" data-id="${record.id}" title="Edit Order">✏️</button>
                        <button type="button" class="btn-icon-sm btn-danger" data-id="${record.id}" title="Delete">🗑️</button>
                    </div>
                </td>
            `;

            tableBody.appendChild(row);
        });
    }

    // Render Mobile Cards (Designed specifically for Mobile Touch Screens)
    function renderMobileCards(data) {
        mobileCardsContainer.innerHTML = '';

        if (data.length === 0) {
            mobileCardsContainer.innerHTML = `
                <div class="empty-state glass-panel">
                    <p style="font-size:1.1rem; margin-bottom:0.5rem;">🔍 No orders found</p>
                    <p style="font-size:0.85rem; color:var(--text-dim);">Tap "+ New Order" to create one.</p>
                </div>
            `;
            return;
        }

        data.forEach(record => {
            const card = document.createElement('div');
            const isPaid = isBalanceCleared(record.balance);
            card.className = `order-card ${isPaid ? 'is-paid' : 'has-balance'}`;

            const totalDisplay = record.totalAmount || computeTotal(record.addAmount, record.balance);

            let chips = '';
            if (record.shirt) chips += `<span class="chip chip-shirt">Shirt</span>`;
            if (record.pant) chips += `<span class="chip chip-pant">Pant</span>`;
            if (record.others) chips += `<span class="chip chip-others">Others</span>`;

            card.innerHTML = `
                <div class="card-top">
                    <span class="card-order-num">#${escapeHTML(record.orderId)}</span>
                    <span class="card-delivery-badge">
                        📅 ${record.deliveryDate ? formatDate(record.deliveryDate) : 'No date'}
                    </span>
                </div>

                <div class="card-customer-row">
                    <div>
                        <div class="card-name">${escapeHTML(record.name)}</div>
                        <div class="card-items-preview" style="margin-top:0.25rem;">${chips}</div>
                    </div>
                    <a href="tel:${escapeHTML(record.phone)}" class="card-phone-btn" title="Call Customer">
                        📞 Call
                    </a>
                </div>

                <div class="card-billing-row">
                    <div class="card-bill-item">
                        <span class="card-bill-label">Total</span>
                        <span class="card-bill-val" style="color:#38bdf8;">₹${escapeHTML(totalDisplay)}</span>
                    </div>
                    <div class="card-bill-item">
                        <span class="card-bill-label">Advance</span>
                        <span class="card-bill-val">₹${escapeHTML(record.addAmount || '0')}</span>
                    </div>
                    <div class="card-bill-item">
                        <span class="card-bill-label">Balance</span>
                        <span class="card-bill-val ${isPaid ? 'badge-paid' : 'badge-balance'}" style="background:transparent; padding:0;">
                            ${isPaid ? '✓ Paid' : `₹${escapeHTML(record.balance)}`}
                        </span>
                    </div>
                </div>

                <div class="card-actions">
                    <button type="button" class="btn-icon-sm btn-view" data-id="${record.id}">
                        👁️ View Slip
                    </button>
                    <button type="button" class="btn-icon-sm btn-edit" data-id="${record.id}">
                        ✏️ Edit
                    </button>
                    <button type="button" class="btn-icon-sm btn-danger" data-id="${record.id}">
                        🗑️
                    </button>
                </div>
            `;

            mobileCardsContainer.appendChild(card);
        });
    }

    function computeTotal(adv, bal) {
        const advNum = parseNumeric(adv);
        const balNum = parseNumeric(bal);
        return (advNum + balNum).toString();
    }

    function parseNumeric(val) {
        if (!val) return 0;
        const cleaned = val.toString().replace(/[^0-9.]/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    }

    function isBalanceCleared(bal) {
        if (!bal) return true;
        const trimmed = bal.toString().trim().toLowerCase();
        if (trimmed === '0' || trimmed === '0.00' || trimmed === 'paid' || trimmed === 'nil' || trimmed === 'none') {
            return true;
        }
        return parseNumeric(trimmed) === 0;
    }

    function formatDate(dateStr) {
        try {
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                const d = new Date(parts[0], parts[1] - 1, parts[2]);
                return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            }
            return dateStr;
        } catch (e) {
            return dateStr;
        }
    }

    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag])
        );
    }
});
