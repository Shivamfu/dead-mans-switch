// Dead Man's Switch Dashboard Controller

const API_BASE = '';
let currentToken = localStorage.getItem('dms_token') || '';
let currentUser = JSON.parse(localStorage.getItem('dms_user') || 'null');
let switchesData = [];
let countdownInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  if (!currentToken || !currentUser) {
    await autoDemoAuth();
  } else {
    updateAuthUi();
  }

  loadSwitches();
  loadRecentEmails();
  loadAuditLogs();

  // Periodic polling for real-time status update & emails
  setInterval(() => {
    if (currentToken) {
      loadSwitches(false);
      loadRecentEmails();
      loadAuditLogs();
    }
  }, 4000);

  // High-frequency 1s countdown ticker for precise seconds count
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateAllCountdowns, 1000);
});

// Automatic login for demo / rapid evaluation
async function autoDemoAuth() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `operator_${Math.random().toString(36).substring(2, 6)}@vault.local`,
        password: 'Password123!',
      }),
    });

    const data = await res.json();
    if (data.token) {
      currentToken = data.token;
      currentUser = data.user;
      localStorage.setItem('dms_token', currentToken);
      localStorage.setItem('dms_user', JSON.stringify(currentUser));
      updateAuthUi();
    }
  } catch (e) {
    console.error('Demo auth error:', e);
  }
}

function updateAuthUi() {
  const loggedOut = document.getElementById('authSectionLoggedOut');
  const loggedIn = document.getElementById('authSectionLoggedIn');
  const userEmail = document.getElementById('currentUserEmail');
  const apiKeyShort = document.getElementById('userApiKeyShort');

  if (currentUser) {
    loggedOut.style.display = 'none';
    loggedIn.style.display = 'flex';
    userEmail.textContent = currentUser.email;
    apiKeyShort.textContent = currentUser.apiKey ? currentUser.apiKey.substring(0, 14) + '...' : 'dms_...';
  } else {
    loggedOut.style.display = 'flex';
    loggedIn.style.display = 'none';
  }
}

function logout() {
  currentToken = '';
  currentUser = null;
  localStorage.removeItem('dms_token');
  localStorage.removeItem('dms_user');
  updateAuthUi();
  autoDemoAuth();
}

function copyApiKey() {
  if (currentUser?.apiKey) {
    navigator.clipboard.writeText(currentUser.apiKey);
    alert('API Key copied to clipboard! You can use this for authenticated curl pings:\n\ncurl -X POST ' + window.location.origin + '/api/checkin/<SWITCH_ID>/ping -H "Authorization: Bearer ' + currentUser.apiKey + '"');
  }
}

// Modal management
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function switchModal(fromId, toId) {
  closeModal(fromId);
  openModal(toId);
}

function openCreateSwitchModal() {
  if (!currentToken) {
    openModal('loginModal');
    return;
  }
  openModal('createSwitchModal');
}

function addContactRow() {
  const container = document.getElementById('contactRows');
  const row = document.createElement('div');
  row.className = 'contact-row';
  row.style.marginTop = '8px';
  row.innerHTML = `
    <input type="text" placeholder="Contact Name" class="form-input contact-name" required>
    <input type="email" placeholder="Recipient Email" class="form-input contact-email" required>
    <input type="text" placeholder="Personal Note to Contact" class="form-input contact-note">
  `;
  container.appendChild(row);
}

// API Helper
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

// Load Switches
async function loadSwitches(showLoading = false) {
  if (!currentToken) return;

  try {
    const data = await apiFetch('/api/switches');
    switchesData = data.switches || [];
    renderSwitches();
  } catch (err) {
    console.error('Failed to load switches:', err.message);
  }
}

function renderSwitches() {
  const container = document.getElementById('switchesGrid');
  const badge = document.getElementById('switchCountBadge');

  badge.textContent = `${switchesData.length} Vault${switchesData.length === 1 ? '' : 's'}`;

  if (switchesData.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🛡️</div>
        <h3>No recovery switches configured yet</h3>
        <p>Create a switch with your emergency notes, set a heartbeat interval, and designate trusted contacts.</p>
        <button class="btn btn-primary btn-sm" style="margin-top: 14px;" onclick="openCreateSwitchModal()">+ Create Recovery Vault</button>
      </div>
    `;
    return;
  }

  container.innerHTML = switchesData.map((sw) => {
    const statusClass = `badge-${sw.status.toLowerCase()}`;
    const contactsCount = sw.contacts ? sw.contacts.length : 0;

    return `
      <div class="switch-card status-${sw.status}" id="switch-card-${sw.id}">
        <div>
          <div class="switch-card-header">
            <div>
              <div class="switch-name">${escapeHtml(sw.name)}</div>
              <div class="switch-desc">${escapeHtml(sw.description || 'Encrypted Recovery Vault')}</div>
            </div>
            <span class="badge ${statusClass}">${formatStatus(sw.status)}</span>
          </div>

          <div class="timer-box">
            <div class="timer-label" id="timer-label-${sw.id}">
              ${sw.status === 'TRIGGERED' ? 'STATUS' : sw.status === 'GRACE_PERIOD' ? 'GRACE PERIOD DEADLINE' : 'CHECK-IN DUE IN'}
            </div>
            <div class="timer-val" id="countdown-${sw.id}">Calculating...</div>
          </div>

          <div class="switch-meta">
            <div><strong>Interval:</strong> ${formatSeconds(sw.checkin_interval_seconds)} | <strong>Grace:</strong> ${formatSeconds(sw.grace_period_seconds)}</div>
            <div><strong>Trusted Contacts:</strong> ${contactsCount} recipient(s) designated</div>
            <div><strong>Encryption:</strong> AES-256-GCM Envelope Protection</div>
          </div>
        </div>

        <div class="switch-actions">
          ${sw.status !== 'TRIGGERED' ? `
            <button class="btn btn-primary btn-sm" onclick="pingSwitch('${sw.id}')" title="Send authenticated check-in heartbeat">
              ✅ Ping Check-in
            </button>
            <button class="btn btn-secondary btn-sm" onclick="simulateDue('${sw.id}')" title="Fast-forward time to simulate check-in due">
              ⏩ Test Due Prompt
            </button>
            <button class="btn btn-danger-outline btn-sm" onclick="triggerEmergency('${sw.id}')" title="Immediately unseal and dispatch credentials">
              🚨 Trigger Dispatch
            </button>
          ` : `
            <span style="font-size: 12px; color: var(--purple); font-weight: 700;">PAYLOADS UNSEALED & DISPATCHED</span>
          `}
          <button class="btn btn-outline btn-sm" onclick="deleteSwitch('${sw.id}')" title="Delete Switch">🗑️</button>
        </div>
      </div>
    `;
  }).join('');

  updateAllCountdowns();
}

function updateAllCountdowns() {
  for (const sw of switchesData) {
    const el = document.getElementById(`countdown-${sw.id}`);
    const label = document.getElementById(`timer-label-${sw.id}`);
    if (!el) continue;

    if (sw.status === 'TRIGGERED') {
      el.textContent = 'UNSEALED';
      el.className = 'timer-val';
      continue;
    }

    const now = Date.now();
    let targetTime = 0;
    let isGrace = false;

    if (sw.status === 'GRACE_PERIOD' || sw.status === 'PENDING_CHECKIN') {
      targetTime = new Date(sw.grace_period_ends_at || sw.next_checkin_due_at).getTime();
      isGrace = true;
    } else {
      targetTime = new Date(sw.next_checkin_due_at).getTime();
    }

    const diff = targetTime - now;

    if (diff <= 0) {
      if (sw.status === 'ACTIVE') {
        el.textContent = 'DUE FOR PING';
        el.className = 'timer-val warning';
      } else {
        el.textContent = 'EXPIRED';
        el.className = 'timer-val danger';
      }
    } else {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);

      const formatted = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      el.textContent = formatted;

      if (isGrace) {
        el.className = 'timer-val danger';
        if (label) label.textContent = '⚠️ GRACE PERIOD COUNTDOWN:';
      } else {
        el.className = diff < 60000 ? 'timer-val warning' : 'timer-val';
      }
    }
  }
}

// Actions
async function pingSwitch(switchId) {
  try {
    const res = await apiFetch(`/api/checkin/${switchId}/ping`, { method: 'POST' });
    alert('✅ Heartbeat Confirmed!\n\nSwitch status has been restored to ACTIVE and the countdown timer has been reset.');
    await loadSwitches();
    await loadAuditLogs();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function simulateDue(switchId) {
  try {
    await apiFetch(`/api/switches/${switchId}/simulate-due`, { method: 'POST' });
    await apiFetch('/api/audit/evaluate-now', { method: 'POST' });
    alert('⏩ Simulation triggered: Switch is now due.\nEvaluation cycle executed: check-in email prompt sent to owner!');
    await loadSwitches();
    await loadRecentEmails();
    await loadAuditLogs();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function triggerEmergency(switchId) {
  if (!confirm('Are you sure you want to trigger this recovery switch immediately? All encrypted credentials will be unsealed and dispatched to the designated contacts.')) {
    return;
  }

  try {
    const res = await apiFetch(`/api/switches/${switchId}/emergency-trigger`, { method: 'POST' });
    alert(`🚨 Emergency Recovery Executed!\n\nDispatched to ${res.result.dispatchedCount} recipient(s). Check the Dispatched Email Inbox below to view the released payload.`);
    await loadSwitches();
    await loadRecentEmails();
    await loadAuditLogs();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function deleteSwitch(switchId) {
  if (!confirm('Permanently delete this dead man\'s switch?')) return;
  try {
    await apiFetch(`/api/switches/${switchId}`, { method: 'DELETE' });
    await loadSwitches();
    await loadAuditLogs();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function triggerImmediateEvaluation() {
  try {
    await apiFetch('/api/audit/evaluate-now', { method: 'POST' });
    alert('⚡ Cron evaluation tick executed! Checked deadlines and processed active queues.');
    await loadSwitches();
    await loadRecentEmails();
    await loadAuditLogs();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// Form Handlers
async function handleCreateSwitch(e) {
  e.preventDefault();
  const name = document.getElementById('switchName').value;
  const payload = document.getElementById('switchPayload').value;
  const checkinIntervalSeconds = document.getElementById('switchInterval').value;
  const gracePeriodSeconds = document.getElementById('switchGrace').value;

  const contactRows = document.querySelectorAll('#contactRows .contact-row');
  const contacts = [];
  contactRows.forEach((row) => {
    const cName = row.querySelector('.contact-name')?.value;
    const cEmail = row.querySelector('.contact-email')?.value;
    const cNote = row.querySelector('.contact-note')?.value;
    if (cEmail) {
      contacts.push({ name: cName, email: cEmail, customMessage: cNote });
    }
  });

  try {
    await apiFetch('/api/switches', {
      method: 'POST',
      body: JSON.stringify({
        name,
        payload,
        checkinIntervalSeconds,
        gracePeriodSeconds,
        contacts,
      }),
    });

    closeModal('createSwitchModal');
    document.getElementById('createSwitchForm').reset();
    await loadSwitches();
    await loadAuditLogs();
    alert('Dead Man\'s Switch armed successfully! AES-256-GCM encryption verified.');
  } catch (err) {
    alert(`Failed to create switch: ${err.message}`);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;

  try {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    currentToken = res.token;
    currentUser = res.user;
    localStorage.setItem('dms_token', currentToken);
    localStorage.setItem('dms_user', JSON.stringify(currentUser));
    updateAuthUi();
    closeModal('registerModal');
    await loadSwitches();
  } catch (err) {
    alert(`Registration failed: ${err.message}`);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    currentToken = res.token;
    currentUser = res.user;
    localStorage.setItem('dms_token', currentToken);
    localStorage.setItem('dms_user', JSON.stringify(currentUser));
    updateAuthUi();
    closeModal('loginModal');
    await loadSwitches();
  } catch (err) {
    alert(`Login failed: ${err.message}`);
  }
}

// Feeds: Emails & Audit Logs
let liveEmails = [];

async function loadRecentEmails() {
  if (!currentToken) return;
  try {
    const data = await apiFetch('/api/audit/recent-emails');
    liveEmails = data.emails || [];
    const container = document.getElementById('emailFeed');

    if (liveEmails.length === 0) {
      container.innerHTML = '<div class="empty-feed">No emails dispatched yet. Trigger a prompt or recovery dispatch to inspect outgoing messages.</div>';
      return;
    }

    container.innerHTML = liveEmails.map((m, idx) => `
      <div class="feed-item">
        <div class="feed-item-header">
          <span class="feed-title">✉️ ${escapeHtml(m.subject)}</span>
          <span class="feed-time">${new Date(m.timestamp).toLocaleTimeString()}</span>
        </div>
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">
          To: <strong style="color: #cbd5e1;">${escapeHtml(m.to)}</strong>
        </div>
        <div>
          <a class="email-preview-link" onclick="viewEmailDetail(${idx})">View Email Package & Credentials &rarr;</a>
          ${m.previewUrl ? `<a href="${m.previewUrl}" target="_blank" style="margin-left: 12px; color: var(--emerald); font-size: 12px;">Ethereal Live View ↗</a>` : ''}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load emails:', err.message);
  }
}

function viewEmailDetail(idx) {
  const mail = liveEmails[idx];
  if (!mail) return;

  document.getElementById('emailModalSubject').textContent = mail.subject;
  document.getElementById('emailModalTo').textContent = mail.to;
  document.getElementById('emailModalDate').textContent = new Date(mail.timestamp).toLocaleString();
  document.getElementById('emailModalContent').innerHTML = mail.html || `<pre style="color: #22c55e;">${escapeHtml(mail.text)}</pre>`;

  openModal('emailModal');
}

async function loadAuditLogs() {
  if (!currentToken) return;
  try {
    const data = await apiFetch('/api/audit/logs?limit=25');
    const logs = data.logs || [];
    const container = document.getElementById('auditLogFeed');

    if (logs.length === 0) {
      container.innerHTML = '<div class="empty-feed">No security audit logs recorded yet.</div>';
      return;
    }

    container.innerHTML = logs.map((log) => `
      <div class="feed-item">
        <div class="feed-item-header">
          <span class="feed-title" style="color: ${log.severity === 'CRITICAL' ? 'var(--rose)' : log.severity === 'WARNING' ? 'var(--amber)' : 'var(--cyan)'}">
            ${log.severity === 'CRITICAL' ? '🛑' : log.severity === 'WARNING' ? '⚠️' : 'ℹ️'} ${log.event_type}
          </span>
          <span class="feed-time">${new Date(log.created_at).toLocaleTimeString()}</span>
        </div>
        <div style="font-size: 12px; font-family: monospace; color: var(--text-muted); word-break: break-all;">
          ${JSON.stringify(log.details)}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load audit logs:', err.message);
  }
}

// Helpers
function formatStatus(status) {
  switch (status) {
    case 'ACTIVE': return 'Active • Monitoring';
    case 'PENDING_CHECKIN': return 'Pending Check-in';
    case 'GRACE_PERIOD': return 'Grace Period Active';
    case 'TRIGGERED': return 'Triggered & Dispatched';
    default: return status;
  }
}

function formatSeconds(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
