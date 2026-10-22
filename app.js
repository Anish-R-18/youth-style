document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('order-form');
    const tableBody = document.getElementById('table-body');
    const searchInput = document.getElementById('search');
    const submitBtnText = document.getElementById('submit-btn-text');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    
    // Header stats
    const statTotalOrders = document.getElementById('stat-total-orders');
    const statTotalBalance = document.getElementById('stat-total-balance');

    // Input fields for auto total calculation
    const addAmountInput = document.getElementById('addAmount');
    const balanceInput = document.getElementById('balance');
    const totalAmountInput = document.getElementById('totalAmount');

    // Modal elements for Measurement Slip
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalClose = document.getElementById('modal-close');
    const modalOrderId = document.getElementById('modal-order-id');
    const modalCustomerInfo = document.getElementById('modal-customer-info');
    const modalContent = document.getElementById('modal-content');
    const modalPrintBtn = document.getElementById('modal-print-btn');
    const modalPaidBtn = document.getElementById('modal-paid-btn');

    // Double Confirm Delete Modal elements
    const deleteModalBackdrop = document.getElementById('delete-modal-backdrop');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    const deleteStepTitle = document.getElementById('delete-step-title');
    const deleteStepDesc = document.getElementById('delete-step-desc');
    const deleteOrderPreview = document.getElementById('delete-order-preview');

    let currentViewingId = null;
    let editingOrderId = null; // null when creating new, contains record id when editing
    let pendingDeleteRecord = null;
    let deleteConfirmationStep = 1; // Step 1 -> Step 2 (Double Confirm)

    // Load records from local storage with schema compatibility
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

    // Auto calculate Total Amount = Balance + Advance
    function autoCalcTotal() {
        const advNum = parseNumeric(addAmountInput.value);
        const balNum = parseNumeric(balanceInput.value);
        if (addAmountInput.value.trim() !== '' || balanceInput.value.trim() !== '') {
            const sum = advNum + balNum;
            totalAmountInput.value = sum.toString();
        }
    }

    addAmountInput.addEventListener('input', autoCalcTotal);
    balanceInput.addEventListener('input', autoCalcTotal);

    // Initial render
    updateStats();
    renderTable(records);

    // Form submission (handles both Create and Edit)
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
                // Update existing record
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
                // Create new record
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
            applyCurrentSearch();
        }
    });

    // Cancel editing
    cancelEditBtn.addEventListener('click', () => {
        resetEditState();
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
        cancelEditBtn.classList.remove('hidden');

        // Scroll to form smoothly
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('name').focus();
    }

    function resetEditState() {
        editingOrderId = null;
        form.reset();
        submitBtnText.textContent = 'Save Order';
        cancelEditBtn.classList.add('hidden');
    }

    // Search functionality across customer, order ID, and notes
    searchInput.addEventListener('input', () => {
        applyCurrentSearch();
    });

    function applyCurrentSearch() {
        const query = searchInput.value.toLowerCase().trim();
        if (!query) {
            renderTable(records);
            return;
        }

        const filtered = records.filter(r => 
            (r.name && r.name.toLowerCase().includes(query)) ||
            (r.phone && r.phone.toLowerCase().includes(query)) ||
            (r.orderId && r.orderId.toLowerCase().includes(query)) ||
            (r.shirt && r.shirt.toLowerCase().includes(query)) ||
            (r.pant && r.pant.toLowerCase().includes(query)) ||
            (r.others && r.others.toLowerCase().includes(query)) ||
            (r.balance && r.balance.toLowerCase().includes(query)) ||
            (r.totalAmount && r.totalAmount.toLowerCase().includes(query))
        );

        renderTable(filtered);
    }

    // Table click actions (View Details, Edit, or Double-Confirm Delete)
    tableBody.addEventListener('click', (e) => {
        const viewBtn = e.target.closest('.btn-view');
        const editBtn = e.target.closest('.btn-edit');
        const deleteBtn = e.target.closest('.btn-danger');

        if (viewBtn) {
            const id = viewBtn.dataset.id;
            openModal(id);
        } else if (editBtn) {
            const id = editBtn.dataset.id;
            startEdit(id);
        } else if (deleteBtn) {
            const idToDelete = deleteBtn.dataset.id;
            openDoubleConfirmDelete(idToDelete);
        }
    });

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
            // Move to Step 2: Double Confirm
            deleteConfirmationStep = 2;
            deleteStepTitle.textContent = '🚨 Final Confirmation (2/2)';
            deleteStepDesc.textContent = `PERMANENT ACTION: Are you 100% sure? All measurements and billing records for "${pendingDeleteRecord.name}" will be erased.`;
            confirmDeleteBtn.textContent = 'Permanently Delete Now';
            confirmDeleteBtn.className = 'btn-danger-solid stage-2';
        } else if (deleteConfirmationStep === 2) {
            // Execute deletion
            records = records.filter(record => record.id !== pendingDeleteRecord.id);
            if (editingOrderId === pendingDeleteRecord.id) {
                resetEditState();
            }
            saveRecords();
            updateStats();
            applyCurrentSearch();
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
            // Also ensure total reflects
            target.totalAmount = computeTotal(target.addAmount, target.balance);
            saveRecords();
            updateStats();
            applyCurrentSearch();
            openModal(currentViewingId); // Refresh modal view
        }
    });

    function openModal(id) {
        const record = records.find(r => r.id === id);
        if (!record) return;

        currentViewingId = id;
        modalOrderId.textContent = `Order Slip #${record.orderId}`;
        modalCustomerInfo.textContent = `${record.name} | Phone: ${record.phone} | Created: ${record.date}`;

        const isPaid = isBalanceCleared(record.balance);
        modalPaidBtn.style.display = isPaid ? 'none' : 'inline-block';

        const totalDisplay = record.totalAmount || computeTotal(record.addAmount, record.balance);

        modalContent.innerHTML = `
            <div class="slip-detail-grid">
                <div class="slip-detail-item">
                    <span class="slip-label">Total Amount</span>
                    <span class="slip-val" style="color:#38bdf8; font-size:1.1rem;">₹ ${escapeHTML(totalDisplay)}</span>
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
                    <span class="slip-val"><a href="tel:${escapeHTML(record.phone)}" style="color:#93c5fd; text-decoration:none;">📞 ${escapeHTML(record.phone)}</a></span>
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

        // Calculate sum of pending numeric balances
        let totalBalance = 0;
        records.forEach(r => {
            if (r.balance) {
                const num = parseNumeric(r.balance);
                totalBalance += num;
            }
        });

        statTotalBalance.textContent = `₹${totalBalance.toLocaleString()}`;
    }

    function renderTable(data) {
        tableBody.innerHTML = '';

        if (data.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">No matching tailor orders found.</td>
                </tr>
            `;
            return;
        }

        data.forEach(record => {
            const row = document.createElement('tr');

            // Compute total amount if missing
            const totalDisplay = record.totalAmount || computeTotal(record.addAmount, record.balance);

            // Balance badge
            const isPaid = isBalanceCleared(record.balance);
            const balanceHtml = isPaid
                ? `<span class="badge badge-paid">✓ Paid</span>`
                : `<span class="badge badge-balance">₹ ${escapeHTML(record.balance || 'Due')}</span>`;

            // Chips for items present
            let chips = '';
            if (record.shirt) chips += `<span class="chip chip-shirt" title="${escapeHTML(record.shirt)}">Shirt</span>`;
            if (record.pant) chips += `<span class="chip chip-pant" title="${escapeHTML(record.pant)}">Pant</span>`;
            if (record.others) chips += `<span class="chip chip-others" title="${escapeHTML(record.others)}">Others</span>`;
            if (!chips) chips = `<span style="color:var(--text-dim);font-size:0.75rem;">None</span>`;

            row.innerHTML = `
                <td><span class="order-pill">${escapeHTML(record.orderId)}</span></td>
                <td>
                    <div class="customer-cell">
                        <span class="customer-name">${escapeHTML(record.name)}</span>
                        <span class="customer-phone">${escapeHTML(record.phone)}</span>
                    </div>
                </td>
                <td><span style="font-size:0.82rem; color:var(--text-muted);">${record.deliveryDate ? formatDate(record.deliveryDate) : '-'}</span></td>
                <td><span class="total-pill">₹ ${escapeHTML(totalDisplay)}</span></td>
                <td><strong>${record.addAmount ? escapeHTML(record.addAmount) : '0'}</strong></td>
                <td>${balanceHtml}</td>
                <td><div class="chips-container">${chips}</div></td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon-sm btn-view" data-id="${record.id}" title="View Measurements & Slip">👁️ Slip</button>
                        <button class="btn-icon-sm btn-edit" data-id="${record.id}" title="Edit Order & Measurements">✏️ Edit</button>
                        <button class="btn-icon-sm btn-danger" data-id="${record.id}" title="Delete Order">🗑️</button>
                    </div>
                </td>
            `;

            tableBody.appendChild(row);
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
        const num = parseNumeric(trimmed);
        return num === 0;
    }

    function formatDate(dateStr) {
        try {
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                const d = new Date(parts[0], parts[1] - 1, parts[2]);
                return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            }
            return dateStr;
        } catch (e) {
            return dateStr;
        }
    }

    // Utility to prevent XSS
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
