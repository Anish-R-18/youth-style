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

    // Export & Import Backup elements
    const exportBackupBtn = document.getElementById('export-backup-btn');
    const importBackupFile = document.getElementById('import-backup-file');
    const importModalBackdrop = document.getElementById('import-modal-backdrop');
    const importSummaryText = document.getElementById('import-summary-text');
    const importPreviewBox = document.getElementById('import-preview-box');
    const importMergeBtn = document.getElementById('import-merge-btn');
    const importReplaceBtn = document.getElementById('import-replace-btn');
    const importCancelBtn = document.getElementById('import-cancel-btn');

    // Print / PDF Choice Dialog elements
    const printChoiceBackdrop = document.getElementById('print-choice-backdrop');
    const printWithMeasurementsBtn = document.getElementById('print-with-measurements-btn');
    const printWithoutMeasurementsBtn = document.getElementById('print-without-measurements-btn');
    const printCancelBtn = document.getElementById('print-cancel-btn');

    // Particulars elements
    const particularsList = document.getElementById('particulars-list');
    const addParticularBtn = document.getElementById('add-particular-btn');
    const particularsTotalEl = document.getElementById('particulars-total');

    // WhatsApp 3-Choice Modal elements
    const whatsappChoiceBackdrop = document.getElementById('whatsapp-choice-backdrop');
    const waChoicePdfBtn = document.getElementById('wa-choice-pdf-btn');
    const waChoiceSmsBtn = document.getElementById('wa-choice-sms-btn');
    const waChoiceCancelBtn = document.getElementById('wa-choice-cancel-btn');
    const waModalSubtitle = document.getElementById('wa-modal-subtitle');

    let currentViewingId = null;
    let activeWhatsAppRecord = null;
    let editingOrderId = null;
    let pendingDeleteRecord = null;
    let pendingImportRecords = null;
    let deleteConfirmationStep = 1;
    let currentFilter = 'all'; // 'all', 'pending', 'paid'

    // Load records from local storage
    let records = (JSON.parse(localStorage.getItem('tailorRecords')) || []).map(r => ({
        id: r.id || Date.now().toString(),
        name: r.name || '',
        phone: r.phone || '',
        orderId: r.orderId || '',
        deliveryDate: r.deliveryDate || '',
        bookedDate: r.bookedDate || '',
        particulars: Array.isArray(r.particulars) ? r.particulars : [],
        shirt: r.shirt || '',
        pant: r.pant || '',
        others: r.others || '',
        addAmount: r.addAmount !== undefined ? r.addAmount : (r.advance || ''),
        balance: r.balance !== undefined ? r.balance : '',
        totalAmount: r.totalAmount !== undefined ? r.totalAmount : computeTotal(r.addAmount !== undefined ? r.addAmount : (r.advance || ''), r.balance || ''),
        date: r.date || new Date().toLocaleDateString()
    }));

    // Auto-compute Balance = Total Amount - Advance
    function autoCalcBalance() {
        const totNum = parseNumeric(totalAmountInput.value);
        const advNum = parseNumeric(addAmountInput.value);

        if (totalAmountInput.value.trim() !== '') {
            const bal = Math.max(0, totNum - advNum);
            balanceInput.value = bal.toString();
        }
    }

    totalAmountInput.addEventListener('input', autoCalcBalance);
    addAmountInput.addEventListener('input', autoCalcBalance);

    // ---- Particulars: dynamic rows of (item text + count) ----
    function addParticularRow(item = '', count = '') {
        const row = document.createElement('div');
        row.className = 'particular-row';
        row.innerHTML = `
            <input type="text" class="particular-item" placeholder="e.g. Shirt stitching" value="${escapeHTML(String(item))}" aria-label="Particular">
            <input type="number" class="particular-count" min="0" inputmode="numeric" placeholder="Count" value="${escapeHTML(String(count))}" aria-label="Count">
            <button type="button" class="particular-remove" aria-label="Remove particular">&times;</button>
        `;
        particularsList.appendChild(row);
    }

    function getParticulars() {
        return Array.from(particularsList.querySelectorAll('.particular-row'))
            .map(row => ({
                item: row.querySelector('.particular-item').value.trim(),
                count: row.querySelector('.particular-count').value.trim()
            }))
            .filter(p => p.item || p.count);
    }

    function setParticulars(list) {
        particularsList.innerHTML = '';
        const items = Array.isArray(list) && list.length ? list : [{ item: '', count: '' }];
        items.forEach(p => addParticularRow(p.item, p.count));
        updateParticularsTotal();
    }

    function updateParticularsTotal() {
        const total = getParticulars().reduce((sum, p) => sum + parseNumeric(p.count), 0);
        particularsTotalEl.textContent = total;
    }

    particularsList.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.particular-remove');
        if (!removeBtn) return;
        const row = removeBtn.closest('.particular-row');
        if (particularsList.querySelectorAll('.particular-row').length <= 1) {
            // Keep one empty row instead of removing the last one
            row.querySelector('.particular-item').value = '';
            row.querySelector('.particular-count').value = '';
        } else {
            row.remove();
        }
        updateParticularsTotal();
    });
    particularsList.addEventListener('input', updateParticularsTotal);

    addParticularBtn.addEventListener('click', () => {
        addParticularRow();
        const inputs = particularsList.querySelectorAll('.particular-item');
        inputs[inputs.length - 1].focus();
    });

    function todayISO() {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        return now.toISOString().slice(0, 10);
    }

    // Clears the form, restores one empty particular row and defaults Booked Date to today
    function resetFormFields() {
        form.reset();
        setParticulars([]);
        document.getElementById('bookedDate').value = todayISO();
    }

    // Initial render
    resetFormFields();
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
        const bookedDate = document.getElementById('bookedDate').value;
        const particulars = getParticulars();
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
                        bookedDate,
                        particulars,
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
                    bookedDate,
                    particulars,
                    shirt,
                    pant,
                    others,
                    addAmount,
                    balance,
                    totalAmount,
                    date: new Date().toLocaleDateString()
                };
                records.unshift(newRecord);
                resetFormFields();
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
        document.getElementById('bookedDate').value = record.bookedDate || '';
        setParticulars(record.particulars);
        document.getElementById('shirt').value = record.shirt || '';
        document.getElementById('pant').value = record.pant || '';
        document.getElementById('others').value = record.others || '';
        document.getElementById('addAmount').value = record.addAmount || '';
        document.getElementById('balance').value = record.balance || '';
        document.getElementById('totalAmount').value = record.totalAmount || computeTotal(record.addAmount, record.balance);

        submitBtnText.textContent = 'Update Order';
        tabNewText.textContent = 'Editing...';
        formHeading.textContent = `✏️ Edit Serial Number ${record.orderId}`;
        formSubheading.textContent = `Updating customer details for ${record.name}`;
        cancelEditBtn.classList.remove('hidden');

        // Switch to form tab and scroll
        switchTab('new-order-view');
        newOrderView.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('name').focus();
    }

    function resetEditState() {
        editingOrderId = null;
        resetFormFields();
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
                (Array.isArray(r.particulars) && r.particulars.some(p => (p.item || '').toLowerCase().includes(query))) ||
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
        const waBtn = e.target.closest('.btn-whatsapp-action');
        const editBtn = e.target.closest('.btn-edit');
        const deleteBtn = e.target.closest('.btn-danger');

        if (viewBtn) {
            openModal(viewBtn.dataset.id);
        } else if (waBtn) {
            const record = records.find(r => r.id === waBtn.dataset.id);
            if (record) openWhatsAppChoiceModal(record);
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
        deleteStepDesc.textContent = `Are you sure you want to delete Serial Number ${record.orderId}?`;
        deleteOrderPreview.innerHTML = `
            <strong>Serial Number: ${escapeHTML(record.orderId)}</strong> &bull; Customer Name: ${escapeHTML(record.name)}<br>
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
            deleteStepDesc.textContent = `PERMANENT: Delete Serial Number ${pendingDeleteRecord.orderId} for "${pendingDeleteRecord.name}" permanently?`;
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

    // Export Backup functionality (Downloads structured JSON file)
    exportBackupBtn.addEventListener('click', () => {
        if (records.length === 0) {
            alert('No records to export yet. Add at least one order first.');
            return;
        }

        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `youth-style-backup-${dateStr}.json`;
        const backupData = {
            appName: 'Youth Style - Tailor Manager',
            version: '1.0',
            exportedAt: new Date().toISOString(),
            recordCount: records.length,
            records: records
        };

        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    });

    // Import Backup functionality (Reads JSON and shows confirmation)
    importBackupFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsed = JSON.parse(event.target.result);
                let importedList = [];

                if (Array.isArray(parsed)) {
                    importedList = parsed;
                } else if (parsed && Array.isArray(parsed.records)) {
                    importedList = parsed.records;
                } else {
                    throw new Error('Invalid format: Could not find orders list.');
                }

                // Sanitize and normalize imported records
                pendingImportRecords = importedList.map(r => ({
                    id: r.id ? r.id.toString() : Date.now().toString() + Math.random().toString(36).substr(2, 4),
                    name: r.name || 'Unnamed',
                    phone: r.phone || '',
                    orderId: r.orderId || 'ORD',
                    deliveryDate: r.deliveryDate || '',
                    bookedDate: r.bookedDate || '',
                    particulars: Array.isArray(r.particulars) ? r.particulars : [],
                    shirt: r.shirt || '',
                    pant: r.pant || '',
                    others: r.others || '',
                    addAmount: r.addAmount !== undefined ? r.addAmount : (r.advance || ''),
                    balance: r.balance !== undefined ? r.balance : '',
                    totalAmount: r.totalAmount !== undefined ? r.totalAmount : computeTotal(r.addAmount || r.advance, r.balance),
                    date: r.date || new Date().toLocaleDateString()
                }));

                openImportModal(pendingImportRecords.length, file.name);
            } catch (err) {
                alert('Failed to read backup file. Please make sure it is a valid JSON backup file.');
                console.error(err);
            } finally {
                importBackupFile.value = ''; // Reset file input so same file can be picked again
            }
        };

        reader.readAsText(file);
    });

    function openImportModal(count, fileName) {
        importSummaryText.textContent = `Found ${count} order(s) in "${fileName}".`;
        importPreviewBox.innerHTML = `
            <strong>File: ${escapeHTML(fileName)}</strong><br>
            <span style="color:var(--text-muted); font-size:0.82rem;">
                New Orders to Import: <strong>${count}</strong> | Current Orders: <strong>${records.length}</strong>
            </span>
        `;
        importModalBackdrop.classList.remove('hidden');
    }

    function closeImportModal() {
        importModalBackdrop.classList.add('hidden');
        pendingImportRecords = null;
    }

    // Import Merge: Add new orders, updating matching orderIds or appending new
    importMergeBtn.addEventListener('click', () => {
        if (!pendingImportRecords) return;

        const existingMap = new Map();
        records.forEach(r => existingMap.set(r.id, r));

        pendingImportRecords.forEach(r => {
            // If an order with same ID or orderId exists, update it, else add
            const existingById = records.findIndex(e => e.id === r.id);
            if (existingById !== -1) {
                records[existingById] = r;
            } else {
                records.unshift(r);
            }
        });

        saveRecords();
        updateStats();
        renderAllViews();
        closeImportModal();
        alert(`Successfully merged backup records! Total orders: ${records.length}`);
    });

    // Import Replace: Overwrite current orders completely
    importReplaceBtn.addEventListener('click', () => {
        if (!pendingImportRecords) return;

        if (confirm(`WARNING: This will replace all ${records.length} current order(s) with ${pendingImportRecords.length} order(s) from the backup file. Proceed?`)) {
            records = pendingImportRecords;
            saveRecords();
            updateStats();
            renderAllViews();
            closeImportModal();
            alert(`Successfully replaced records! Loaded ${records.length} orders.`);
        }
    });

    importCancelBtn.addEventListener('click', closeImportModal);
    importModalBackdrop.addEventListener('click', (e) => {
        if (e.target === importModalBackdrop) closeImportModal();
    });

    // Modal Events
    modalClose.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!printChoiceBackdrop.classList.contains('hidden')) closePrintChoiceModal();
            else if (!modalBackdrop.classList.contains('hidden')) closeModal();
            if (!deleteModalBackdrop.classList.contains('hidden')) closeDeleteModal();
            if (!importModalBackdrop.classList.contains('hidden')) closeImportModal();
        }
    });

    // Print Button opens choice modal (With Measurements, Without Measurements, Cancel)
    modalPrintBtn.addEventListener('click', () => {
        openPrintChoiceModal();
    });

    function openPrintChoiceModal() {
        printChoiceBackdrop.classList.remove('hidden');
    }

    function closePrintChoiceModal() {
        printChoiceBackdrop.classList.add('hidden');
    }

    printCancelBtn.addEventListener('click', closePrintChoiceModal);
    printChoiceBackdrop.addEventListener('click', (e) => {
        if (e.target === printChoiceBackdrop) closePrintChoiceModal();
    });

    function printRecordSlip(record, withMeasurements) {
        let stage = document.getElementById('print-stage');
        if (!stage) {
            stage = document.createElement('div');
            stage.id = 'print-stage';
            stage.className = 'print-stage';
            document.body.appendChild(stage);
        }

        stage.innerHTML = '';
        const bill = buildBillElement(record, withMeasurements);
        stage.appendChild(bill);

        setTimeout(() => {
            window.print();
        }, 150);
    }

    printWithMeasurementsBtn.addEventListener('click', () => {
        closePrintChoiceModal();
        if (!currentViewingId) return;
        const record = records.find(r => r.id === currentViewingId);
        if (!record) return;
        printRecordSlip(record, true);
    });

    printWithoutMeasurementsBtn.addEventListener('click', () => {
        closePrintChoiceModal();
        if (!currentViewingId) return;
        const record = records.find(r => r.id === currentViewingId);
        if (!record) return;
        printRecordSlip(record, false);
    });

    modalPaidBtn.addEventListener('click', () => {
        if (!currentViewingId) return;
        const target = records.find(r => r.id === currentViewingId);
        if (target) {
            target.balance = '0';
            saveRecords();
            updateStats();
            renderAllViews();
            openModal(currentViewingId);
        }
    });

    // ---------- WhatsApp message (text only — measurements are NOT included) ----------
    function buildWhatsAppText(record) {
        const totalDisplay = record.totalAmount || computeTotal(record.addAmount, record.balance);
        const lines = [];
        lines.push(`*Suresh's Youth Style Stitch Wear* ✂️`);
        lines.push(`*Serial Number:* ${record.orderId}`);
        lines.push(`*Customer Name:* ${record.name}`);
        if (record.bookedDate) lines.push(`*Booked Date:* ${formatDate(record.bookedDate, true)}`);
        if (record.deliveryDate) lines.push(`*Delivery Date:* ${formatDate(record.deliveryDate, true)}`);

        const parts = record.particulars || [];
        if (parts.length) {
            lines.push('', '*Particulars:*');
            parts.forEach((p, idx) => {
                const countStr = p.count ? ` (Count: ${p.count})` : '';
                lines.push(`${idx + 1}. ${p.item || '-'}${countStr}`);
            });
            lines.push(`*Total Items Count:* ${particularsTotal(record)}`);
        }

        const isPaid = isBalanceCleared(record.balance);
        lines.push(
            '',
            '*Billing Details:*',
            `• Total Amount: ₹${totalDisplay}`,
            `• Advance Paid: ₹${record.addAmount || '0'}`,
            `• Balance Due: ${isPaid ? '✓ Paid in Full' : `₹${record.balance || '0'}`}`,
            '',
            `✦ Every Stitch Tells Your Story ✦`,
            `Your Style. Your Confidence. Your Moment.`,
            `“Thank you for choosing Suresh’s Youth Style Stitch Wear. We’re happy to be a part of your style journey!”`
        );
        return lines.join('\n');
    }

    function openWhatsAppChat(record, text) {
        const cleanPhone = (record.phone || '').replace(/[^0-9]/g, '');
        const waUrl = cleanPhone.length >= 10
            ? `https://wa.me/91${cleanPhone.slice(-10)}?text=${encodeURIComponent(text)}`
            : `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(waUrl, '_blank');
    }

    // ---------- WhatsApp 3-Choice Modal (Send PDF, Send SMS, Cancel) ----------
    function openWhatsAppChoiceModal(record) {
        activeWhatsAppRecord = record;
        waModalSubtitle.textContent = `Serial Number: ${record.orderId} • Customer Name: ${record.name}`;
        whatsappChoiceBackdrop.classList.remove('hidden');
    }

    function closeWhatsAppChoiceModal() {
        whatsappChoiceBackdrop.classList.add('hidden');
        activeWhatsAppRecord = null;
    }

    waChoiceCancelBtn.addEventListener('click', closeWhatsAppChoiceModal);
    whatsappChoiceBackdrop.addEventListener('click', (e) => {
        if (e.target === whatsappChoiceBackdrop) closeWhatsAppChoiceModal();
    });

    waChoiceSmsBtn.addEventListener('click', () => {
        if (!activeWhatsAppRecord) return;
        const record = activeWhatsAppRecord;
        closeWhatsAppChoiceModal();
        openWhatsAppChat(record, buildWhatsAppText(record));
    });

    waChoicePdfBtn.addEventListener('click', async () => {
        if (!activeWhatsAppRecord) return;
        const record = activeWhatsAppRecord;
        closeWhatsAppChoiceModal();
        await sendWhatsAppPdf(record);
    });

    modalWhatsappBtn.addEventListener('click', () => {
        if (!currentViewingId) return;
        const record = records.find(r => r.id === currentViewingId);
        if (!record) return;
        openWhatsAppChoiceModal(record);
    });

    // ---------- PDF bill (light pastel colours only — showcase quality) ----------
    function buildBillElement(record, withMeasurements = false) {
        const totalDisplay = record.totalAmount || computeTotal(record.addAmount, record.balance);
        const isPaid = isBalanceCleared(record.balance);
        const parts = record.particulars || [];

        const rowsHtml = parts.length
            ? parts.map((p, i) => `
                <tr>
                    <td class="pb-c">${i + 1}</td>
                    <td class="pb-item-name">${escapeHTML(p.item) || '-'}</td>
                    <td class="pb-c pb-count-val">${escapeHTML(String(p.count || '-'))}</td>
                </tr>`).join('') + `
                <tr class="pb-sum">
                    <td colspan="2" class="pb-sum-label">TOTAL PARTICULARS COUNT &nbsp;:</td>
                    <td class="pb-c pb-sum-val">${particularsTotal(record)}</td>
                </tr>`
            : `<tr><td colspan="3" class="pb-empty">No particulars recorded</td></tr>`;

        const measurementsHtml = withMeasurements ? `
            <div class="pb-measurements-section">
                <div class="pb-section-header">
                    <span class="pb-sec-icon">📏</span>
                    <span class="pb-sec-title">Garments &amp; Measurements</span>
                    <span class="pb-sec-badge">Master Job Card</span>
                </div>
                <div class="pb-meas-grid">
                    <div class="pb-meas-box pb-box-shirt">
                        <div class="pb-meas-title">👔 Shirt Measurements</div>
                        <div class="pb-meas-content">${record.shirt ? escapeHTML(record.shirt) : '<em>No shirt measurements noted</em>'}</div>
                    </div>
                    <div class="pb-meas-box pb-box-pant">
                        <div class="pb-meas-title">👖 Pant Measurements</div>
                        <div class="pb-meas-content">${record.pant ? escapeHTML(record.pant) : '<em>No pant measurements noted</em>'}</div>
                    </div>
                    <div class="pb-meas-box pb-box-others">
                        <div class="pb-meas-title">🧵 Others / Special Notes</div>
                        <div class="pb-meas-content">${record.others ? escapeHTML(record.others) : '<em>No additional items or instructions</em>'}</div>
                    </div>
                </div>
            </div>
        ` : '';

        const subtitleTag = withMeasurements
            ? 'BESPOKE TAILORS &bull; MASTER JOB CARD WITH MEASUREMENTS'
            : 'BESPOKE TAILORS &bull; PREMIUM STITCHING &bull; OFFICIAL ORDER SLIP';

        const wrap = document.createElement('div');
        wrap.className = 'pdf-bill' + (withMeasurements ? ' with-measurements-bill' : '');
        wrap.innerHTML = `
            <div class="pb-card">
                <!-- Shop Header Banner -->
                <div class="pb-header">
                    <div class="pb-header-decor">
                        <span class="pb-decor-line"></span>
                        <span class="pb-decor-icon">✂️</span>
                        <span class="pb-decor-line"></span>
                    </div>
                    <div class="pb-brand-prefix">Suresh's</div>
                    <div class="pb-brand-main">
                        <span class="brand-president-text pb-president-text"><span class="ys-line1">Youth Style</span><span class="ys-line2">Stitch Wear</span></span>
                    </div>
                    <div class="pb-tag">${subtitleTag}</div>
                </div>

                <!-- Metadata 4-Box Grid (Light Pastels) -->
                <div class="pb-meta">
                    <div class="pb-meta-box pb-box-serial">
                        <span class="pb-meta-label">Serial Number</span>
                        <span class="pb-meta-val">${escapeHTML(record.orderId)}</span>
                    </div>
                    <div class="pb-meta-box pb-box-customer">
                        <span class="pb-meta-label">Customer Name</span>
                        <span class="pb-meta-val">${escapeHTML(record.name)}</span>
                        ${record.phone ? `<span class="pb-meta-sub">📞 ${escapeHTML(record.phone)}</span>` : ''}
                    </div>
                    <div class="pb-meta-box pb-box-booked">
                        <span class="pb-meta-label">Booked Date</span>
                        <span class="pb-meta-val">${record.bookedDate ? formatDate(record.bookedDate, true) : 'Not Specified'}</span>
                    </div>
                    <div class="pb-meta-box pb-box-delivery">
                        <span class="pb-meta-label">Delivery Date</span>
                        <span class="pb-meta-val">${record.deliveryDate ? formatDate(record.deliveryDate, true) : 'Not Specified'}</span>
                    </div>
                </div>

                ${measurementsHtml}

                <!-- Particulars Section -->
                <div class="pb-section-header">
                    <span class="pb-sec-icon">🧾</span>
                    <span class="pb-sec-title">Particulars &amp; Work Details</span>
                    <span class="pb-sec-badge">Total Items &nbsp;: &nbsp;<strong>${particularsTotal(record)}</strong></span>
                </div>

                <table class="pb-table">
                    <thead>
                        <tr>
                            <th style="width:65px; text-align:center;">#</th>
                            <th>Particular Item Description</th>
                            <th style="width:130px; text-align:center;">Count</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>

                <!-- Financial Totals (3 Light Pastel Cards) -->
                <div class="pb-totals">
                    <div class="pb-total-box pb-box-total">
                        <span class="pb-t-label">Total Amount</span>
                        <span class="pb-t-val">₹${escapeHTML(totalDisplay)}</span>
                    </div>
                    <div class="pb-total-box pb-box-adv">
                        <span class="pb-t-label">Advance Paid</span>
                        <span class="pb-t-val">₹${escapeHTML(record.addAmount || '0')}</span>
                    </div>
                    <div class="pb-total-box pb-box-bal ${isPaid ? 'pb-paid' : ''}">
                        <span class="pb-t-label">${isPaid ? 'Payment Status' : 'Balance Due'}</span>
                        <span class="pb-t-val">${isPaid ? '✓ PAID' : `₹${escapeHTML(record.balance)}`}</span>
                    </div>
                </div>

                <!-- Footer -->
                <div class="pb-footer">
                    <div class="pb-footer-motto">✦ Every Stitch Tells Your Story ✦</div>
                    <div class="pb-footer-tagline">Your Style. Your Confidence. Your Moment.</div>
                    <p class="pb-footer-appreciation">“Thank you for choosing Suresh’s Youth Style Stitch Wear. We’re happy to be a part of your style journey!”</p>
                </div>
            </div>
        `;
        return wrap;
    }

    async function generateBillPdf(record, withMeasurements = false) {
        if (!window.html2canvas || !window.jspdf) {
            throw new Error('PDF libraries could not be loaded. Please check your internet connection and reload.');
        }

        const bill = buildBillElement(record, withMeasurements);
        document.body.appendChild(bill);

        try {
            // Make sure the brush + President fonts are ready before the bill is drawn
            if (document.fonts && document.fonts.load) {
                await Promise.all([
                    document.fonts.load("52px 'Alex Brush'"),
                    document.fonts.load("52px 'SureshBrush'"),
                    document.fonts.load("40px 'YouthStylePresident'")
                ]).catch(() => {});
            }

            const canvas = await window.html2canvas(bill, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true,
                onclone: (clonedDoc) => {
                    const el = clonedDoc.querySelector('.pdf-bill');
                    if (el) {
                        el.style.position = 'static';
                        el.style.left = '0';
                    }
                }
            });

            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const pdfWidth = 210; // mm (A4 width)
            const imgHeight = Math.max((canvas.height * pdfWidth) / canvas.width, 211);

            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: [pdfWidth, imgHeight] });
            pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, (canvas.height * pdfWidth) / canvas.width);

            const safeSerial = String(record.orderId).replace(/[^a-z0-9_-]+/gi, '-');
            const suffix = withMeasurements ? 'JobCard' : 'Bill';
            return { blob: pdf.output('blob'), fileName: `Youth-Style-${suffix}-${safeSerial}.pdf` };
        } finally {
            bill.remove();
        }
    }

    function downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    // Send PDF via WhatsApp: native share sheet on phones, download + chat fallback on desktop
    async function sendWhatsAppPdf(record) {
        const origHtml = modalWhatsappBtn.innerHTML;
        modalWhatsappBtn.disabled = true;
        modalWhatsappBtn.innerHTML = '<span>⏳ Preparing PDF...</span>';

        try {
            const { blob, fileName } = await generateBillPdf(record);
            const file = new File([blob], fileName, { type: 'application/pdf' });
            const text = buildWhatsAppText(record);

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({ files: [file], title: fileName, text });
                    return;
                } catch (err) {
                    if (err && err.name === 'AbortError') return; // User dismissed share sheet
                }
            }

            // Fallback (desktop browsers): save the PDF and open the WhatsApp chat
            downloadBlob(blob, fileName);
            openWhatsAppChat(record, text);
            alert('PDF downloaded! WhatsApp is opening — please attach the downloaded PDF file to the chat.');
        } catch (err) {
            console.error(err);
            alert(err && err.message ? err.message : 'Could not create the PDF. Please try again.');
        } finally {
            modalWhatsappBtn.disabled = false;
            modalWhatsappBtn.innerHTML = origHtml;
        }
    }

    function openModal(id) {
        const record = records.find(r => r.id === id);
        if (!record) return;

        currentViewingId = id;
        modalOrderId.textContent = `Slip • Serial Number ${record.orderId}`;
        modalCustomerInfo.textContent = `Customer Name: ${record.name} | Phone: ${record.phone} | Created: ${record.date}`;

        const isPaid = isBalanceCleared(record.balance);
        modalPaidBtn.style.display = isPaid ? 'none' : 'inline-flex';

        const totalDisplay = record.totalAmount || computeTotal(record.addAmount, record.balance);

        modalContent.innerHTML = `
            <div class="slip-print-header" style="display:none;">
                <span class="slip-print-title-prefix">Suresh's</span><br>
                <span class="slip-print-title-main">
                    <span class="brand-president-text pb-president-text"><span class="ys-line1">Youth Style</span><span class="ys-line2">Stitch Wear</span></span>
                </span>
                <p style="font-size:0.75rem; color:#475569; margin-top:2px;">Tailoring Job Card & Bill Receipt</p>
            </div>

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
                    <span class="slip-label">Booked Date</span>
                    <span class="slip-val">${record.bookedDate ? formatDate(record.bookedDate, true) : 'Not specified'}</span>
                </div>
                <div class="slip-detail-item">
                    <span class="slip-label">Delivery Date</span>
                    <span class="slip-val">${record.deliveryDate ? formatDate(record.deliveryDate, true) : 'Not specified'}</span>
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

            <div class="particulars-card">
                <div class="measurement-card-title">🧾 Particulars <span class="particulars-count-chip">Total Count: ${particularsTotal(record)}</span></div>
                <div class="particulars-lines">
                    ${(record.particulars && record.particulars.length)
                        ? record.particulars.map(p => `
                            <div class="particular-line">
                                <span>${escapeHTML(p.item) || '-'}</span>
                                <strong>× ${escapeHTML(String(p.count || '-'))}</strong>
                            </div>`).join('')
                        : '<em style="color:var(--text-dim);">No particulars noted</em>'}
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

            <div class="slip-bottom-signature">
                <div class="slip-bottom-motto">✦ Every Stitch Tells Your Story ✦</div>
                <div class="slip-bottom-tagline">Your Style. Your Confidence. Your Moment.</div>
                <p class="slip-bottom-appreciation">“Thank you for choosing Suresh’s Youth Style Stitch Wear. We’re happy to be a part of your style journey!”</p>
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
                    <td colspan="9" class="empty-state">No matching orders found.</td>
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
            if (particularsTotal(record)) chips += `<span class="chip chip-part">Particulars: ${particularsTotal(record)}</span>`;
            if (!chips) chips = `<span style="color:var(--text-dim);font-size:0.75rem;">None</span>`;

            row.innerHTML = `
                <td><span class="order-pill">${escapeHTML(record.orderId)}</span></td>
                <td>
                    <div class="customer-cell">
                        <span class="customer-name">${escapeHTML(record.name)}</span>
                        <a href="tel:${escapeHTML(record.phone)}" class="customer-phone" style="text-decoration:none;">${escapeHTML(record.phone)}</a>
                    </div>
                </td>
                <td><span style="font-size:0.82rem; color:var(--text-muted);">${record.bookedDate ? formatDate(record.bookedDate) : '-'}</span></td>
                <td><span style="font-size:0.82rem; color:var(--text-muted);">${record.deliveryDate ? formatDate(record.deliveryDate) : '-'}</span></td>
                <td><span class="total-pill">₹ ${escapeHTML(totalDisplay)}</span></td>
                <td><strong>₹ ${record.addAmount ? escapeHTML(record.addAmount) : '0'}</strong></td>
                <td>${balanceHtml}</td>
                <td><div class="chips-container">${chips}</div></td>
                <td>
                    <div class="action-buttons">
                        <button type="button" class="btn-icon-sm btn-view" data-id="${record.id}" title="View Slip">👁️ Slip</button>
                        <button type="button" class="btn-icon-sm btn-whatsapp-action" data-id="${record.id}" title="Share on WhatsApp" style="color:#25d366; border-color:rgba(37,211,102,0.35);">💬</button>
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
            if (particularsTotal(record)) chips += `<span class="chip chip-part">Particulars: ${particularsTotal(record)}</span>`;

            card.innerHTML = `
                <div class="card-top">
                    <span class="card-order-num">Serial Number: ${escapeHTML(record.orderId)}</span>
                    <span class="card-delivery-badge">
                        📅 Booked: ${record.bookedDate ? formatDate(record.bookedDate) : '-'} &nbsp;•&nbsp; 🚚 Delivery: ${record.deliveryDate ? formatDate(record.deliveryDate) : '-'}
                    </span>
                </div>

                <div class="card-customer-row">
                    <div>
                        <div class="card-customer-label" style="font-size:0.72rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-dim); margin-bottom:2px;">Customer Name</div>
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
                    <button type="button" class="btn-icon-sm btn-whatsapp-action" data-id="${record.id}" style="color:#25d366; border-color:rgba(37,211,102,0.35);">
                        💬 WhatsApp
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

    // Total of all particular counts (falls back to number of items when no counts are given)
    function particularsTotal(record) {
        const list = Array.isArray(record.particulars) ? record.particulars : [];
        const sum = list.reduce((s, p) => s + parseNumeric(p.count), 0);
        return sum || list.length;
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

    function formatDate(dateStr, withYear = false) {
        try {
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                const d = new Date(parts[0], parts[1] - 1, parts[2]);
                return d.toLocaleDateString(undefined, withYear
                    ? { day: 'numeric', month: 'short', year: 'numeric' }
                    : { month: 'short', day: 'numeric' });
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
