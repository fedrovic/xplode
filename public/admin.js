(function () {
  'use strict';

  const adminTokenStorage = 'xpAdminToken';
  const notice = document.getElementById('adminNotice');
  const panel = document.getElementById('adminPanel');
  const signOutButton = document.getElementById('adminSignOut');
  const API_BASE = window.XPLODE_API_BASE
    ? String(window.XPLODE_API_BASE).replace(/\/+$/, '')
    : ['localhost', '127.0.0.1', ''].includes(window.location.hostname)
      ? 'http://localhost:3000'
      : window.location.origin;

  const nodes = {
    queue: document.getElementById('adminQueue'),
    withdrawals: document.getElementById('adminWithdrawals'),
    users: document.getElementById('adminUsers'),
    sms: document.getElementById('adminSmsLog'),
    fortune: document.getElementById('adminFortuneList')
  };

  const money = (value) => `UGX ${Number(value || 0).toLocaleString()}`;

  const setNodeMessage = (node, text, type = 'error') => {
    node.textContent = text;
    node.classList.toggle('success', type === 'success');
    node.classList.toggle('error', type !== 'success');
  };

  const apiRequest = async (path, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const adminToken = sessionStorage.getItem(adminTokenStorage);
    if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers
      });
    } catch (error) {
      throw new Error('Cannot reach the XPLODE server. Open http://localhost:3000/admin.html');
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem(adminTokenStorage);
      window.location.replace('index.html');
      throw new Error('Session expired. Sign in again.');
    }
    if (!response.ok) throw new Error(payload.message || 'Request failed');
    return payload;
  };

  // ---------- rendering helpers ----------
  const emptyItem = (text) => {
    const item = document.createElement('li');
    const wrap = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = text;
    wrap.appendChild(strong);
    item.appendChild(wrap);
    return item;
  };

  const errorItem = (message) => emptyItem(message);

  // Candy 3D confirmation dialog. Resolves true only when the operator taps
  // the confirm button; Escape, the overlay, or Cancel resolve false.
  let activeConfirmDialog = null;

  const confirmDialog = ({ title, body, confirmLabel = 'Confirm', danger = false }) => {
    // Never stack dialogs: a second request while one is open is treated as Cancel.
    if (activeConfirmDialog) return Promise.resolve(false);
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'reward-overlay admin-confirm-overlay';
      const modal = document.createElement('div');
      modal.className = 'reward-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      const heading = document.createElement('h2');
      heading.className = 'reward-title';
      heading.textContent = title;
      const text = document.createElement('p');
      text.className = 'reward-note';
      text.textContent = body;
      const actions = document.createElement('div');
      actions.className = 'admin-confirm-actions';
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'history-retry';
      cancelButton.textContent = 'Cancel';
      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'history-retry';
      if (danger) confirmButton.classList.add('is-danger');
      confirmButton.textContent = confirmLabel;
      actions.append(cancelButton, confirmButton);
      modal.append(heading, text, actions);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const close = (confirmed) => {
        activeConfirmDialog = null;
        overlay.classList.add('is-leaving');
        setTimeout(() => overlay.remove(), 170);
        document.removeEventListener('keydown', onKey);
        resolve(confirmed);
      };
      const onKey = (event) => { if (event.key === 'Escape') close(false); };
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('click', (event) => { if (event.target === overlay) close(false); });
      cancelButton.addEventListener('click', () => close(false));
      confirmButton.addEventListener('click', () => close(true));
    });
  };

  const actionButton = (label, danger, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-retry';
    if (danger) button.classList.add('is-danger');
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  };

  const renderList = (listNode, rows, buildRow) => {
    listNode.replaceChildren();
    if (!rows.length) {
      listNode.appendChild(emptyItem('Nothing here yet'));
      return;
    }
    rows.forEach((row) => listNode.appendChild(buildRow(row)));
  };

  const buildDepositRow = (deposit) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const heading = document.createElement('strong');
    const subtext = document.createElement('small');
    const actions = document.createElement('div');

    heading.textContent = `#${deposit.id} · ${money(deposit.amount)} · @${deposit.username}`;
    subtext.textContent = [
      deposit.provider,
      deposit.transaction_id ? `ID: ${deposit.transaction_id}` : null,
      deposit.payer_number ? `Paid from: ${deposit.payer_number}` : null,
      deposit.status,
      deposit.created_at
    ].filter(Boolean).join(' · ');

    if (deposit.status === 'pending') {
      const onApprove = async (button) => {
        button.disabled = true;
        try {
          const result = await apiRequest(`/api/admin/deposits/${deposit.id}/approve`, { method: 'POST' });
          setNodeMessage(notice, result.message, 'success');
        } catch (error) {
          setNodeMessage(notice, error.message, 'error');
        }
        loadDeposits();
        loadStats();
      };
      const onReject = async (button) => {
        button.disabled = true;
        try {
          const result = await apiRequest(`/api/admin/deposits/${deposit.id}/reject`, { method: 'POST' });
          setNodeMessage(notice, result.message, 'success');
        } catch (error) {
          setNodeMessage(notice, error.message, 'error');
        }
        loadDeposits();
        loadStats();
      };
      actions.append(
        actionButton('Approve', false, (event) => onApprove(event.currentTarget)),
        actionButton('Reject', true, (event) => onReject(event.currentTarget))
      );
    } else {
      const status = document.createElement('b');
      status.textContent = deposit.status;
      actions.appendChild(status);
    }

    details.append(heading, subtext);
    item.append(details, actions);
    return item;
  };

  const buildWithdrawalRow = (withdrawal) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const heading = document.createElement('strong');
    const subtext = document.createElement('small');
    const actions = document.createElement('div');

    heading.textContent = `#${withdrawal.id} · send ${money(withdrawal.payout_amount || withdrawal.amount)} · @${withdrawal.username}`;
    subtext.textContent = [
      withdrawal.account_provider,
      withdrawal.account_name,
      withdrawal.account_number,
      withdrawal.fee ? `fee ${money(withdrawal.fee)}` : null,
      withdrawal.status,
      withdrawal.created_at
    ].filter(Boolean).join(' · ');

    if (withdrawal.status === 'pending') {
      const onPay = async (button) => {
        button.disabled = true;
        try {
          const result = await apiRequest(`/api/admin/withdrawals/${withdrawal.id}/approve`, { method: 'POST' });
          setNodeMessage(notice, result.message, 'success');
        } catch (error) {
          setNodeMessage(notice, error.message, 'error');
        }
        loadWithdrawals();
        loadStats();
      };
      const onReject = async (button) => {
        button.disabled = true;
        try {
          const result = await apiRequest(`/api/admin/withdrawals/${withdrawal.id}/reject`, { method: 'POST' });
          setNodeMessage(notice, result.message, 'success');
        } catch (error) {
          setNodeMessage(notice, error.message, 'error');
        }
        loadWithdrawals();
        loadStats();
      };
      actions.append(
        actionButton('Mark paid', false, (event) => onPay(event.currentTarget)),
        actionButton('Reject', true, (event) => onReject(event.currentTarget))
      );
    } else {
      const status = document.createElement('b');
      status.textContent = withdrawal.status;
      actions.appendChild(status);
    }

    details.append(heading, subtext);
    item.append(details, actions);
    return item;
  };

  const buildUserRow = (user) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const heading = document.createElement('strong');
    const subtext = document.createElement('small');
    const balances = document.createElement('div');
    balances.className = 'admin-user-balances';

    heading.textContent = `@${user.username}${user.full_name && user.full_name !== user.username ? ` · ${user.full_name}` : ''}`;
    subtext.textContent = [
      user.email,
      user.mobile,
      user.invite_code ? `Invite ${user.invite_code}` : null,
      `Joined ${String(user.created_at || '').slice(0, 10)}`
    ].filter(Boolean).join(' · ');

    const rows = [
      ['Available', user.withdrawable],
      ['Pending', user.pending],
      ['Total', user.total]
    ];
    rows.forEach(([label, value]) => {
      const chip = document.createElement('span');
      chip.textContent = `${label}: ${money(value)}`;
      balances.appendChild(chip);
    });

    details.append(heading, subtext, balances);

    if (user.role !== 'admin') {
      const actions = document.createElement('div');
      actions.className = 'admin-user-actions';

      const applyAdjustment = async (sign) => {
        const raw = Number(adjustInput.value);
        if (!Number.isSafeInteger(raw) || raw <= 0) {
          setNodeMessage(notice, 'Type a whole UGX amount first.', 'error');
          return;
        }
        const confirmed = await confirmDialog({
          title: `${sign === 'add' ? 'Add' : 'Take'} UGX ${raw.toLocaleString()}?`,
          body: `This will ${sign === 'add' ? 'add UGX ' + raw.toLocaleString() + ' to' : 'take UGX ' + raw.toLocaleString() + ' from'} @${user.username}'s available balance and record it in their history.`,
          confirmLabel: sign === 'add' ? 'Add money' : 'Take money'
        });
        if (!confirmed) return;
        try {
          const result = await apiRequest(`/api/admin/users/${user.id}/balance`, {
            method: 'POST',
            body: JSON.stringify({ amount: sign === 'add' ? raw : -raw })
          });
          setNodeMessage(notice, result.message, 'success');
          loadUsers();
          loadStats();
        } catch (error) {
          setNodeMessage(notice, error.message, 'error');
        }
      };

      const deleteUser = async () => {
        const confirmed = await confirmDialog({
          title: `Delete @${user.username}?`,
          body: 'Their wallet, transactions, deposits, withdrawals, subscriptions and fortune history are removed permanently. This cannot be undone.',
          confirmLabel: 'Delete forever',
          danger: true
        });
        if (!confirmed) return;
        try {
          const result = await apiRequest(`/api/admin/users/${user.id}`, { method: 'DELETE' });
          setNodeMessage(notice, result.message, 'success');
          loadUsers();
          loadStats();
        } catch (error) {
          setNodeMessage(notice, error.message, 'error');
        }
      };

      const adjustWrap = document.createElement('div');
      adjustWrap.className = 'admin-adjust';
      const adjustInput = document.createElement('input');
      adjustInput.type = 'number';
      adjustInput.className = 'admin-adjust-input';
      adjustInput.placeholder = 'UGX amount';
      adjustInput.min = '1';
      adjustInput.step = '1';
      adjustInput.inputMode = 'numeric';
      adjustInput.setAttribute('aria-label', `Amount for @${user.username}`);
      adjustWrap.appendChild(adjustInput);

      actions.append(
        adjustWrap,
        actionButton('Add', false, () => applyAdjustment('add')),
        actionButton('Take', true, () => applyAdjustment('take')),
        actionButton('Delete user', true, deleteUser)
      );
      item.append(details, actions);
      return item;
    }

    item.appendChild(details);
    return item;
  };

  const buildSmsRow = (message) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const heading = document.createElement('strong');
    const subtext = document.createElement('small');
    const actions = document.createElement('div');

    heading.textContent = message.action === 'credited'
      ? `Credited ${money(message.parsed_amount)}`
      : message.action === 'no_match'
        ? 'Unmatched payment SMS'
        : 'Ignored';
    subtext.textContent = [
      message.sender,
      message.parsed_payer ? `Payer ${message.parsed_payer}` : null,
      message.parsed_reference ? `Ref ${message.parsed_reference}` : null,
      message.created_at
    ].filter(Boolean).join(' · ');

    const body = document.createElement('div');
    body.className = 'admin-sms-body';
    body.textContent = message.body;

    if (message.action === 'no_match') {
      actions.appendChild(document.createElement('span'));
    }

    details.append(heading, subtext, body);
    item.append(details, actions);
    return item;
  };

  const buildFortuneRow = (code) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const heading = document.createElement('strong');
    const subtext = document.createElement('small');
    const actions = document.createElement('div');

    heading.textContent = `${code.code} · ${money(code.amount)}`;
    const redeemedCount = Number(code.redeemed_count) || 0;
    const maxRedemptions = Number(code.max_redemptions) || 10;
    subtext.textContent = `${redeemedCount}/${maxRedemptions} claims · Issued ${code.created_at}`;

    const status = document.createElement('b');
    status.textContent = redeemedCount >= maxRedemptions ? 'fully claimed' : 'active';
    actions.appendChild(status);

    details.append(heading, subtext);
    item.append(details, actions);
    return item;
  };

  // ---------- data loaders ----------
  const loadDeposits = async () => {
    try {
      const result = await apiRequest('/api/admin/deposits');
      renderList(nodes.queue, result.deposits || [], buildDepositRow);
    } catch (error) {
      renderList(nodes.queue, [], () => errorItem(error.message));
    }
  };

  const loadWithdrawals = async () => {
    try {
      const result = await apiRequest('/api/admin/withdrawals');
      renderList(nodes.withdrawals, result.withdrawals || [], buildWithdrawalRow);
    } catch (error) {
      renderList(nodes.withdrawals, [], () => errorItem(error.message));
    }
  };

  const loadUsers = async () => {
    try {
      const result = await apiRequest('/api/admin/users');
      renderList(nodes.users, result.users || [], buildUserRow);
    } catch (error) {
      renderList(nodes.users, [], () => errorItem(error.message));
    }
  };

  const loadSms = async () => {
    try {
      const result = await apiRequest('/api/admin/sms');
      renderList(nodes.sms, result.messages || [], buildSmsRow);
    } catch (error) {
      renderList(nodes.sms, [], () => errorItem(error.message));
    }
  };

  const loadFortune = async () => {
    try {
      const result = await apiRequest('/api/admin/fortune-codes');
      renderList(nodes.fortune, result.codes || [], buildFortuneRow);
    } catch (error) {
      renderList(nodes.fortune, [], () => errorItem(error.message));
    }
  };

  const loadStats = async () => {
    try {
      const result = await apiRequest('/api/admin/stats');
      const stats = result.stats || {};
      document.getElementById('statPendingDeposits').textContent =
        `${stats.pendingDeposits?.count ?? 0} · ${money(stats.pendingDeposits?.amount)}`;
      document.getElementById('statPendingWithdrawals').textContent =
        `${stats.pendingWithdrawals?.count ?? 0} · ${money(stats.pendingWithdrawals?.amount)}`;
      document.getElementById('statUsers').textContent = String(stats.users ?? 0);
      document.getElementById('statConfirmed').textContent = money(stats.confirmedDeposits);
      document.getElementById('statUnmatchedSms').textContent = String(stats.unmatchedSms ?? 0);
    } catch (error) {
      // stats are non-critical; leave dashes
    }
  };

  const loaders = {
    deposits: loadDeposits,
    withdrawals: loadWithdrawals,
    users: loadUsers,
    sms: loadSms,
    fortune: loadFortune
  };

  // ---------- tabs ----------
  const tabs = Array.from(document.querySelectorAll('.admin-tab'));
  const panels = Array.from(document.querySelectorAll('.admin-tab-panel'));

  const activateTab = (name) => {
    tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.adminTab === name));
    panels.forEach((section) => { section.hidden = section.dataset.adminPanel !== name; });
    loaders[name]?.();
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.adminTab)));

  document.querySelectorAll('[data-refresh]').forEach((button) => {
    button.addEventListener('click', () => loaders[button.dataset.refresh]?.());
    if (button.dataset.refresh === 'deposits') button.addEventListener('click', loadStats);
    if (button.dataset.refresh === 'withdrawals') button.addEventListener('click', loadStats);
  });

  // ---------- dashboard open & sign out ----------
  const openDashboard = () => {
    panel.hidden = false;
    loadStats();
    loadDeposits();
  };

  signOutButton?.addEventListener('click', () => {
    sessionStorage.removeItem(adminTokenStorage);
    localStorage.removeItem('xpToken');
    localStorage.removeItem('xpLogin');
    localStorage.removeItem('xpRole');
    localStorage.removeItem('xpAppState');
    window.location.replace('index.html');
  });

  // ---------- SMS processing ----------
  document.getElementById('smsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = document.getElementById('smsBody').value.trim();
    const sender = document.getElementById('smsSender').value.trim();
    if (!body) return;
    try {
      const result = await apiRequest('/api/sms/ingest', {
        method: 'POST',
        body: JSON.stringify({ sender, body })
      });
      const outcome = result.results && result.results[0];
      if (outcome && outcome.action === 'credited') {
        setNodeMessage(document.getElementById('smsMessage'), 'Matched a pending deposit — wallet credited automatically.', 'success');
        event.target.reset();
      } else if (outcome && outcome.action === 'no_match') {
        setNodeMessage(document.getElementById('smsMessage'), 'Payment recognized, but no pending deposit matched (amount + payer number). Ask the user to submit the deposit, then process again.', 'error');
      } else {
        setNodeMessage(document.getElementById('smsMessage'), 'Not recognized as an MTN/Airtel payment SMS.', 'error');
      }
      loadDeposits();
      loadStats();
    } catch (error) {
      setNodeMessage(document.getElementById('smsMessage'), error.message, 'error');
    }
  });

  // ---------- fortune issuance ----------
  document.getElementById('fortuneForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number(document.getElementById('fortuneAmount').value);
    try {
      const result = await apiRequest('/api/admin/fortune-codes', {
        method: 'POST',
        body: JSON.stringify({ amount })
      });
      setNodeMessage(document.getElementById('fortuneMessage'), `Code: ${result.code} (${money(result.amount)}) — give it to the winner.`, 'success');
      event.target.reset();
      loadFortune();
    } catch (error) {
      setNodeMessage(document.getElementById('fortuneMessage'), error.message, 'error');
    }
  });

  // Single sign-in page: without an admin session the dashboard sends the
  // visitor to index.html, where the system routes everyone by role.
  if (sessionStorage.getItem(adminTokenStorage)) {
    apiRequest('/api/admin/stats')
      .then(openDashboard)
      .catch(() => {
        sessionStorage.removeItem(adminTokenStorage);
        window.location.replace('index.html');
      });
  } else {
    window.location.replace('index.html');
  }
})();
