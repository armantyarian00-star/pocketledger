import {
  loadState,
  saveState,
  exportBackupJSON,
  importBackupJSON,
  exportTransactionsCSV,
  resetState,
  INITIAL_CATEGORIES,
  DEFAULT_CATEGORY_LABELS,
  DEFAULT_KIND_SIDE
} from './storage';
import {
  calculateSafeToSpend,
  addTransaction,
  markBillPaid,
  updateCheckingBalance,
  calculateEnvelopes,
  getMonthCalendarDays,
  saveEnvelope,
  deleteEnvelope,
  calculateGoals,
  saveGoal,
  deleteGoal,
  calculateDebts,
  saveDebt,
  deleteDebt,
  formatCurrency,
  calculateMonthSummary,
  calculateRunToPayday,
  calculateMilestones,
  calculateIncomeSummary,
  addIncome,
  deleteIncome,
  updateIncomeStatus
} from './engine';
import { formatISODate, parseISODate } from './payday';
import { LedgerState, ThemeMode, SpendCategory, LayoutMode, ColorSchemeId, IncomeItem, MonthNoteItem } from './types';

let state: LedgerState = loadState();

function getTodayStr(): string {
  return formatISODate(new Date());
}

function fmt(cents: number): string {
  return formatCurrency(cents, state.currency);
}

// Color Scheme Application
function applyColorScheme(scheme: ColorSchemeId) {
  document.documentElement.setAttribute('data-color-scheme', scheme || 'royal-glimmer');
}
applyColorScheme(state.colorScheme || 'royal-glimmer');

// Layout Application (Everything vs Simple)
function applyLayoutMode(mode: LayoutMode) {
  if (mode === 'simple') {
    document.body.classList.add('layout-mode-simple');
  } else {
    document.body.classList.remove('layout-mode-simple');
  }

  const btnSimple = document.getElementById('btn-view-mode-simple');
  const btnAdvanced = document.getElementById('btn-view-mode-advanced');
  if (btnSimple && btnAdvanced) {
    const isSimple = mode === 'simple';
    btnSimple.classList.toggle('active', isSimple);
    btnAdvanced.classList.toggle('active', !isSimple);
    btnSimple.setAttribute('aria-pressed', isSimple ? 'true' : 'false');
    btnAdvanced.setAttribute('aria-pressed', !isSimple ? 'true' : 'false');
  }

  const layoutToggleContainer = document.getElementById('layout-toggle-container');
  layoutToggleContainer?.querySelectorAll('.layout-pill').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-layout') === mode);
  });
}
applyLayoutMode(state.layoutMode || 'everything');

// Theme Application
function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.remove('theme-light', 'theme-dark');
  if (theme === 'dark') {
    document.documentElement.classList.add('theme-dark');
  } else {
    document.documentElement.classList.add('theme-light');
  }
}
applyTheme(state.theme);

// File System Access API Desktop Auto-Save Handle
let autoSaveHandle: any = null;
let syncPushTimer: ReturnType<typeof setTimeout> | null = null;

function syncPushDebounced() {
  if (!state.sync?.isSynced || !state.sync?.vaultId) return;
  if (syncPushTimer) clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(() => {
    fetch(`/api/sync/vault?id=${state.sync!.vaultId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vaultId: state.sync!.vaultId, state })
    }).catch(() => {});
  }, 1000);
}

async function pullSyncVaultSilent() {
  if (!state.sync?.isSynced || !state.sync?.vaultId) return;
  try {
    const res = await fetch(`/api/sync/vault?id=${state.sync.vaultId}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && data.state && data.updatedAt && (!state.sync.lastSyncedAt || data.updatedAt > state.sync.lastSyncedAt)) {
      const currentVaultId = state.sync.vaultId;
      const currentDeviceId = state.sync.deviceId;
      Object.assign(state, data.state);
      state.sync = {
        ...(state.sync || {}),
        isSynced: true,
        syncStatus: 'synced',
        lastSyncedAt: data.updatedAt,
        vaultId: currentVaultId,
        deviceId: currentDeviceId
      };
      saveState(state);
      renderAll();
      renderSyncSettings();
    }
  } catch {
    // quiet
  }
}

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    pullSyncVaultSilent();
  }
});
window.addEventListener('focus', () => {
  pullSyncVaultSilent();
});

async function persistState() {
  saveState(state);
  syncPushDebounced();
  if (autoSaveHandle) {
    try {
      const writable = await autoSaveHandle.createWritable();
      await writable.write(exportBackupJSON(state));
      await writable.close();
    } catch (err) {
      console.warn('Auto-save write failed:', err);
    }
  }
}

// Calendar View State
let currentCalDate = new Date();
let selectedCalDateStr = getTodayStr();

// DOM Elements: Header & Navigation
const navLinks = document.querySelectorAll('.nav-link');
const screens = document.querySelectorAll('.screen');
const monthTabs = document.querySelectorAll('.month-tab');

function setActiveTab(tabName: string) {
  navLinks.forEach(b => b.classList.remove('active'));
  screens.forEach(s => s.classList.remove('active'));

  const activeBtn = document.querySelector(`.nav-link[data-tab="${tabName}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  const targetScreen = document.getElementById(`screen-${tabName}`);
  if (targetScreen) targetScreen.classList.add('active');

  if (tabName === 'month') {
    renderCalendar();
    renderAgenda();
  } else if (tabName === 'envelopes') {
    renderEnvelopes();
  } else if (tabName === 'goals') {
    renderGoals();
  } else if (tabName === 'debt') {
    renderDebts();
  } else if (tabName === 'income') {
    renderIncome();
  } else if (tabName === 'milestones') {
    renderMilestones();
  } else if (tabName === 'settings') {
    renderSettings();
  }
}

function navigateToTab(tabName: string) {
  if (['goals', 'debt', 'envelopes'].includes(tabName) && state.layoutMode === 'simple') {
    state.layoutMode = 'everything';
    persistState();
    applyLayoutMode('everything');
    showUndoToast(`Switched to Advanced view to display ${tabName}`);
  }
  setActiveTab(tabName);
}

navLinks.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.getAttribute('data-tab');
    if (tabName) setActiveTab(tabName);
  });
});

// Month tabs along the right edge
monthTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const monthIndex = parseInt(tab.getAttribute('data-month') || '0', 10);
    currentCalDate.setMonth(monthIndex);
    setActiveTab('month');
  });
});

// Currency symbol helper for steppers & compact UI
function getCurrencySymbol(curr: string): string {
  switch (curr) {
    case 'USD': return '$';
    case 'GBP': return '£';
    case 'EUR': return '€';
    case 'JPY': return '¥';
    case 'INR': return '₹';
    case 'AUD': return 'A$';
    case 'CAD': return 'C$';
    case 'CHF': return 'CHF ';
    case 'SEK': return 'kr ';
    case 'PLN': return 'zł ';
    case 'BRL': return 'R$ ';
    case 'ZAR': return 'R ';
    case 'AED': return 'AED ';
    case 'SGD': return 'S$';
    case 'IDR': return 'Rp ';
    default: return '$';
  }
}

// Top Workspace Header
const topDateDisplay = document.getElementById('top-date-display')!;
const topGreetingDisplay = document.getElementById('top-greeting-display')!;
const topPlannerTitle = document.getElementById('top-planner-title');
const sidebarPlannerTitle = document.getElementById('sidebar-planner-title');
const btnHeaderLogTrigger = document.getElementById('btn-header-log-trigger');

function updateHeaderGreeting() {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
  topDateDisplay.textContent = now.toLocaleDateString('en-US', options).toUpperCase();

  const hour = now.getHours();
  let baseGreeting = 'Good evening';
  if (hour < 12) {
    baseGreeting = 'Good morning';
  } else if (hour < 18) {
    baseGreeting = 'Good afternoon';
  }

  if (state.userName && state.userName.trim()) {
    topGreetingDisplay.textContent = `${baseGreeting}, ${state.userName.trim()}`;
  } else {
    topGreetingDisplay.textContent = baseGreeting;
  }

  if (topPlannerTitle) {
    topPlannerTitle.textContent = state.plannerTitle && state.plannerTitle.trim()
      ? state.plannerTitle.trim()
      : 'Budget and Planner · Calm Money & Safe Spend';
  }

  if (sidebarPlannerTitle) {
    sidebarPlannerTitle.textContent = state.plannerTitle && state.plannerTitle.trim()
      ? state.plannerTitle.trim()
      : 'Budget & Planner';
  }

  const sidebarAvatar = document.getElementById('sidebar-user-avatar');
  const sidebarUserTitle = document.getElementById('sidebar-user-title');
  if (sidebarAvatar) {
    sidebarAvatar.textContent = state.userName && state.userName.trim()
      ? state.userName.trim().charAt(0).toUpperCase()
      : 'B';
  }
  if (sidebarUserTitle) {
    sidebarUserTitle.textContent = state.plannerTitle && state.plannerTitle.trim()
      ? state.plannerTitle.trim()
      : 'My Everyday Money Plan';
  }
}

btnHeaderLogTrigger?.addEventListener('click', () => {
  openLogSpendModal();
});

// DOM Elements: Today Screen
const heroAmount = document.getElementById('hero-amount')!;
const heroPeriodInfo = document.getElementById('hero-period-info')!;
const heroSafeTotal = document.getElementById('hero-safe-total')!;

const bdChecking = document.getElementById('bd-checking')!;
const bdBillsDue = document.getElementById('bd-bills-due')!;
const bdAnnualReserve = document.getElementById('bd-annual-reserve')!;
const bdSpent = document.getElementById('bd-spent')!;
const bdSetAside = document.getElementById('bd-set-aside')!;
const bdSafeTotal = document.getElementById('bd-safe-total')!;

const todayTxCount = document.getElementById('today-tx-count')!;
const todayTxList = document.getElementById('today-tx-list')!;
const focusPeriodTag = document.getElementById('focus-period-tag');

// Checklist elements
const chkLogToday = document.getElementById('chk-log-today') as HTMLInputElement;
const chkBalanceSet = document.getElementById('chk-balance-set') as HTMLInputElement;
const chkStayUnder = document.getElementById('chk-stay-under') as HTMLInputElement;
const checklistProgressText = document.getElementById('checklist-progress-text');

// Sidebar Log Spend Trigger Elements
const sidebarLogPanel = document.getElementById('sidebar-log-panel');
const sidebarLogWell = document.getElementById('sidebar-log-well-trigger');
const btnSidebarLogLaunch = document.getElementById('btn-sidebar-log-launch');

// DOM Elements: Month Screen
const calMonthTitle = document.getElementById('cal-month-title')!;
const btnPrevMonth = document.getElementById('btn-prev-month')!;
const btnNextMonth = document.getElementById('btn-next-month')!;
const btnMonthToday = document.getElementById('btn-month-today')!;
const calDaysContainer = document.getElementById('calendar-days-container')!;

const agendaDateTitle = document.getElementById('agenda-date-title')!;
const agendaDaySummary = document.getElementById('agenda-day-summary')!;
const agendaEventsList = document.getElementById('agenda-events-list')!;
const formAgendaSpend = document.getElementById('form-agenda-spend') as HTMLFormElement;
const agendaSpendAmount = document.getElementById('agenda-spend-amount') as HTMLInputElement;
const agendaSpendCategory = document.getElementById('agenda-spend-category') as HTMLInputElement;

// DOM Elements: Envelopes Screen
const envTotalLeft = document.getElementById('env-total-left')!;
const envTotalSpent = document.getElementById('env-total-spent')!;
const envTotalCaps = document.getElementById('env-total-caps')!;
const envTotalProgressBar = document.getElementById('env-total-progress-bar')!;
const envelopesContainer = document.getElementById('envelopes-container')!;
const formAddEnvelope = document.getElementById('form-add-envelope') as HTMLFormElement;

// DOM Elements: Goals Screen
const goalTotalSaved = document.getElementById('goal-total-saved')!;
const goalTotalTarget = document.getElementById('goal-total-target')!;
const goalTotalMonthly = document.getElementById('goal-total-monthly')!;
const goalTotalProgressBar = document.getElementById('goal-total-progress-bar')!;
const goalsContainer = document.getElementById('goals-container')!;
const formAddGoal = document.getElementById('form-add-goal') as HTMLFormElement;

// DOM Elements: Debt Screen
const debtStrategyTitle = document.getElementById('debt-strategy-title')!;
const btnStrategySnowball = document.getElementById('btn-strategy-snowball')!;
const btnStrategyAvalanche = document.getElementById('btn-strategy-avalanche')!;
const debtTotalBalance = document.getElementById('debt-total-balance')!;
const debtTotalMin = document.getElementById('debt-total-min')!;
const debtPayoffHorizon = document.getElementById('debt-payoff-horizon')!;
const debtsContainer = document.getElementById('debts-container')!;
const formAddDebt = document.getElementById('form-add-debt') as HTMLFormElement;

// DOM Elements: Bills Screen
const billsList = document.getElementById('bills-list')!;
const formAddBill = document.getElementById('form-add-bill') as HTMLFormElement;
const billRecurrenceSelect = document.getElementById('bill-recurrence') as HTMLSelectElement;
const groupBillMonth = document.getElementById('group-bill-month')!;

// DOM Elements: Settings Screen
const settingCurrency = document.getElementById('setting-currency') as HTMLSelectElement;
const btnThemeLight = (document.getElementById('btn-theme-light') || document.getElementById('btn-theme-soft')) as HTMLButtonElement | null;
const btnThemeDark = (document.getElementById('btn-theme-dark') || document.getElementById('btn-theme-midnight')) as HTMLButtonElement | null;
const formUpdateBalance = document.getElementById('form-update-balance') as HTMLFormElement;
const inputNewBalance = document.getElementById('input-new-balance') as HTMLInputElement;
const balanceAsOfNote = document.getElementById('balance-as-of-note')!;
const formUpdatePayday = document.getElementById('form-update-payday') as HTMLFormElement;
const payAmountInput = document.getElementById('pay-amount') as HTMLInputElement;
const payAnchorInput = document.getElementById('pay-anchor') as HTMLInputElement;
const payCycleSelect = document.getElementById('pay-cycle') as HTMLSelectElement;
const paySetAsideInput = document.getElementById('pay-setaside') as HTMLInputElement;
const btnToggleAutosave = document.getElementById('btn-toggle-autosave')!;
const autosaveStatusBadge = document.getElementById('autosave-status-badge')!;

// Recurrence UI toggle
billRecurrenceSelect?.addEventListener('change', () => {
  if (billRecurrenceSelect.value === 'annual') {
    groupBillMonth.style.display = 'flex';
  } else {
    groupBillMonth.style.display = 'none';
  }
});
if (billRecurrenceSelect) {
  groupBillMonth.style.display = billRecurrenceSelect.value === 'annual' ? 'flex' : 'none';
}

// ==========================================
// CATEGORIES & STEPPERS (USER-CONTROLLED QUICK LOG)
// ==========================================

function getAvailableCategories(): string[] {
  const defaults = ['Food', 'Coffee', 'Transit', 'Shopping', 'Other'];
  const fromEnvelopes = (state.envelopes || []).map(e => e.category.trim());
  const fromTransactions = (state.transactions || []).map(t => t.category.trim());
  const set = new Set([...fromEnvelopes, ...defaults, ...fromTransactions].filter(Boolean));
  return Array.from(set);
}

function updateCategoryOptions() {
  const categories = getAvailableCategories();
  const optionsHtml = categories.map(c => `<option value="${c}">${c}</option>`).join('');

  const catDatalist = document.getElementById('category-options');
  if (catDatalist) catDatalist.innerHTML = optionsHtml;
}

// ====================================================
// MODAL LOG SPEND & BRAIN DUMP SYSTEM (adhdbudget style)
// ====================================================

const modalLogSpend = document.getElementById('modal-log-spend') as HTMLDialogElement | null;
const modalLogAmountDisplay = document.getElementById('modal-log-amount-display');
const modalInputExact = document.getElementById('modal-input-exact') as HTMLInputElement | null;
const modalSteppersContainer = document.getElementById('modal-steppers-container');
const modalCategoryChips = document.getElementById('modal-category-chips');
const modalLogDate = document.getElementById('modal-log-date') as HTMLInputElement | null;
const modalLogNote = document.getElementById('modal-log-note') as HTMLInputElement | null;
const btnModalLogSubmit = document.getElementById('btn-modal-log-submit');
const modalLogHelpPanel = document.getElementById('modal-log-help-panel');
const btnCloseLogHelpPanel = document.getElementById('btn-close-log-help-panel');
const btnHelpLogSpend = document.getElementById('btn-help-log-spend');
const btnHelpLogDate = document.getElementById('btn-help-log-date');
const linkModalEditCategories = document.getElementById('link-modal-edit-categories');

let modalActiveCategory = 'Coffee';

function formatShortDate(dateStr: string): string {
  try {
    const d = parseISODate(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const curYear = new Date().getFullYear();
    if (d.getFullYear() === curYear) {
      return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    }
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}, ${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

function updateModalSubmitButtonText() {
  if (!btnModalLogSubmit) return;
  const todayStr = getTodayStr();
  const selectedDate = modalLogDate?.value || todayStr;

  if (selectedDate === todayStr) {
    btnModalLogSubmit.textContent = 'Add to today';
  } else {
    btnModalLogSubmit.textContent = `Add to ${formatShortDate(selectedDate)}`;
  }
}

function updateModalAmountDisplay() {
  if (!modalLogAmountDisplay) return;
  const val = parseFloat(modalInputExact?.value || '0');
  const cents = isNaN(val) ? 0 : Math.round(val * 100);
  modalLogAmountDisplay.textContent = fmt(cents);

  const wellNote = document.getElementById('modal-log-well-note');
  if (wellNote) {
    const todayStr = getTodayStr();
    const selectedDate = modalLogDate?.value || todayStr;
    if (selectedDate !== todayStr) {
      wellNote.textContent = `for ${formatShortDate(selectedDate)} — type the amount`;
    } else {
      wellNote.textContent = 'type the exact amount or use the quick keys';
    }
  }
}

function renderModalSteppers() {
  if (!modalSteppersContainer) return;
  modalSteppersContainer.innerHTML = '';

  const isIdr = state.currency === 'IDR';
  const isJpy = state.currency === 'JPY';

  let stepValues: { label: string; value: number }[] = [];
  if (isIdr) {
    stepValues = [
      { label: '+ 5k', value: 5000 },
      { label: '+ 10k', value: 10000 },
      { label: '+ 20k', value: 20000 },
      { label: '+ 50k', value: 50000 },
      { label: '+ 100k', value: 100000 }
    ];
  } else if (isJpy) {
    stepValues = [
      { label: '+ 100', value: 100 },
      { label: '+ 500', value: 500 },
      { label: '+ 1k', value: 1000 },
      { label: '+ 2k', value: 2000 },
      { label: '+ 5k', value: 5000 }
    ];
  } else {
    const sym = getCurrencySymbol(state.currency);
    stepValues = [
      { label: `+${sym}1`, value: 1 },
      { label: `+${sym}5`, value: 5 },
      { label: `+${sym}10`, value: 10 },
      { label: `+${sym}20`, value: 20 }
    ];
  }

  stepValues.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-stepper-key';
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      if (!modalInputExact) return;
      const cur = parseFloat(modalInputExact.value) || 0;
      modalInputExact.value = (cur + item.value).toString();
      updateModalAmountDisplay();
      modalInputExact.focus();
    });
    modalSteppersContainer.appendChild(btn);
  });

  // Reset / Clear button
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'modal-stepper-key key--reset';
  resetBtn.setAttribute('aria-label', 'Clear amount');
  resetBtn.title = 'Clear amount';
  resetBtn.innerHTML = '&#8634;';
  resetBtn.addEventListener('click', () => {
    if (modalInputExact) modalInputExact.value = '';
    updateModalAmountDisplay();
    modalInputExact?.focus();
  });
  modalSteppersContainer.appendChild(resetBtn);
}

function renderModalCategoryChips() {
  if (!modalCategoryChips) return;
  modalCategoryChips.innerHTML = '';

  const categories = (state.categories && state.categories.length > 0)
    ? state.categories
    : INITIAL_CATEGORIES;

  // Filter categories marked as quick buttons in Settings
  const quickCats = categories.filter(c => c.isQuick);
  const catsToRender = quickCats.length > 0 ? quickCats : categories;

  // Ensure active category is valid
  if (!catsToRender.some(c => c.name === modalActiveCategory)) {
    modalActiveCategory = catsToRender[0]?.name || 'Other';
  }

  catsToRender.forEach(cat => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.setAttribute('data-cat', cat.name);
    chip.className = `chip-item ${cat.name === modalActiveCategory ? 'active' : ''}`;
    chip.innerHTML = `<span class="chip-dot" style="background: ${cat.color};"></span>${cat.name}`;
    chip.addEventListener('click', () => {
      modalActiveCategory = cat.name;
      modalCategoryChips?.querySelectorAll('.chip-item').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
    modalCategoryChips.appendChild(chip);
  });
}

function openLogSpendModal() {
  if (!modalLogSpend) return;
  // Hide left sidebar log spend widget!
  document.body.classList.add('modal-log-open');

  const todayStr = getTodayStr();
  if (modalLogDate) modalLogDate.value = todayStr;
  updateModalSubmitButtonText();

  if (modalLogHelpPanel) modalLogHelpPanel.style.display = 'none';

  const todaysTx = state.transactions.filter(t => t.date === todayStr);
  const modalLoggedCount = document.getElementById('modal-logged-today-count');
  if (modalLoggedCount) {
    modalLoggedCount.textContent = `${todaysTx.length} logged today`;
  }

  renderModalSteppers();
  renderModalCategoryChips();

  // Reset inputs
  if (modalInputExact) modalInputExact.value = '';
  if (modalLogNote) modalLogNote.value = '';

  updateModalAmountDisplay();
  modalLogSpend.showModal();
  setTimeout(() => modalInputExact?.focus(), 50);
}

function closeLogSpendModal() {
  if (!modalLogSpend) return;
  document.body.classList.remove('modal-log-open');
  if (modalLogHelpPanel) modalLogHelpPanel.style.display = 'none';
  modalLogSpend.close();
}

const modalHowItWorks = document.getElementById('modal-how-it-works') as HTMLDialogElement | null;
const modalDevicePair = document.getElementById('modal-device-pair') as HTMLDialogElement | null;
const modalDeviceJoin = document.getElementById('modal-device-join') as HTMLDialogElement | null;
const modalRecoveryKey = document.getElementById('modal-recovery-key') as HTMLDialogElement | null;
const modalSyncHelp = document.getElementById('modal-sync-help') as HTMLDialogElement | null;

let pairCountdownTimer: ReturnType<typeof setInterval> | null = null;
let pairPollInterval: ReturnType<typeof setInterval> | null = null;

function ensureSyncState() {
  if (!state.sync) {
    state.sync = {
      isSynced: true,
      syncStatus: 'synced',
      lastSyncedAt: Date.now(),
      recoveryKey: 'PL-8A2F-9C4D-7E1B',
      pairingCode: '553 699',
      pairingExpiresAt: Date.now() + 10 * 60 * 1000,
      deviceId: 'dev_' + Math.random().toString(36).substring(2, 9),
      vaultId: 'vault_' + Math.random().toString(36).substring(2, 9)
    };
  } else {
    if (!state.sync.deviceId) {
      state.sync.deviceId = 'dev_' + Math.random().toString(36).substring(2, 9);
    }
    if (!state.sync.vaultId) {
      state.sync.vaultId = 'vault_' + Math.random().toString(36).substring(2, 9);
    }
  }
}

function openHowItWorksModal() {
  if (!modalHowItWorks) return;
  modalHowItWorks.showModal();
}

function closeHowItWorksModal() {
  if (!modalHowItWorks) return;
  modalHowItWorks.close();
}

function openDevicePairModal() {
  ensureSyncState();
  const code1 = Math.floor(100 + Math.random() * 900);
  const code2 = Math.floor(100 + Math.random() * 900);
  state.sync!.pairingCode = `${code1} ${code2}`;
  state.sync!.pairingExpiresAt = Date.now() + 10 * 60 * 1000;
  persistState();

  const display = document.getElementById('device-pairing-code-display');
  if (display) display.textContent = state.sync!.pairingCode;

  const timerEl = document.getElementById('device-code-countdown');
  if (timerEl) timerEl.textContent = '10 minutes';

  const waitingLabel = document.getElementById('device-waiting-label');
  if (waitingLabel) {
    waitingLabel.innerHTML = 'Waiting for the other device&hellip;';
  }

  const cleanCode = state.sync!.pairingCode.replace(/\s+/g, '');
  fetch('/api/sync/pair/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: cleanCode,
      deviceId: state.sync!.deviceId,
      vaultId: state.sync!.vaultId,
      state: state
    })
  }).catch(err => console.warn('Could not register pairing with relay:', err));

  if (pairCountdownTimer) clearInterval(pairCountdownTimer);
  let remainingSec = 600;
  pairCountdownTimer = setInterval(() => {
    remainingSec--;
    if (remainingSec <= 0) {
      if (pairCountdownTimer) clearInterval(pairCountdownTimer);
      if (timerEl) timerEl.textContent = 'expired';
    } else {
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      if (timerEl) timerEl.textContent = `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
    }
  }, 1000);

  if (pairPollInterval) clearInterval(pairPollInterval);
  pairPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/sync/pair/status?code=${cleanCode}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.paired) {
        if (pairPollInterval) {
          clearInterval(pairPollInterval);
          pairPollInterval = null;
        }
        if (pairCountdownTimer) {
          clearInterval(pairCountdownTimer);
          pairCountdownTimer = null;
        }
        state.sync!.isSynced = true;
        state.sync!.syncStatus = 'synced';
        state.sync!.lastSyncedAt = Date.now();
        if (data.vaultId) state.sync!.vaultId = data.vaultId;
        persistState();

        const waitEl = document.getElementById('device-waiting-label');
        if (waitEl) {
          waitEl.innerHTML = '<strong style="color:var(--success, #10b981);">&#10003; Connected with other device!</strong>';
        }
        setTimeout(() => {
          closeDevicePairModal();
          renderSyncSettings();
          showUndoToast('✓ Connected and synced with your other device!');
        }, 1200);
      }
    } catch {
      // quiet
    }
  }, 1200);

  modalDevicePair?.showModal();
}

function closeDevicePairModal() {
  if (pairCountdownTimer) {
    clearInterval(pairCountdownTimer);
    pairCountdownTimer = null;
  }
  if (pairPollInterval) {
    clearInterval(pairPollInterval);
    pairPollInterval = null;
  }
  modalDevicePair?.close();
}

function openDeviceJoinModal() {
  ensureSyncState();
  const input = document.getElementById('input-sync-pair-code') as HTMLInputElement | null;
  const feedback = document.getElementById('device-join-feedback');
  if (input) input.value = '';
  if (feedback) {
    feedback.style.display = 'none';
    feedback.className = 'device-join-feedback';
    feedback.textContent = '';
  }
  modalDeviceJoin?.showModal();
  setTimeout(() => input?.focus(), 60);
}

function closeDeviceJoinModal() {
  modalDeviceJoin?.close();
}

function openRecoveryKeyModal() {
  ensureSyncState();
  const keyDisplay = document.getElementById('display-recovery-key-text');
  if (keyDisplay) keyDisplay.textContent = state.sync!.recoveryKey || 'PL-8A2F-9C4D-7E1B';
  modalRecoveryKey?.showModal();
}

function closeRecoveryKeyModal() {
  modalRecoveryKey?.close();
}

function openSyncHelpModal() {
  modalSyncHelp?.showModal();
}

function closeSyncHelpModal() {
  modalSyncHelp?.close();
}

(window as any).openLogSpendModal = openLogSpendModal;
(window as any).closeLogSpendModal = closeLogSpendModal;
(window as any).openHowItWorksModal = openHowItWorksModal;
(window as any).closeHowItWorksModal = closeHowItWorksModal;
(window as any).openDevicePairModal = openDevicePairModal;
(window as any).closeDevicePairModal = closeDevicePairModal;
(window as any).openDeviceJoinModal = openDeviceJoinModal;
(window as any).closeDeviceJoinModal = closeDeviceJoinModal;
(window as any).openRecoveryKeyModal = openRecoveryKeyModal;
(window as any).closeRecoveryKeyModal = closeRecoveryKeyModal;
(window as any).openSyncHelpModal = openSyncHelpModal;
(window as any).closeSyncHelpModal = closeSyncHelpModal;

function renderSteppers() {
  // Handled in modal
}

// ==========================================
// RENDER FUNCTIONS
// ==========================================

function renderToday() {
  const todayStr = getTodayStr();
  const calc = calculateSafeToSpend(state, todayStr);

  heroAmount.textContent = fmt(calc.safeToSpendToday);
  if (calc.spentTodayCents > 0) {
    heroPeriodInfo.textContent = `${fmt(calc.safeToSpendToday)} left of today's starting ${fmt(calc.dailyStartingAllowance)} (${fmt(calc.spentTodayCents)} spent today) · ${calc.daysLeft} days to payday (${calc.nextPayday})`;
  } else {
    heroPeriodInfo.textContent = `of today's starting ${fmt(calc.dailyStartingAllowance)} · ${calc.daysLeft} days to payday (${calc.nextPayday})`;
  }
  heroSafeTotal.textContent = fmt(calc.safeUntilPayday);

  bdChecking.textContent = `+ ${fmt(calc.checkingBalance)}`;
  bdBillsDue.textContent = `- ${fmt(calc.billsDueCents)}`;
  if (bdAnnualReserve) bdAnnualReserve.textContent = `- ${fmt(calc.annualReserveCents)}`;
  bdSpent.textContent = `- ${fmt(calc.spentTodayCents)}`;
  bdSetAside.textContent = `- ${fmt(calc.setAsideCents)}`;
  bdSafeTotal.textContent = fmt(calc.safeUntilPayday);

  if (focusPeriodTag) {
    focusPeriodTag.textContent = `${calc.daysLeft} day${calc.daysLeft === 1 ? '' : 's'} to pay`;
  }

  // Update Three Small Things checklist
  const todaysTx = state.transactions.filter(t => t.date === todayStr);
  const done1 = todaysTx.length > 0;
  const done2 = state.account.balance > 0;
  const done3 = state.account.balance > 0 && calc.spentTodayCents <= calc.dailyStartingAllowance;

  if (chkLogToday) chkLogToday.checked = done1;
  if (chkBalanceSet) chkBalanceSet.checked = done2;
  if (chkStayUnder) chkStayUnder.checked = done3;

  const lblStayUnder = document.getElementById('lbl-stay-under');
  if (lblStayUnder) {
    lblStayUnder.textContent = `Keep today under ${fmt(calc.dailyStartingAllowance)}`;
  }

  const doneCount = (done1 ? 1 : 0) + (done2 ? 1 : 0) + (done3 ? 1 : 0);
  if (checklistProgressText) {
    if (doneCount === 3) {
      checklistProgressText.textContent = 'all three done';
    } else {
      checklistProgressText.textContent = `${doneCount} of 3 done`;
    }
  }

  const cardMotto = document.querySelector('.card-footer-motto');
  if (cardMotto) {
    if (doneCount === 3) {
      cardMotto.textContent = '\u201Cthree down. that counts.\u201D';
    } else if (doneCount === 2) {
      cardMotto.textContent = '\u201Ctwo down. almost there.\u201D';
    } else if (doneCount === 1) {
      cardMotto.textContent = '\u201Cone down. that counts.\u201D';
    } else {
      cardMotto.textContent = '\u201Cdo one, feel better \u2013 that\'s the whole trick\u201D';
    }
  }

  // Update Top focus strip
  const focusStripText = document.getElementById('focus-strip-text');
  const focusNumberBadge = document.querySelector('.focus-number-badge');
  const focusMicro = document.querySelector('.focus-micro');
  if (doneCount === 3) {
    if (focusMicro) focusMicro.textContent = 'ALL THREE DONE \u00B7 THAT COUNTS';
    if (focusStripText) focusStripText.textContent = "You're all set for today. Safe to spend is working.";
    if (focusNumberBadge) focusNumberBadge.textContent = '\u2713';
  } else if (!done1) {
    if (focusMicro) focusMicro.textContent = 'RIGHT NOW \u00B7 ONE THING ONLY';
    if (focusStripText) focusStripText.textContent = 'Log anything you spent today';
    if (focusNumberBadge) focusNumberBadge.textContent = '1';
  } else if (!done2) {
    if (focusMicro) focusMicro.textContent = 'RIGHT NOW \u00B7 ONE THING ONLY';
    if (focusStripText) focusStripText.textContent = 'Put in what is actually in checking';
    if (focusNumberBadge) focusNumberBadge.textContent = '2';
  } else {
    if (focusMicro) focusMicro.textContent = 'RIGHT NOW \u00B7 ONE THING ONLY';
    if (focusStripText) focusStripText.textContent = `Keep today under ${fmt(calc.dailyStartingAllowance)}`;
    if (focusNumberBadge) focusNumberBadge.textContent = '3';
  }

  // Quick log status counter (sidebar & modal)
  const sidebarLoggedTodayCount = document.getElementById('sidebar-logged-today-count');
  if (sidebarLoggedTodayCount) {
    sidebarLoggedTodayCount.textContent = `${todaysTx.length} logged today`;
  }
  const modalLoggedTodayCount = document.getElementById('modal-logged-today-count');
  if (modalLoggedTodayCount) {
    modalLoggedTodayCount.textContent = `${todaysTx.length} logged today`;
  }
  const sidebarLogAmountDisplay = document.getElementById('sidebar-log-amount-display');
  if (sidebarLogAmountDisplay) {
    sidebarLogAmountDisplay.textContent = fmt(calc.spentTodayCents);
  }

  todayTxCount.textContent = `${todaysTx.length} entr${todaysTx.length === 1 ? 'y' : 'ies'}`;

  // Render What You Logged List
  if (todaysTx.length === 0) {
    todayTxList.innerHTML = `
      <div class="empty-state-box" style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
        <span>nothing logged yet. anything you add lands here, editable.</span>
        <button type="button" class="btn btn-primary" id="btn-empty-log-spend" style="padding: 6px 14px; font-size: 0.82rem; border-radius: 9999px;">
          + Log a spend
        </button>
      </div>
    `;
    document.getElementById('btn-empty-log-spend')?.addEventListener('click', () => {
      openLogSpendModal();
    });
  } else {
    todayTxList.innerHTML = '';
    todaysTx.forEach(tx => {
      const row = document.createElement('div');
      row.className = 'tx-row';
      const metaParts: string[] = [
        new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      ];
      if (tx.note) metaParts.push(`"${tx.note}"`);
      if (tx.account) metaParts.push(tx.account);
      if (tx.card) metaParts.push('Card');
      if (tx.owed) metaParts.push('Owed');

      row.innerHTML = `
        <div class="tx-row-left" style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px;">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span class="badge" style="background: var(--primary-light); color: var(--primary);">${tx.category}</span>
            <span class="item-meta">${metaParts.join(' &middot; ')}</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <strong style="font-family: var(--text-serif); font-size: 1.05rem;">${fmt(tx.amount)}</strong>
          <button type="button" class="btn btn-ghost" data-delete-tx="${tx.id}" style="padding: 2px 8px; font-size: 0.8rem; color: var(--danger);">Undo</button>
        </div>
      `;
      todayTxList.appendChild(row);
    });
  }

  renderSteppers();
  updateCategoryOptions();
}

function renderBills() {
  const todayStr = getTodayStr();
  billsList.innerHTML = '';

  if (state.bills.length === 0) {
    billsList.innerHTML = '<div class="empty-state-box">No bills added yet.</div>';
  } else {
    const currentYearMonth = todayStr.slice(0, 7);
    state.bills.forEach(bill => {
      const isAnnual = bill.recurrence === 'annual';
      const monthPrefix = isAnnual ? `${todayStr.slice(0, 4)}-${String(bill.dueMonth || 1).padStart(2, '0')}` : currentYearMonth;
      const dueDateThisMonth = `${monthPrefix}-${String(bill.dueDay).padStart(2, '0')}`;
      const isPaid = bill.paidDates.includes(dueDateThisMonth);

      const row = document.createElement('div');
      row.className = `item-row ${isPaid ? 'is-paid' : ''}`;
      row.innerHTML = `
        <div class="item-row-left">
          <input type="checkbox" data-bill-id="${bill.id}" data-due="${dueDateThisMonth}" ${isPaid ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
          <div>
            <strong>${bill.name}</strong>
            <div class="item-meta">
              ${isAnnual ? `Annual (Due Month ${bill.dueMonth}, Day ${bill.dueDay}) &middot; ${fmt(Math.floor(bill.amount / 12))}/mo reserve` : `Due day ${bill.dueDay} of month`}
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="badge ${isPaid ? 'badge-paid' : 'badge-due'}">${isPaid ? 'Paid' : 'Unpaid'}</span>
          <strong style="font-family: var(--text-serif);">${fmt(bill.amount)}</strong>
          <button type="button" class="btn btn-ghost" data-delete-bill="${bill.id}" style="padding: 4px 6px; font-size: 0.8rem; color: var(--danger);">&times;</button>
        </div>
      `;
      billsList.appendChild(row);
    });
  }
}

function renderEnvelopes() {
  const todayStr = getTodayStr();
  const envData = calculateEnvelopes(state, todayStr);

  envTotalLeft.textContent = fmt(envData.totalLeft);
  envTotalSpent.textContent = fmt(envData.totalSpent);
  envTotalCaps.textContent = fmt(envData.totalCaps);

  const overallPercent = envData.totalCaps > 0
    ? Math.min(100, Math.round((envData.totalSpent / envData.totalCaps) * 100))
    : 0;
  envTotalProgressBar.style.width = `${overallPercent}%`;
  envTotalProgressBar.className = `progress-fill ${envData.totalSpent > envData.totalCaps ? 'over' : ''}`;

  envelopesContainer.innerHTML = '';
  if (envData.items.length === 0) {
    envelopesContainer.innerHTML = '<div class="empty-state-box">No envelopes created yet.</div>';
    return;
  }

  envData.items.forEach(item => {
    const card = document.createElement('div');
    card.className = `module-card ${item.isOver ? 'is-over' : ''}`;
    card.innerHTML = `
      <div class="module-card-header" style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 700; font-size: 1rem;">${item.envelope.name}</span>
        <button type="button" class="btn btn-ghost" data-delete-env="${item.envelope.id}" style="padding: 2px 6px; font-size: 0.8rem; color: var(--danger);">&times;</button>
      </div>
      <div>
        <div style="font-size: 1.15rem; font-weight: 700; font-family: var(--text-serif); color: ${item.isOver ? 'var(--danger)' : 'var(--text-main)'};">
          ${fmt(item.leftCents)} <span style="font-size: 0.85rem; font-weight: normal; font-family: var(--text-sans); color: var(--text-muted);">left of ${fmt(item.envelope.cap)}</span>
        </div>
      </div>
      <div class="progress-track">
        <div class="progress-fill ${item.isOver ? 'over' : ''}" style="width: ${item.percentUsed}%;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 0.82rem; color: var(--text-muted);">
        <span>${fmt(item.spentCents)} spent</span>
        <span>${item.percentUsed}% used</span>
      </div>
    `;
    envelopesContainer.appendChild(card);
  });
}

function renderGoals() {
  const gData = calculateGoals(state);

  goalTotalSaved.textContent = fmt(gData.totalSaved);
  goalTotalTarget.textContent = fmt(gData.totalTarget);
  goalTotalMonthly.textContent = `${fmt(gData.totalMonthly)}/mo`;

  const totalPercent = gData.totalTarget > 0
    ? Math.min(100, Math.round((gData.totalSaved / gData.totalTarget) * 100))
    : 0;
  goalTotalProgressBar.style.width = `${totalPercent}%`;

  goalsContainer.innerHTML = '';
  if (gData.items.length === 0) {
    goalsContainer.innerHTML = '<div class="empty-state-box">No savings goals set yet.</div>';
    return;
  }

  gData.items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'module-card';
    const etaText = item.monthsRemaining !== null
      ? (item.monthsRemaining === 0 ? 'Goal reached!' : `${item.monthsRemaining} month${item.monthsRemaining === 1 ? '' : 's'} to target`)
      : 'No monthly pace set';

    card.innerHTML = `
      <div class="module-card-header" style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 700; font-size: 1rem;">${item.goal.name}</span>
        <button type="button" class="btn btn-ghost" data-delete-goal="${item.goal.id}" style="padding: 2px 6px; font-size: 0.8rem; color: var(--danger);">&times;</button>
      </div>
      <div>
        <div style="font-size: 1.15rem; font-weight: 700; font-family: var(--text-serif);">
          ${fmt(item.goal.savedAmount)} <span style="font-size: 0.85rem; font-weight: normal; font-family: var(--text-sans); color: var(--text-muted);">of ${fmt(item.goal.targetAmount)}</span>
        </div>
      </div>
      <div class="progress-track">
        <div class="progress-fill success" style="width: ${item.percent}%;"></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 0.82rem; color: var(--text-muted);">
        <span>${item.percent}% complete</span>
        <span>${etaText}</span>
      </div>
    `;
    goalsContainer.appendChild(card);
  });
  renderSidebarGoals();
}

function renderSidebarGoals() {
  const container = document.getElementById('sidebar-goals-list');
  const badge = document.getElementById('sidebar-goals-badge');
  if (!container) return;

  const gData = calculateGoals(state);
  const items = gData.items || [];

  if (badge) {
    badge.textContent = `${items.length} goal${items.length === 1 ? '' : 's'}`;
  }

  if (items.length === 0) {
    container.innerHTML = `
      <div class="sidebar-goal-empty">
        <span>No savings goals yet</span>
      </div>
    `;
    return;
  }

  const displayItems = items.slice(0, 3);
  container.innerHTML = displayItems.map(item => {
    const g = item.goal;
    const pct = item.percent;
    const color = pct >= 100 ? '#27c93f' : (pct >= 50 ? '#8b5cf6' : '#38bdf8');
    return `
      <div class="sidebar-goal-item" data-goal-id="${escapeHtml(g.id)}" title="Click to open Goals">
        <div class="sidebar-goal-row">
          <span class="sidebar-goal-name">${escapeHtml(g.name)}</span>
          <span class="sidebar-goal-pct">${pct}%</span>
        </div>
        <div class="sidebar-goal-bar-track">
          <div class="sidebar-goal-bar-fill" style="width: ${Math.min(100, pct)}%; background-color: ${color};"></div>
        </div>
        <div class="sidebar-goal-amounts">${fmt(g.savedAmount)} of ${fmt(g.targetAmount)}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.sidebar-goal-item').forEach(itemEl => {
    itemEl.addEventListener('click', () => {
      navigateToTab('goals');
    });
  });
}

function renderDebts() {
  const dData = calculateDebts(state);

  debtStrategyTitle.textContent = dData.strategy === 'snowball'
    ? 'Snowball Method (Smallest Balance First)'
    : 'Avalanche Method (Highest APR First)';

  btnStrategySnowball.className = `btn-group-item ${dData.strategy === 'snowball' ? 'active' : ''}`;
  btnStrategyAvalanche.className = `btn-group-item ${dData.strategy === 'avalanche' ? 'active' : ''}`;

  debtTotalBalance.textContent = fmt(dData.totalBalance);
  debtTotalMin.textContent = `${fmt(dData.totalMinPayment)}/mo`;

  if (dData.totalBalance === 0) {
    debtPayoffHorizon.textContent = 'Debt-Free!';
  } else if (dData.maxMonths >= 999) {
    debtPayoffHorizon.textContent = 'Payments too low to cover interest';
  } else {
    const yrs = (dData.maxMonths / 12).toFixed(1);
    debtPayoffHorizon.textContent = `~${dData.maxMonths} mos (${yrs} yrs)`;
  }

  debtsContainer.innerHTML = '';
  if (dData.items.length === 0) {
    debtsContainer.innerHTML = '<div class="empty-state-box">No debts on the books.</div>';
    return;
  }

  dData.items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'item-row';
    const payoffText = item.monthsToPayoff >= 999 ? 'Interest exceeds payment' : `~${item.monthsToPayoff} months to payoff`;

    row.innerHTML = `
      <div class="item-row-left">
        <div>
          <strong>${item.debt.name}</strong>
          <div class="item-meta">APR: ${item.debt.apr}% &middot; Min payment: ${fmt(item.debt.minPayment)}/mo (${payoffText})</div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <strong style="font-family: var(--text-serif);">${fmt(item.debt.balance)}</strong>
        <button type="button" class="btn btn-ghost" data-delete-debt="${item.debt.id}" style="padding: 4px 6px; font-size: 0.8rem; color: var(--danger);">&times;</button>
      </div>
    `;
    debtsContainer.appendChild(row);
  });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderMonthOverview() {
  const year = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[month];
  const monthUpper = monthName.toUpperCase();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthDateStr = `${monthPrefix}-01`;

  // 1. Update Section Eyebrows
  const notesEyebrow = document.getElementById('month-notes-eyebrow');
  if (notesEyebrow) notesEyebrow.textContent = `NOTES FOR ${monthUpper}`;
  const glanceEyebrow = document.getElementById('month-glance-eyebrow');
  if (glanceEyebrow) glanceEyebrow.textContent = `${monthUpper} AT A GLANCE`;

  // 2. Render Kept Notes
  if (!state.monthNotes) state.monthNotes = {};
  const notes = state.monthNotes[monthPrefix] || [];
  const notesCountMeta = document.getElementById('month-notes-count-meta');
  if (notesCountMeta) notesCountMeta.textContent = `${notes.length} kept`;

  const keptNotesList = document.getElementById('month-kept-notes-list');
  if (keptNotesList) {
    keptNotesList.innerHTML = '';
    if (notes.length === 0) {
      keptNotesList.innerHTML = `<div class="month-notes-empty">nothing kept for ${monthName} yet</div>`;
    } else {
      notes.forEach((note) => {
        const item = document.createElement('div');
        item.className = 'month-kept-note-item';
        const dObj = new Date(note.createdAt);
        const dateStr = dObj.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        item.innerHTML = `
          <div class="month-kept-note-content">
            <div>${escapeHtml(note.text)}</div>
            <div class="month-kept-note-date">${dateStr}</div>
          </div>
          <button type="button" class="month-note-del-btn" title="Remove this note">&times;</button>
        `;
        const delBtn = item.querySelector('.month-note-del-btn');
        delBtn?.addEventListener('click', () => {
          const removedNote = note;
          state.monthNotes![monthPrefix] = (state.monthNotes![monthPrefix] || []).filter(n => n.id !== note.id);
          persistState();
          renderMonthOverview();
          showUndoToast(`Removed note for ${monthName}`, () => {
            if (!state.monthNotes![monthPrefix]) state.monthNotes![monthPrefix] = [];
            state.monthNotes![monthPrefix].push(removedNote);
            persistState();
            renderMonthOverview();
          });
        });
        keptNotesList.appendChild(item);
      });
    }
  }

  // 3. Month Summary Cards
  const summary = calculateMonthSummary(state, monthDateStr);
  const safe = calculateSafeToSpend(state, getTodayStr());
  const labels = state.categoryLabels || {
    bills: 'Bills & rent',
    living: 'Living & food',
    fun: 'Fun & friends',
    debt: 'To debt',
    savings: 'To savings',
    leftover: 'Left over'
  };

  const cameInEl = document.getElementById('glance-came-in-val');
  const cameInSub = document.getElementById('glance-came-in-sub');
  const wentOutEl = document.getElementById('glance-went-out-val');
  const wentOutSub = document.getElementById('glance-went-out-sub');
  const keptEl = document.getElementById('glance-kept-val');
  const keptSub = document.getElementById('glance-kept-sub');
  const keptPill = document.getElementById('month-glance-kept-pill');
  const stillYoursEl = document.getElementById('glance-still-yours-val');
  const stillYoursSub = document.getElementById('glance-still-yours-sub');

  if (cameInEl) cameInEl.textContent = fmt(summary.cameInCents);
  if (cameInSub) cameInSub.textContent = summary.cameInCents > 0 ? 'from registered income' : 'no payday this month';

  if (wentOutEl) wentOutEl.textContent = fmt(summary.wentOutCents);
  if (wentOutSub) wentOutSub.textContent = 'everything due has landed';

  const netKeptCents = summary.cameInCents - summary.wentOutCents;
  const keptStr = (netKeptCents < 0 ? '-' : '') + fmt(Math.abs(netKeptCents));
  if (keptEl) keptEl.textContent = keptStr;
  if (keptSub) keptSub.textContent = 'monthly net cashflow';
  if (keptPill) keptPill.textContent = `${keptStr} kept`;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  let runwayText = `${daysInMonth} days in month`;
  if (isCurrentMonth) {
    runwayText = safe.daysLeft > 0 ? `${safe.daysLeft} days to payday` : `${Math.max(0, daysInMonth - today.getDate())} days left in month`;
  }
  if (stillYoursEl) stillYoursEl.textContent = fmt(safe.safeUntilPayday);
  if (stillYoursSub) stillYoursSub.textContent = runwayText;

  // 4. Category breakdown strip
  const valBills = document.getElementById('glance-val-bills');
  const lblBills = document.getElementById('glance-lbl-bills');
  const valLiving = document.getElementById('glance-val-living');
  const lblLiving = document.getElementById('glance-lbl-living');
  const valFun = document.getElementById('glance-val-fun');
  const lblFun = document.getElementById('glance-lbl-fun');
  const valDebt = document.getElementById('glance-val-debt');
  const lblDebt = document.getElementById('glance-lbl-debt');
  const valSavings = document.getElementById('glance-val-savings');
  const lblSavings = document.getElementById('glance-lbl-savings');
  const valLeftover = document.getElementById('glance-val-leftover');
  const lblLeftover = document.getElementById('glance-lbl-leftover');

  if (lblBills) lblBills.textContent = labels.bills || 'Bills & rent';
  if (valBills) valBills.textContent = fmt(summary.billsAndRentCents);

  if (lblLiving) lblLiving.textContent = labels.living || 'Living & food';
  if (valLiving) valLiving.textContent = fmt(summary.livingAndFoodCents);

  if (lblFun) lblFun.textContent = labels.fun || 'Fun & friends';
  if (valFun) valFun.textContent = fmt(summary.funAndFriendsCents);

  if (lblDebt) lblDebt.textContent = labels.debt || 'To debt';
  if (valDebt) valDebt.textContent = fmt(summary.toDebtCents);

  if (lblSavings) lblSavings.textContent = labels.savings || 'To savings';
  if (valSavings) valSavings.textContent = fmt(summary.toSavingsCents);

  if (lblLeftover) lblLeftover.textContent = labels.leftover || 'Left over';
  if (valLeftover) valLeftover.textContent = fmt(summary.leftOverCents);

  const guidanceEl = document.getElementById('glance-guidance-note');
  if (guidanceEl) {
    const controllableCents = summary.livingAndFoodCents + summary.funAndFriendsCents;
    guidanceEl.innerHTML = `the part you can actually adjust is the ${fmt(controllableCents)} of living &amp; fun &mdash; calm, mindful tracking`;
  }

  // 5. Activity Feed ("What's Happening")
  const activityList = document.getElementById('month-activity-items-list');
  const activityCountBadge = document.getElementById('month-activity-count-badge');

  interface MonthActivityFeedItem {
    id: string;
    date: string;
    title: string;
    sub: string;
    amountCents: number;
    isIncome: boolean;
  }

  const activities: MonthActivityFeedItem[] = [];

  (state.transactions || []).forEach(tx => {
    if (tx.date.startsWith(monthPrefix)) {
      activities.push({
        id: tx.id,
        date: tx.date,
        title: tx.category,
        sub: 'logged spend',
        amountCents: tx.amount,
        isIncome: false
      });
    }
  });

  (state.bills || []).forEach(b => {
    const dueDay = b.dueDay || 1;
    const billDateStr = `${monthPrefix}-${String(dueDay).padStart(2, '0')}`;
    const isPaid = (b.paidDates || []).some(pd => pd.startsWith(monthPrefix));
    activities.push({
      id: b.id,
      date: billDateStr,
      title: b.name,
      sub: isPaid ? 'bill paid ✓' : 'bill due',
      amountCents: b.amount,
      isIncome: false
    });
  });

  (state.incomes || []).forEach(inc => {
    if (inc.date && inc.date.startsWith(monthPrefix)) {
      activities.push({
        id: inc.id,
        date: inc.date,
        title: inc.source || 'Income',
        sub: 'payday deposit',
        amountCents: inc.amount,
        isIncome: true
      });
    }
  });

  activities.sort((a, b) => b.date.localeCompare(a.date));

  if (activityCountBadge) {
    activityCountBadge.textContent = `${activities.length} ${activities.length === 1 ? 'thing' : 'things'}`;
  }

  if (activityList) {
    activityList.innerHTML = '';
    if (activities.length === 0) {
      activityList.innerHTML = `<div class="month-notes-empty">nothing logged for ${monthName} yet</div>`;
    } else {
      activities.forEach(act => {
        const itemEl = document.createElement('div');
        itemEl.className = 'month-activity-item';
        const dObj = parseISODate(act.date);
        const dateLabel = dObj.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
        const sign = act.isIncome ? '+' : '-';
        const amtClass = act.isIncome ? 'income' : 'spent';

        itemEl.innerHTML = `
          <div class="month-activity-left">
            <span class="month-activity-date-badge">${dateLabel}</span>
            <div class="month-activity-info">
              <span class="month-activity-title">${escapeHtml(act.title)}</span>
              <span class="month-activity-sub">${escapeHtml(act.sub)}</span>
            </div>
          </div>
          <div class="month-activity-right">
            <span class="month-activity-amount ${amtClass}">${sign}${fmt(act.amountCents)}</span>
          </div>
        `;
        activityList.appendChild(itemEl);
      });
    }
  }
}

function renderCalendar() {
  const year = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();
  const todayStr = getTodayStr();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  calMonthTitle.textContent = `${monthNames[month]} ${year}`;

  renderMonthOverview();

  // Highlight active month tab
  monthTabs.forEach(t => {
    const m = parseInt(t.getAttribute('data-month') || '0', 10);
    t.classList.toggle('active', m === month);
  });

  const days = getMonthCalendarDays(state, year, month, todayStr);
  calDaysContainer.innerHTML = '';

  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const mondayOffset = (firstDayOfWeek + 6) % 7;

  for (let i = 0; i < mondayOffset; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.style.opacity = '0.3';
    calDaysContainer.appendChild(emptyCell);
  }

  days.forEach(day => {
    const cell = document.createElement('div');
    cell.className = `cal-day-cell ${day.isToday ? 'is-today' : ''} ${day.dateStr === selectedCalDateStr ? 'is-selected' : ''}`;
    cell.setAttribute('data-cal-date', day.dateStr);

    let pillsHtml = '';
    if (day.isPayday) {
      pillsHtml += `<span class="cal-event-pill payday">+Payday</span>`;
    }
    day.events.filter(e => e.type === 'bill').forEach(b => {
      pillsHtml += `<span class="cal-event-pill ${b.isPaid ? 'bill-paid' : 'bill-due'}">${b.title}</span>`;
    });
    if (day.totalSpent > 0) {
      pillsHtml += `<span class="cal-event-pill spend">-${fmt(day.totalSpent)}</span>`;
    }

    cell.innerHTML = `
      <div class="cal-day-header">
        <span>${day.dayNumber}</span>
        ${day.isToday ? '<span class="today-chip">TODAY</span>' : ''}
      </div>
      <div class="cal-day-dots">
        ${pillsHtml}
      </div>
    `;

    cell.addEventListener('click', () => {
      selectedCalDateStr = day.dateStr;
      renderCalendar();
      renderAgenda();
    });

    calDaysContainer.appendChild(cell);
  });
}

function renderAgenda() {
  const selectedDateObj = parseISODate(selectedCalDateStr);
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' };
  agendaDateTitle.textContent = selectedDateObj.toLocaleDateString('en-US', options);

  const year = selectedDateObj.getFullYear();
  const month = selectedDateObj.getMonth();
  const days = getMonthCalendarDays(state, year, month, getTodayStr());
  const dayData = days.find(d => d.dateStr === selectedCalDateStr);

  agendaEventsList.innerHTML = '';
  if (!dayData || dayData.events.length === 0) {
    agendaDaySummary.textContent = 'No bills, paydays, or spending on this date.';
    agendaEventsList.innerHTML = '<div class="empty-state-box">Nothing on the books for this day.</div>';
    return;
  }

  const spendTotal = dayData.totalSpent;
  agendaDaySummary.textContent = spendTotal > 0 ? `Total spent: ${fmt(spendTotal)}` : 'Bills / Income scheduled';

  dayData.events.forEach(event => {
    const row = document.createElement('div');
    row.className = `item-row ${event.isPaid ? 'is-paid' : ''}`;

    if (event.type === 'payday') {
      row.innerHTML = `
        <div class="item-row-left">
          <span class="badge badge-payday">Payday</span>
          <strong>${event.title}</strong>
        </div>
        <strong style="color: var(--accent); font-family: var(--text-serif);">+ ${fmt(event.amount)}</strong>
      `;
    } else if (event.type === 'bill') {
      row.innerHTML = `
        <div class="item-row-left">
          <input type="checkbox" data-agenda-bill="${event.billId}" data-due="${event.dueDateStr}" ${event.isPaid ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
          <div>
            <strong>${event.title}</strong>
            <div class="item-meta">Bill</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="badge ${event.isPaid ? 'badge-paid' : 'badge-due'}">${event.isPaid ? 'Paid' : 'Due'}</span>
          <strong style="font-family: var(--text-serif);">- ${fmt(event.amount)}</strong>
        </div>
      `;
    } else {
      row.innerHTML = `
        <div class="item-row-left">
          <span class="badge" style="background: var(--surface-border); color: var(--text-muted);">Spend</span>
          <strong>${event.title}</strong>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <strong style="font-family: var(--text-serif);">- ${fmt(event.amount)}</strong>
          <button type="button" class="btn btn-ghost" data-delete-tx="${event.id}" style="padding: 2px 6px; font-size: 0.8rem; color: var(--danger);">Undo</button>
        </div>
      `;
    }

    agendaEventsList.appendChild(row);
  });
}

function updateCategoryDatalist() {
  const datalist = document.getElementById('category-options');
  if (!datalist) return;
  datalist.innerHTML = '';
  const categories = state.categories && state.categories.length > 0
    ? state.categories
    : INITIAL_CATEGORIES;
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.name;
    datalist.appendChild(opt);
  });
}

function renderSettingsCategories() {
  const container = document.getElementById('settings-categories-list');
  if (!container) return;
  container.innerHTML = '';

  const categories = state.categories && state.categories.length > 0
    ? state.categories
    : INITIAL_CATEGORIES;

  categories.forEach((cat) => {
    const row = document.createElement('div');
    row.className = 'settings-cat-row';

    const info = document.createElement('div');
    info.className = 'settings-cat-info';

    // Color picker
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = cat.color;
    colorInput.className = 'settings-cat-color-picker';
    colorInput.title = 'Change color';
    colorInput.style.cssText = 'width: 28px; height: 28px; border: 1px solid var(--surface-border); border-radius: 50%; cursor: pointer; padding: 0; background: none;';
    colorInput.addEventListener('change', () => {
      cat.color = colorInput.value;
      persistState();
      renderModalCategoryChips();
    });

    const nameSpan = document.createElement('span');
    nameSpan.className = 'settings-cat-name';
    nameSpan.textContent = cat.name;

    info.appendChild(colorInput);
    info.appendChild(nameSpan);

    const actions = document.createElement('div');
    actions.className = 'settings-cat-actions';

    // Quick button checkbox
    const quickLabel = document.createElement('label');
    quickLabel.className = 'settings-cat-quick-label';
    quickLabel.title = 'Show as quick button in modal';

    const quickCheckbox = document.createElement('input');
    quickCheckbox.type = 'checkbox';
    quickCheckbox.checked = !!cat.isQuick;
    quickCheckbox.style.cssText = 'accent-color: var(--primary); width: 16px; height: 16px; cursor: pointer;';
    quickCheckbox.addEventListener('change', () => {
      cat.isQuick = quickCheckbox.checked;
      persistState();
      renderModalCategoryChips();
    });

    const quickText = document.createElement('span');
    quickText.textContent = 'Quick button';

    quickLabel.appendChild(quickCheckbox);
    quickLabel.appendChild(quickText);

    // Delete button (keep at least 1 category)
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'settings-cat-del-btn';
    delBtn.title = 'Delete category';
    delBtn.innerHTML = '&times;';
    delBtn.addEventListener('click', () => {
      if (categories.length <= 1) {
        alert('You must keep at least one category.');
        return;
      }
      state.categories = categories.filter(c => c.id !== cat.id);
      persistState();
      renderSettingsCategories();
      renderModalCategoryChips();
      updateCategoryDatalist();
    });

    actions.appendChild(quickLabel);
    actions.appendChild(delBtn);

    row.appendChild(info);
    row.appendChild(actions);

    container.appendChild(row);
  });
}

function renderSettings() {
  const todayStr = getTodayStr();
  settingCurrency.value = state.currency;

  const curTheme = state.theme || 'light';
  if (btnThemeLight) {
    const isLight = curTheme !== 'dark';
    btnThemeLight.classList.toggle('active', isLight);
    btnThemeLight.setAttribute('aria-pressed', isLight ? 'true' : 'false');
  }
  if (btnThemeDark) {
    const isDark = curTheme === 'dark';
    btnThemeDark.classList.toggle('active', isDark);
    btnThemeDark.setAttribute('aria-pressed', isDark ? 'true' : 'false');
  }

  const settingUserName = document.getElementById('setting-user-name') as HTMLInputElement | null;
  const settingPlannerTitle = document.getElementById('setting-planner-title') as HTMLInputElement | null;
  if (settingUserName) settingUserName.value = state.userName || '';
  if (settingPlannerTitle) settingPlannerTitle.value = state.plannerTitle || '';

  const layoutToggleContainer = document.getElementById('layout-toggle-container');
  if (layoutToggleContainer) {
    const curMode = state.layoutMode || 'everything';
    layoutToggleContainer.querySelectorAll('.layout-pill').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-layout') === curMode);
    });
  }

  const curScheme = state.colorScheme || 'royal-glimmer';
  document.querySelectorAll<HTMLButtonElement>('.theme-scheme-card').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-scheme') === curScheme);
  });

  inputNewBalance.placeholder = (state.account.balance / 100).toFixed(2);
  const lastSetDate = state.account.balanceAsOf || todayStr;
  const lastSetTime = new Date(state.account.balanceAsOfMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  balanceAsOfNote.textContent = `Current: ${fmt(state.account.balance)} (set on ${lastSetDate} at ${lastSetTime})`;

  if (payAmountInput) {
    payAmountInput.value = (state.paycheck.amount / 100).toFixed(2);
  }
  payAnchorInput.value = state.paycheck.anchorDate;
  payCycleSelect.value = state.paycheck.cycle;
  paySetAsideInput.value = (state.setAside / 100).toFixed(2);

  renderSettingsCategories();
  updateCategoryDatalist();
  renderSyncSettings();
}

function renderSyncSettings() {
  ensureSyncState();
  const syncState = state.sync!;
  const pill = document.getElementById('sync-status-pill');
  const recoveryRow = document.getElementById('sync-recovery-row');
  const connectedRow = document.getElementById('sync-connected-row');
  const disconnectedRow = document.getElementById('sync-disconnected-row');
  const keyDisplay = document.getElementById('display-recovery-key-text');
  const pairDisplay = document.getElementById('device-pairing-code-display');

  if (keyDisplay) keyDisplay.textContent = syncState.recoveryKey || 'PL-8A2F-9C4D-7E1B';
  if (pairDisplay) pairDisplay.textContent = syncState.pairingCode || '553 699';

  if (pill) {
    if (syncState.syncStatus === 'syncing') {
      pill.setAttribute('data-state', 'syncing');
      pill.innerHTML = '<span class="device-spin-icon" style="width:11px;height:11px;border-width:1.5px;"></span> Syncing…';
    } else if (syncState.isSynced) {
      pill.setAttribute('data-state', 'synced');
      pill.innerHTML = '<span class="sync-pill-dot"></span> Synced';
    } else {
      pill.setAttribute('data-state', 'local');
      pill.innerHTML = '<span class="sync-pill-dot"></span> Saved locally';
    }
  }

  if (recoveryRow) recoveryRow.style.display = syncState.isSynced ? 'block' : 'none';
  if (connectedRow) connectedRow.style.display = syncState.isSynced ? 'block' : 'none';
  if (disconnectedRow) disconnectedRow.style.display = syncState.isSynced ? 'none' : 'block';
}

function renderTheMonthSoFar() {
  const todayStr = getTodayStr();
  const summary = calculateMonthSummary(state, todayStr);

  const msoKeptTopText = document.getElementById('mso-kept-top-text');
  if (msoKeptTopText) msoKeptTopText.textContent = `${fmt(summary.keptCents)} kept`;

  const donutAmount = document.getElementById('donut-wentout-amount');
  if (donutAmount) donutAmount.textContent = fmt(summary.wentOutCents);

  const donutArc = document.getElementById('donut-wentout-arc');
  if (donutArc) {
    const totalCircumference = 251.2;
    const ratio = summary.cameInCents > 0
      ? Math.min(1, summary.wentOutCents / summary.cameInCents)
      : (summary.wentOutCents > 0 ? 1 : 0);
    const offset = totalCircumference * (1 - ratio);
    donutArc.style.strokeDashoffset = offset.toString();
  }

  const labels = state.categoryLabels || DEFAULT_CATEGORY_LABELS;

  const elBills = document.getElementById('cat-label-bills');
  if (elBills) elBills.textContent = labels.bills || 'Bills & rent';

  const elLiving = document.getElementById('cat-label-living');
  if (elLiving) elLiving.textContent = labels.living || 'Living & food';

  const elFun = document.getElementById('cat-label-fun');
  if (elFun) elFun.textContent = labels.fun || 'Fun & friends';

  const elDebt = document.getElementById('cat-label-debt');
  if (elDebt) elDebt.textContent = labels.debt || 'To debt';

  const elSavings = document.getElementById('cat-label-savings');
  if (elSavings) elSavings.textContent = labels.savings || 'To savings';

  const elLeftover = document.getElementById('cat-label-leftover');
  if (elLeftover) elLeftover.textContent = labels.leftover || 'Left over';

  // Attach rename click listeners to editable category words
  document.querySelectorAll<HTMLElement>('.renameable-word').forEach(el => {
    el.onclick = (e) => {
      e.preventDefault();
      const key = el.getAttribute('data-cat-key');
      if (!key) return;
      const currentLabels = state.categoryLabels || { ...DEFAULT_CATEGORY_LABELS };
      const currentVal = currentLabels[key] || el.textContent || '';
      const promptVal = window.prompt(`Rename "${currentVal}":`, currentVal);
      if (promptVal !== null && promptVal.trim().length > 0) {
        const newVal = promptVal.trim();
        if (!state.categoryLabels) state.categoryLabels = { ...DEFAULT_CATEGORY_LABELS };
        state.categoryLabels[key] = newVal;
        persistState();
        renderAll();
        showUndoToast(`Renamed to "${newVal}"`, () => {
          if (!state.categoryLabels) state.categoryLabels = { ...DEFAULT_CATEGORY_LABELS };
          state.categoryLabels[key] = currentVal;
          persistState();
          renderAll();
        });
      }
    };
  });

  // Render interactive kind chips (living vs fun side - Atas - Bawah layout)
  const livingContainer = document.getElementById('tags-subcategories-living');
  const funContainer = document.getElementById('tags-subcategories-fun');
  const tagsContainer = document.getElementById('tags-subcategories-list');
  const livingTitle = document.getElementById('kind-group-name-living');
  const funTitle = document.getElementById('kind-group-name-fun');
  const livingCount = document.getElementById('kind-group-count-living');
  const funCount = document.getElementById('kind-group-count-fun');

  const livingLabel = labels.living || 'Living & food';
  const funLabel = labels.fun || 'Fun & friends';

  if (livingTitle) livingTitle.textContent = livingLabel;
  if (funTitle) funTitle.textContent = funLabel;

  if (livingContainer) livingContainer.innerHTML = '';
  if (funContainer) funContainer.innerHTML = '';
  if (tagsContainer) tagsContainer.innerHTML = '';

  const kindSide = state.kindSide || { ...DEFAULT_KIND_SIDE };
  const categoryNames = Array.from(new Set([
    ...(state.categories || []).map(c => c.name),
    ...Object.keys(DEFAULT_KIND_SIDE)
  ])).filter(name => name.trim().length > 0);

  let livingItemsCount = 0;
  let funItemsCount = 0;

  categoryNames.forEach(catName => {
    const currentSide = kindSide[catName] || (DEFAULT_KIND_SIDE[catName] || 'living');
    const isFun = currentSide === 'fun';
    const otherSide = isFun ? 'living' : 'fun';
    const otherSideLabel = isFun ? livingLabel : funLabel;
    const currentSideLabel = isFun ? funLabel : livingLabel;

    if (isFun) funItemsCount++;
    else livingItemsCount++;

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `kind-chip-btn ${isFun ? 'fun-kind' : 'living-kind'}`;
    chip.setAttribute('data-category-name', catName);
    chip.setAttribute('data-current-side', currentSide);
    chip.setAttribute('data-target-side', otherSide);
    chip.title = `${catName} is in ${currentSideLabel}. Tap to move to ${otherSideLabel}`;

    const arrowIcon = isFun ? '&uarr;' : '&darr;';
    chip.innerHTML = `
      <span>&bull; ${catName}</span>
      <span class="kind-arrow-hint">${arrowIcon} ${isFun ? 'Living' : 'Fun'}</span>
    `;

    chip.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (!state.kindSide) state.kindSide = { ...DEFAULT_KIND_SIDE };
      state.kindSide[catName] = otherSide;
      persistState();
      renderAll();
      showUndoToast(`Moved ${catName} to ${otherSideLabel}`, () => {
        if (!state.kindSide) state.kindSide = { ...DEFAULT_KIND_SIDE };
        state.kindSide[catName] = currentSide;
        persistState();
        renderAll();
      });
    });

    if (isFun && funContainer) {
      funContainer.appendChild(chip);
    } else if (!isFun && livingContainer) {
      livingContainer.appendChild(chip);
    } else if (tagsContainer) {
      tagsContainer.appendChild(chip);
    }
  });

  if (livingCount) livingCount.textContent = `(${livingItemsCount})`;
  if (funCount) funCount.textContent = `(${funItemsCount})`;

  if (livingContainer && livingItemsCount === 0) {
    livingContainer.innerHTML = '<span class="kind-empty-placeholder">No categories in Living &mdash; tap any item below to move here</span>';
  }
  if (funContainer && funItemsCount === 0) {
    funContainer.innerHTML = '<span class="kind-empty-placeholder">No categories in Fun &mdash; tap any item above to move here</span>';
  }

  const catBills = document.getElementById('cat-val-bills');
  if (catBills) catBills.textContent = fmt(summary.billsAndRentCents);

  const catLiving = document.getElementById('cat-val-living');
  if (catLiving) catLiving.textContent = fmt(summary.livingAndFoodCents);

  const catFun = document.getElementById('cat-val-fun');
  if (catFun) catFun.textContent = fmt(summary.funAndFriendsCents);

  const catDebt = document.getElementById('cat-val-debt');
  if (catDebt) catDebt.textContent = fmt(summary.toDebtCents);

  const catSavings = document.getElementById('cat-val-savings');
  if (catSavings) catSavings.textContent = fmt(summary.toSavingsCents);

  const catLeftover = document.getElementById('cat-val-leftover');
  if (catLeftover) catLeftover.textContent = fmt(summary.leftOverCents);

  const sumCameIn = document.getElementById('summary-came-in');
  if (sumCameIn) sumCameIn.textContent = fmt(summary.cameInCents);

  const sumWentOut = document.getElementById('summary-went-out');
  if (sumWentOut) sumWentOut.textContent = fmt(summary.wentOutCents);

  const sumKept = document.getElementById('summary-kept');
  if (sumKept) sumKept.textContent = fmt(summary.keptCents);

  const captionMonth = document.getElementById('caption-month-so-far');
  if (captionMonth) {
    if (summary.wentOutCents === 0 && summary.cameInCents === 0) {
      captionMonth.textContent = 'nothing recorded for this month yet \u2014 the shape appears as you go';
    } else {
      captionMonth.textContent = `${fmt(summary.keptCents)} kept so far this month`;
    }
  }
}

function renderEveryDayThisMonth() {
  const container = document.getElementById('timeline-31-container');
  if (!container) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const labelStart = document.getElementById('label-month-start');
  const labelEnd = document.getElementById('label-month-end');
  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (labelStart) labelStart.textContent = `${monthNamesShort[month]} 1`;
  if (labelEnd) labelEnd.textContent = `${monthNamesShort[month]} ${daysInMonth}`;

  let maxSpend = 1;
  const dailySpendMap: Record<number, number> = {};
  state.transactions.forEach(t => {
    if (t.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)) {
      const d = parseInt(t.date.slice(8, 10), 10);
      dailySpendMap[d] = (dailySpendMap[d] || 0) + t.amount;
      if (dailySpendMap[d] > maxSpend) maxSpend = dailySpendMap[d];
    }
  });

  const todayDay = now.getDate();
  container.innerHTML = '';

  for (let d = 1; d <= 31; d++) {
    const col = document.createElement('div');
    col.className = 'timeline-bar-col';
    if (d === todayDay) col.classList.add('is-today');

    const spend = dailySpendMap[d] || 0;
    if (spend > 0) col.classList.add('has-spend');

    const pill = document.createElement('div');
    pill.className = 'timeline-bar-pill';
    if (d > daysInMonth) {
      pill.style.opacity = '0.15';
    } else if (spend > 0) {
      const heightPct = Math.max(25, Math.min(100, Math.round((spend / maxSpend) * 100)));
      pill.style.height = `${heightPct}%`;
    }

    col.appendChild(pill);
    container.appendChild(col);
  }

  const captionEveryDay = document.getElementById('caption-every-day');
  if (captionEveryDay) {
    const totalTransactions = state.transactions.filter(t => t.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).length;
    if (totalTransactions === 0) {
      captionEveryDay.textContent = 'nothing logged this month yet \u2013 the shape appears as you go';
    } else {
      captionEveryDay.textContent = `${totalTransactions} transactions logged this month`;
    }
  }
}

function renderRunToPayday() {
  const todayStr = getTodayStr();
  const runway = calculateRunToPayday(state, todayStr);

  const daysLeftText = document.getElementById('runway-days-left-text');
  if (daysLeftText) daysLeftText.textContent = `${runway.daysLeft} day${runway.daysLeft === 1 ? '' : 's'} left`;

  const safeUntil = document.getElementById('runway-safe-until');
  if (safeUntil) safeUntil.textContent = fmt(runway.safeUntilPayday);

  const eachDay = document.getElementById('runway-each-day');
  if (eachDay) eachDay.textContent = `about ${fmt(runway.perDayCents)}/day`;

  const trackBars = document.getElementById('runway-track-bars');
  if (trackBars) {
    trackBars.innerHTML = '';
    runway.bars.forEach(b => {
      const bar = document.createElement('div');
      bar.className = 'runway-bar';
      if (b.isToday) bar.classList.add('today');
      else if (b.isPayday) bar.classList.add('payday');
      else if (b.isPast) bar.classList.add('past');
      trackBars.appendChild(bar);
    });
  }
}

// 1-Click Floating Undo Toast Manager
interface UndoAction {
  id: string;
  label: string;
  revert: () => void;
  timer: any;
}

let activeUndoAction: UndoAction | null = null;

function showUndoToast(msg: string, revertFn?: () => void) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  if (activeUndoAction) {
    clearTimeout(activeUndoAction.timer);
    container.innerHTML = '';
    activeUndoAction = null;
  }

  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.setAttribute('role', 'alert');

  toast.innerHTML = `
    <span class="toast-msg">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      <span>${msg}</span>
    </span>
    ${revertFn ? '<button type="button" class="toast-undo-btn" id="toast-undo-btn">Undo</button>' : ''}
  `;

  container.appendChild(toast);

  const toastId = `toast-${Date.now()}`;
  const timer = setTimeout(() => {
    toast.remove();
    if (activeUndoAction && activeUndoAction.id === toastId) {
      activeUndoAction = null;
    }
  }, 7000);

  if (revertFn) {
    activeUndoAction = {
      id: toastId,
      label: msg,
      revert: revertFn,
      timer
    };

    const undoBtn = toast.querySelector('#toast-undo-btn');
    undoBtn?.addEventListener('click', () => {
      clearTimeout(timer);
      revertFn();
      toast.remove();
      activeUndoAction = null;
    });
  }
}

// Income Screen Controller
let currentIncomeFilter: 'all' | 'arrived' | 'soon' | 'later' = 'all';

function renderIncome() {
  const currentMonthStr = getTodayStr().slice(0, 7);
  const summary = calculateIncomeSummary(state, currentMonthStr);

  const arrivedFig = document.getElementById('income-arrived-figure');
  const arrivedCount = document.getElementById('income-arrived-count');
  const soonFig = document.getElementById('income-soon-figure');
  const laterFig = document.getElementById('income-later-figure');

  if (arrivedFig) arrivedFig.textContent = fmt(summary.arrivedCents);
  if (soonFig) soonFig.textContent = fmt(summary.soonCents);
  if (laterFig) laterFig.textContent = fmt(summary.laterCents);

  const items = state.incomes || [];
  const arrivedThisMonthCount = items.filter(i => i.status === 'arrived' && i.date.startsWith(currentMonthStr)).length;
  if (arrivedCount) arrivedCount.textContent = `${arrivedThisMonthCount} recorded this month`;

  // Update filter pills active state
  const incomeBtns = document.querySelectorAll<HTMLElement>('#income-filter-pills .segment-btn, #income-filter-pills .filter-pill');
  incomeBtns.forEach(btn => {
    const f = btn.getAttribute('data-income-filter');
    if (f === currentIncomeFilter) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  const listContainer = document.getElementById('income-items-list');
  if (!listContainer) return;

  listContainer.innerHTML = '';

  const filtered = items.filter(i => {
    if (currentIncomeFilter === 'all') return true;
    return i.status === currentIncomeFilter;
  });

  if (filtered.length === 0) {
    const emptyRow = document.createElement('div');
    emptyRow.style.padding = '30px 16px';
    emptyRow.style.textAlign = 'center';
    emptyRow.style.color = 'var(--text-muted)';
    emptyRow.style.fontSize = '0.9rem';
    emptyRow.textContent = currentIncomeFilter === 'all'
      ? 'No extra money recorded yet. Side gig, gift, or refund? Tap "Record money in" above.'
      : `No items marked as "${currentIncomeFilter}".`;
    listContainer.appendChild(emptyRow);
    return;
  }

  filtered.forEach(item => {
    const row = document.createElement('div');
    row.className = 'income-row';
    const dotClass = item.status === 'arrived' ? 'dot-arrived' : item.status === 'soon' ? 'dot-soon' : 'dot-later';

    row.innerHTML = `
      <div class="income-row-left">
        <span class="status-indicator-dot ${dotClass}"></span>
        <div>
          <div class="income-row-source">${item.source}</div>
          <div class="income-row-meta">${item.date}${item.notes ? ` &middot; ${item.notes}` : ''}</div>
        </div>
      </div>
      <div class="income-row-right">
        <div class="income-row-amount">${fmt(item.amount)}</div>
        <button type="button" class="income-status-badge ${item.status}" data-toggle-income-status="${item.id}" title="Click to cycle status (Arrived / Soon / Later)">
          ${item.status}
        </button>
        <button type="button" class="btn-delete-row" data-delete-income="${item.id}" title="Delete entry" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.1rem;padding:2px 6px;">&times;</button>
      </div>
    `;
    listContainer.appendChild(row);
  });
}

// Milestones Screen Controller
let currentMilestoneFilter: 'all' | 'reached' | 'pending' = 'all';

function renderMilestones() {
  const todayStr = getTodayStr();
  const milestonesCalc = calculateMilestones(state, todayStr);

  // 1. Render Today widget
  const countText = document.getElementById('milestones-count-text');
  if (countText) countText.textContent = `${milestonesCalc.reachedCount} of 4 reached`;

  const container = document.getElementById('milestones-container');
  if (container) {
    container.innerHTML = '';
    milestonesCalc.items.forEach(m => {
      const row = document.createElement('div');
      row.className = 'milestone-row';
      row.innerHTML = `
        <span>${m.title}</span>
        <span class="milestone-tag ${m.reached ? 'reached' : 'not-yet'}">${m.reached ? 'reached' : 'not yet'}</span>
      `;
      container.appendChild(row);
    });
  }

  // 2. Render Full Milestones Screen
  const items = state.milestones || [];
  const reachedCount = items.filter(m => m.isReached).length;
  const totalCount = items.length;
  const percent = totalCount > 0 ? Math.round((reachedCount / totalCount) * 100) : 0;

  const scoreDisplay = document.getElementById('milestones-score-display');
  const percentDisplay = document.getElementById('milestones-percent-display');
  const progressBar = document.getElementById('milestones-progress-bar');

  if (scoreDisplay) scoreDisplay.textContent = `${reachedCount} of ${totalCount} reached`;
  if (percentDisplay) percentDisplay.textContent = `${percent}%`;
  if (progressBar) progressBar.style.width = `${percent}%`;

  // Update filter pills active state
  const milestoneBtns = document.querySelectorAll<HTMLElement>('#milestones-filter-pills .segment-btn, #milestones-filter-pills .filter-pill');
  milestoneBtns.forEach(btn => {
    const f = btn.getAttribute('data-milestone-filter');
    if (f === currentMilestoneFilter) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  const grid = document.getElementById('milestones-grid');
  if (!grid) return;

  grid.innerHTML = '';

  const filtered = items.filter(m => {
    if (currentMilestoneFilter === 'reached') return m.isReached;
    if (currentMilestoneFilter === 'pending') return !m.isReached;
    return true;
  });

  if (filtered.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.gridColumn = '1 / -1';
    emptyMsg.style.padding = '36px 16px';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.color = 'var(--text-muted)';
    emptyMsg.style.fontSize = '0.95rem';
    emptyMsg.textContent = currentMilestoneFilter === 'reached'
      ? 'No milestones reached yet. As you log spending and pay bills, milestones will unlock!'
      : 'All milestones reached! Calm momentum achieved.';
    grid.appendChild(emptyMsg);
    return;
  }

  const icons: Record<string, string> = {
    'm-first-log': '⚡',
    'm-emergency-buffer': '🛡️',
    'm-bills-covered': '📅',
    'm-debt-first-crush': '💳',
    'm-safe-spend-streak': '🎯',
    'm-envelope-stocked': '✉️',
    'm-surplus-saved': '💰',
    'm-calm-month': '🌱'
  };

  filtered.forEach(m => {
    const card = document.createElement('div');
    card.className = `milestone-card ${m.isReached ? 'reached' : ''}`;
    const icon = m.icon || icons[m.id] || '🏆';

    card.innerHTML = `
      <div>
        <div class="milestone-head">
          <div class="milestone-icon-wrap">${icon}</div>
          <button type="button" class="milestone-toggle-btn" data-toggle-milestone="${m.id}" title="${m.isReached ? 'Mark as not reached' : 'Mark as reached'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </div>
        <div class="milestone-title">${m.title}</div>
        <p class="milestone-desc">${m.description}</p>
      </div>
      <div class="milestone-footer">
        <span class="card-eyebrow" style="margin:0;font-size:0.7rem;">${m.category.toUpperCase()}</span>
        <span>${m.isReached ? `Reached ${m.reachedAt || 'recently'}` : 'In progress'}</span>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderAll() {
  updateHeaderGreeting();
  renderToday();
  renderTheMonthSoFar();
  renderEveryDayThisMonth();
  renderRunToPayday();
  renderMilestones();
  renderIncome();
  renderBills();
  renderSettings();
  renderEnvelopes();
  renderGoals();
  renderDebts();
  renderCalendar();
  renderAgenda();
  renderBrainDump();
}

// ==========================================
// EVENT LISTENERS
// ==========================================

// Currency & Theme settings change
settingCurrency?.addEventListener('change', () => {
  state.currency = settingCurrency.value;
  persistState();
  renderAll();
  renderModalSteppers();
});

btnThemeLight?.addEventListener('click', () => {
  state.theme = 'light';
  applyTheme('light');
  persistState();
  renderSettings();
});

btnThemeDark?.addEventListener('click', () => {
  state.theme = 'dark';
  applyTheme('dark');
  persistState();
  renderSettings();
});

// "Make it yours": Name & Planner Title & Layout Mode
const settingUserName = document.getElementById('setting-user-name') as HTMLInputElement | null;
settingUserName?.addEventListener('input', () => {
  state.userName = settingUserName.value;
  persistState();
  updateHeaderGreeting();
});

const settingPlannerTitle = document.getElementById('setting-planner-title') as HTMLInputElement | null;
settingPlannerTitle?.addEventListener('input', () => {
  state.plannerTitle = settingPlannerTitle.value;
  persistState();
  updateHeaderGreeting();
});

const layoutToggleContainer = document.getElementById('layout-toggle-container');
layoutToggleContainer?.querySelectorAll('.layout-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = (btn.getAttribute('data-layout') || 'everything') as LayoutMode;
    state.layoutMode = mode;
    persistState();
    applyLayoutMode(mode);
    layoutToggleContainer.querySelectorAll('.layout-pill').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-layout') === mode);
    });
  });
});

// "Make it yours": Color Scheme Selection
document.querySelectorAll<HTMLButtonElement>('.theme-scheme-card').forEach(card => {
  card.addEventListener('click', () => {
    const scheme = card.getAttribute('data-scheme') as ColorSchemeId;
    if (!scheme) return;
    state.colorScheme = scheme;
    persistState();
    applyColorScheme(scheme);
    document.querySelectorAll<HTMLButtonElement>('.theme-scheme-card').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-scheme') === scheme);
    });
  });
});

// Settings: Add Category Form
const formAddCategory = document.getElementById('form-add-category') as HTMLFormElement | null;
formAddCategory?.addEventListener('submit', (e) => {
  e.preventDefault();
  const inputName = document.getElementById('input-new-cat-name') as HTMLInputElement | null;
  const inputColor = document.getElementById('input-new-cat-color') as HTMLInputElement | null;
  const inputIsQuick = document.getElementById('input-new-cat-isquick') as HTMLInputElement | null;

  const name = inputName?.value.trim();
  if (!name) return;

  if (!state.categories) state.categories = [...INITIAL_CATEGORIES];

  if (state.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    alert('A category with this name already exists.');
    return;
  }

  const newCat: SpendCategory = {
    id: `cat-${Date.now()}`,
    name,
    color: inputColor?.value || '#e07a5f',
    isQuick: inputIsQuick ? inputIsQuick.checked : true
  };

  state.categories.push(newCat);
  persistState();

  if (inputName) inputName.value = '';
  renderSettingsCategories();
  renderModalCategoryChips();
  updateCategoryDatalist();
});

// Debt Strategy Toggle
btnStrategySnowball?.addEventListener('click', () => {
  state.debtStrategy = 'snowball';
  persistState();
  renderDebts();
});

btnStrategyAvalanche?.addEventListener('click', () => {
  state.debtStrategy = 'avalanche';
  persistState();
  renderDebts();
});

// Calendar Month Navigation
btnPrevMonth?.addEventListener('click', () => {
  currentCalDate.setMonth(currentCalDate.getMonth() - 1);
  renderCalendar();
});

btnNextMonth?.addEventListener('click', () => {
  currentCalDate.setMonth(currentCalDate.getMonth() + 1);
  renderCalendar();
});

btnMonthToday?.addEventListener('click', () => {
  currentCalDate = new Date();
  selectedCalDateStr = getTodayStr();
  renderCalendar();
  renderAgenda();
});

// Month Note Submission
const btnSaveMonthNote = document.getElementById('btn-save-month-note');
const inputMonthNoteText = document.getElementById('input-month-note-text') as HTMLTextAreaElement | null;

btnSaveMonthNote?.addEventListener('click', () => {
  if (!inputMonthNoteText) return;
  const text = inputMonthNoteText.value.trim();
  if (!text) return;

  const year = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = monthNames[month];

  if (!state.monthNotes) state.monthNotes = {};
  if (!state.monthNotes[monthPrefix]) state.monthNotes[monthPrefix] = [];

  const newNote: MonthNoteItem = {
    id: 'mnote_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    text,
    createdAt: Date.now()
  };

  state.monthNotes[monthPrefix].unshift(newNote);
  persistState();
  inputMonthNoteText.value = '';
  renderMonthOverview();
  showUndoToast(`Kept note for ${monthName}`, () => {
    state.monthNotes![monthPrefix] = (state.monthNotes![monthPrefix] || []).filter(n => n.id !== newNote.id);
    persistState();
    renderMonthOverview();
  });
});

// Quick spend on Agenda (selected date)
formAgendaSpend?.addEventListener('submit', (e) => {
  e.preventDefault();
  const dollars = parseFloat(agendaSpendAmount.value);
  if (isNaN(dollars) || dollars <= 0) return;

  const category = (agendaSpendCategory.value || '').trim() || 'Other';
  const cents = Math.round(dollars * 100);

  const prevTransactions = [...state.transactions];
  state = addTransaction(state, cents, category, selectedCalDateStr);
  const newTx = state.transactions.find(t => !prevTransactions.some(p => p.id === t.id));
  persistState();

  agendaSpendAmount.value = '';
  agendaSpendCategory.value = '';
  renderAll();

  if (newTx) {
    showUndoToast(`Logged ${fmt(cents)} · ${category}`, () => {
      state.transactions = state.transactions.filter(t => t.id !== newTx.id);
      persistState();
      renderAll();
    });
  }
});

// Universal Click Delete / Undo handler
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  // Undo transaction
  const txId = target.getAttribute('data-delete-tx');
  if (txId) {
    state = {
      ...state,
      transactions: state.transactions.filter(t => t.id !== txId)
    };
    persistState();
    renderAll();
  }

  // Delete Envelope
  const envId = target.getAttribute('data-delete-env');
  if (envId) {
    state = deleteEnvelope(state, envId);
    persistState();
    renderAll();
  }

  // Delete Goal
  const goalId = target.getAttribute('data-delete-goal');
  if (goalId) {
    state = deleteGoal(state, goalId);
    persistState();
    renderAll();
  }

  // Delete Debt
  const debtId = target.getAttribute('data-delete-debt');
  if (debtId) {
    state = deleteDebt(state, debtId);
    persistState();
    renderAll();
  }
});

// Toggle Bill Paid in Bills List or Agenda List
document.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  const billId = target.getAttribute('data-bill-id') || target.getAttribute('data-agenda-bill');
  const due = target.getAttribute('data-due');
  if (billId && due) {
    state = markBillPaid(state, billId, due, target.checked);
    persistState();
    renderAll();
  }
});

// Delete Bill
billsList?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const billId = target.getAttribute('data-delete-bill');
  if (billId) {
    state = {
      ...state,
      bills: state.bills.filter(b => b.id !== billId)
    };
    persistState();
    renderAll();
  }
});

// Add Bill Form
formAddBill?.addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('bill-name') as HTMLInputElement;
  const amtInput = document.getElementById('bill-amount') as HTMLInputElement;
  const dayInput = document.getElementById('bill-day') as HTMLInputElement;
  const monthInput = document.getElementById('bill-month') as HTMLSelectElement;

  const dollars = parseFloat(amtInput.value);
  const day = parseInt(dayInput.value, 10);
  const recurrence = billRecurrenceSelect.value as 'monthly' | 'annual';
  const dueMonth = recurrence === 'annual' ? parseInt(monthInput.value, 10) : undefined;

  if (!nameInput.value || isNaN(dollars) || isNaN(day)) return;

  const newBill = {
    id: 'bill_' + Math.random().toString(36).slice(2, 10),
    name: nameInput.value.trim(),
    amount: Math.round(dollars * 100),
    dueDay: day,
    dueMonth,
    recurrence,
    paidDates: [],
    paidAt: {}
  };

  state = {
    ...state,
    bills: [...state.bills, newBill]
  };
  persistState();
  nameInput.value = '';
  amtInput.value = '';
  dayInput.value = '';
  renderAll();
});

// Add Envelope Form
formAddEnvelope?.addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('env-name') as HTMLInputElement;
  const catInput = document.getElementById('env-category') as HTMLInputElement;
  const capInput = document.getElementById('env-cap') as HTMLInputElement;

  const dollars = parseFloat(capInput.value);
  if (!nameInput.value || isNaN(dollars) || dollars <= 0) return;

  const categoryName = (catInput.value || '').trim() || nameInput.value.trim();
  const capCents = Math.round(dollars * 100);
  state = saveEnvelope(state, nameInput.value.trim(), categoryName, capCents);
  persistState();
  nameInput.value = '';
  catInput.value = '';
  capInput.value = '';
  renderAll();
});

// Add Goal Form
formAddGoal?.addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('goal-name') as HTMLInputElement;
  const targetInput = document.getElementById('goal-target') as HTMLInputElement;
  const savedInput = document.getElementById('goal-saved') as HTMLInputElement;
  const monthlyInput = document.getElementById('goal-monthly') as HTMLInputElement;

  const targetDollars = parseFloat(targetInput.value);
  const savedDollars = parseFloat(savedInput.value || '0');
  const monthlyDollars = parseFloat(monthlyInput.value || '0');

  if (!nameInput.value || isNaN(targetDollars)) return;

  state = saveGoal(
    state,
    nameInput.value.trim(),
    Math.round(targetDollars * 100),
    Math.round(savedDollars * 100),
    Math.round(monthlyDollars * 100)
  );
  persistState();
  nameInput.value = '';
  targetInput.value = '';
  savedInput.value = '';
  monthlyInput.value = '';
  renderAll();
});

// Add Debt Form
formAddDebt?.addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('debt-name') as HTMLInputElement;
  const balInput = document.getElementById('debt-balance') as HTMLInputElement;
  const aprInput = document.getElementById('debt-apr') as HTMLInputElement;
  const minInput = document.getElementById('debt-min') as HTMLInputElement;

  const balDollars = parseFloat(balInput.value);
  const apr = parseFloat(aprInput.value || '0');
  const minDollars = parseFloat(minInput.value || '0');

  if (!nameInput.value || isNaN(balDollars)) return;

  state = saveDebt(
    state,
    nameInput.value.trim(),
    Math.round(balDollars * 100),
    apr,
    Math.round(minDollars * 100)
  );
  persistState();
  nameInput.value = '';
  balInput.value = '';
  aprInput.value = '';
  minInput.value = '';
  renderAll();
});

// Update Balance Form
formUpdateBalance?.addEventListener('submit', (e) => {
  e.preventDefault();
  const dollars = parseFloat(inputNewBalance.value);
  if (isNaN(dollars) || dollars < 0) return;

  const cents = Math.round(dollars * 100);
  state = updateCheckingBalance(state, cents, getTodayStr());
  persistState();
  inputNewBalance.value = '';
  renderAll();
});

// Update Payday Form
formUpdatePayday?.addEventListener('submit', (e) => {
  e.preventDefault();
  const amountDollars = parseFloat(payAmountInput?.value || '0');
  const anchor = payAnchorInput.value;
  const cycle = payCycleSelect.value as any;
  const setAsideDollars = parseFloat(paySetAsideInput.value || '0');

  if (!anchor) return;

  state = {
    ...state,
    paycheck: {
      ...state.paycheck,
      amount: isNaN(amountDollars) ? state.paycheck.amount : Math.round(amountDollars * 100),
      anchorDate: anchor,
      cycle
    },
    setAside: isNaN(setAsideDollars) ? 0 : Math.round(setAsideDollars * 100)
  };
  persistState();
  alert('Settings saved!');
  renderAll();
});

// Desktop Auto-Save (File System Access API)
btnToggleAutosave?.addEventListener('click', async () => {
  if (!('showSaveFilePicker' in window)) {
    alert('File System Access API is not supported in this browser. You can still use manual JSON Export/Restore.');
    return;
  }

  try {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: `budget-planner-data-${getTodayStr()}.json`,
      types: [
        {
          description: 'JSON Files',
          accept: { 'application/json': ['.json'] }
        }
      ]
    });
    autoSaveHandle = handle;
    autosaveStatusBadge.textContent = `Auto-Save: Active (${handle.name})`;
    autosaveStatusBadge.className = 'autosave-pill active';
    await persistState();
    alert(`Connected to ${handle.name}! Every change will now save automatically to this file.`);
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.error(err);
      alert('Could not enable auto-save.');
    }
  }
});

// Export / Import
document.getElementById('btn-export-json')?.addEventListener('click', () => {
  const json = exportBackupJSON(state);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `budget-planner-backup-${getTodayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-export-csv')?.addEventListener('click', () => {
  const csv = exportTransactionsCSV(state);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `budget-planner-transactions-${getTodayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

const inputImportJson = document.getElementById('input-import-json') as HTMLInputElement;
inputImportJson?.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const content = event.target?.result as string;
    const imported = importBackupJSON(content);
    if (imported) {
      state = imported;
      applyTheme(state.theme);
      applyColorScheme(state.colorScheme || 'royal-glimmer');
      applyLayoutMode(state.layoutMode || 'everything');
      persistState();
      renderAll();
      alert('Backup restored successfully!');
    } else {
      alert('Invalid backup file!');
    }
  };
  reader.readAsText(file);
});

// Service worker registration
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration skipped:', err);
    });
  });
}

// Interactive Three Small Things click handlers
document.getElementById('row-chk-log-today')?.addEventListener('click', () => {
  openLogSpendModal();
});

// Sidebar & Page Log Spend Triggers
sidebarLogWell?.addEventListener('click', () => openLogSpendModal());
btnSidebarLogLaunch?.addEventListener('click', () => openLogSpendModal());
document.getElementById('btn-open-log-from-list')?.addEventListener('click', () => openLogSpendModal());
sidebarLogPanel?.addEventListener('click', (e) => {
  if (e.target === sidebarLogPanel || (e.target as HTMLElement).closest('.sidebar-log-head')) {
    openLogSpendModal();
  }
});

// Modal Exact input live display
modalInputExact?.addEventListener('input', () => {
  updateModalAmountDisplay();
});

// Close modal when clicking backdrop
modalLogSpend?.addEventListener('click', (e) => {
  if (!modalLogSpend || e.target !== modalLogSpend) return;
  const rect = modalLogSpend.getBoundingClientRect();
  const clickedInDialog = (
    rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
    rect.left <= e.clientX && e.clientX <= rect.left + rect.width
  );
  if (!clickedInDialog) {
    closeLogSpendModal();
  }
});

modalLogSpend?.addEventListener('close', () => {
  document.body.classList.remove('modal-log-open');
});

// Modal Date & Help Panel Listeners
function onModalDateChanged() {
  updateModalSubmitButtonText();
  updateModalAmountDisplay();
}

modalLogDate?.addEventListener('input', onModalDateChanged);
modalLogDate?.addEventListener('change', onModalDateChanged);

function toggleModalHelpPanel(e: Event) {
  e.preventDefault();
  if (!modalLogHelpPanel) return;
  const isHidden = modalLogHelpPanel.style.display === 'none' || !modalLogHelpPanel.style.display;
  modalLogHelpPanel.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    const scrollContainer = document.querySelector('.modal-body-scroll');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
}

btnHelpLogSpend?.addEventListener('click', toggleModalHelpPanel);
btnHelpLogDate?.addEventListener('click', toggleModalHelpPanel);

btnCloseLogHelpPanel?.addEventListener('click', (e) => {
  e.preventDefault();
  if (modalLogHelpPanel) modalLogHelpPanel.style.display = 'none';
});

linkModalEditCategories?.addEventListener('click', (e) => {
  e.preventDefault();
  closeLogSpendModal();
  setActiveTab('settings');
  setTimeout(() => {
    document.getElementById('card-manage-categories')?.scrollIntoView({ behavior: 'smooth' });
  }, 100);
});

// Submit Log Spend Modal
btnModalLogSubmit?.addEventListener('click', () => {
  const dollars = parseFloat(modalInputExact?.value || '0');
  if (isNaN(dollars) || dollars <= 0) {
    modalInputExact?.focus();
    return;
  }

  const category = modalActiveCategory || 'Other';
  const totalCents = Math.round(dollars * 100);
  const txDate = modalLogDate?.value || getTodayStr();
  const note = modalLogNote?.value.trim() || undefined;

  const prevTransactions = [...state.transactions];
  state = addTransaction(state, totalCents, category, txDate, note);
  const newTx = state.transactions.find(t => !prevTransactions.some(p => p.id === t.id));

  persistState();
  closeLogSpendModal();
  renderAll();

  if (newTx) {
    showUndoToast(`Logged ${fmt(totalCents)} · ${category}`, () => {
      state.transactions = state.transactions.filter(t => t.id !== newTx.id);
      persistState();
      renderAll();
    });
  }
});

// ====================================================
// BRAIN DUMP SYSTEM
// ====================================================
interface BrainDumpNote {
  id: string;
  text: string;
  createdAt: number;
}

function getBrainDumpNotes(): BrainDumpNote[] {
  try {
    const raw = localStorage.getItem('budgetplanner_braindump') || localStorage.getItem('pocketledger_braindump');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveBrainDumpNotes(notes: BrainDumpNote[]) {
  try {
    localStorage.setItem('budgetplanner_braindump', JSON.stringify(notes));
  } catch (e) {
    console.warn('Failed to save brain dump:', e);
  }
}

function renderBrainDump() {
  const container = document.getElementById('brain-dump-list');
  const countBadge = document.getElementById('brain-dump-count');
  if (!container) return;

  const notes = getBrainDumpNotes();
  if (countBadge) {
    countBadge.textContent = `${notes.length} item${notes.length === 1 ? '' : 's'}`;
  }

  if (notes.length === 0) {
    container.innerHTML = '<div style="font-size: 0.82rem; color: var(--text-muted); padding: 8px 0;">nothing dumped yet. thoughts, reminders, not money.</div>';
    return;
  }

  container.innerHTML = '';
  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'brain-dump-item';
    item.innerHTML = `
      <span>${note.text}</span>
      <button type="button" class="brain-dump-item-del" title="Delete note" data-del-note="${note.id}">&times;</button>
    `;
    item.querySelector('[data-del-note]')?.addEventListener('click', () => {
      const updated = getBrainDumpNotes().filter(n => n.id !== note.id);
      saveBrainDumpNotes(updated);
      renderBrainDump();
    });
    container.appendChild(item);
  });
}

document.getElementById('form-brain-dump')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('input-brain-dump') as HTMLInputElement | null;
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  const notes = getBrainDumpNotes();
  notes.unshift({
    id: 'bd_' + Math.random().toString(36).slice(2, 9),
    text,
    createdAt: Date.now()
  });
  saveBrainDumpNotes(notes);
  input.value = '';
  renderBrainDump();
});

document.getElementById('row-chk-balance-set')?.addEventListener('click', () => {
  const modal = document.getElementById('modal-update-balance') as HTMLDialogElement;
  if (modal) {
    modal.showModal();
    const inputBal = document.getElementById('modal-input-balance') as HTMLInputElement;
    if (inputBal) {
      inputBal.value = (state.account.balance / 100).toFixed(2);
      inputBal.focus();
    }
  }
});

// Modal Close Buttons
document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', () => {
    const modalId = btn.getAttribute('data-close-modal');
    if (modalId) {
      if (modalId === 'modal-log-spend') {
        closeLogSpendModal();
      } else if (modalId === 'modal-how-it-works') {
        closeHowItWorksModal();
      } else if (modalId === 'modal-device-pair') {
        closeDevicePairModal();
      } else if (modalId === 'modal-device-join') {
        closeDeviceJoinModal();
      } else if (modalId === 'modal-recovery-key') {
        closeRecoveryKeyModal();
      } else if (modalId === 'modal-sync-help') {
        closeSyncHelpModal();
      } else if (modalId === 'modal-quick-actions') {
        closeQuickActionsModal();
      } else {
        (document.getElementById(modalId) as HTMLDialogElement)?.close();
      }
    }
  });
});

// How It Works Modal Triggers
document.getElementById('btn-header-how-it-works')?.addEventListener('click', () => openHowItWorksModal());
document.getElementById('btn-sidebar-how-it-works')?.addEventListener('click', () => openHowItWorksModal());
document.getElementById('btn-link-how-from-breakdown')?.addEventListener('click', () => openHowItWorksModal());
document.getElementById('btn-settings-open-how-it-works')?.addEventListener('click', () => openHowItWorksModal());

// Backdrop click for how-it-works modal
modalHowItWorks?.addEventListener('click', (e) => {
  if (e.target === modalHowItWorks) {
    closeHowItWorksModal();
  }
});

// ==========================================
// QUICK ACTIONS (COMMAND PALETTE) & VIEW MODE
// ==========================================
const modalQuickActions = document.getElementById('modal-quick-actions') as HTMLDialogElement | null;
const inputQuickSearch = document.getElementById('input-quick-search') as HTMLInputElement | null;
const btnQuickSearchClear = document.getElementById('btn-quick-search-clear') as HTMLButtonElement | null;
const quickActionsList = document.getElementById('quick-actions-list') as HTMLElement | null;

const QUICK_SCREENS = [
  { id: 'today', label: 'Go to Today', sublabel: 'Safe to spend today, daily pulse & checklist' },
  { id: 'month', label: 'Go to The month', sublabel: 'Month planner, calendar & month at a glance' },
  { id: 'bills', label: 'Go to Bills', sublabel: 'Recurring bills, due dates & status tracking' },
  { id: 'income', label: 'Go to Money in', sublabel: 'Paychecks, scheduled income & cash flow' },
  { id: 'goals', label: 'Go to Goals', sublabel: 'Saving up for targets & visual progress bars' },
  { id: 'debt', label: 'Go to Debt', sublabel: 'Snowball & avalanche payoff plans' },
  { id: 'envelopes', label: 'Go to Envelopes', sublabel: 'Variable spending categories & envelopes' },
  { id: 'milestones', label: 'Go to Milestones', sublabel: 'Emergency cushion, progress milestones & wins' },
  { id: 'settings', label: 'Go to Settings', sublabel: 'Currency, theme, auto-save & device sync' }
];

function parseQuickSpend(query: string): { amountCents: number; category: string; note: string } | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^\$?(\d+(?:\.\d{1,2})?)\s*(.*)$/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  if (isNaN(val) || val <= 0) return null;
  const cents = Math.round(val * 100);
  let rawNote = match[2].trim();
  let cat = rawNote ? rawNote.charAt(0).toUpperCase() + rawNote.slice(1) : 'General';
  return { amountCents: cents, category: cat, note: rawNote || 'Quick logged' };
}

let activeQuickIndex = 0;

function renderQuickActions(query: string = '') {
  if (!quickActionsList) return;
  const cleanQuery = query.trim().toLowerCase();
  const quickSpend = parseQuickSpend(cleanQuery);

  let html = '';

  if (quickSpend) {
    html += `
      <div class="quick-action-item quick-action-spend-action active" data-type="spend" data-amount="${quickSpend.amountCents}" data-category="${escapeHtml(quickSpend.category)}" data-note="${escapeHtml(quickSpend.note)}" role="option" tabindex="0">
        <div class="quick-action-left">
          <div class="quick-action-icon-wrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </div>
          <div>
            <div class="quick-action-label">Log ${fmt(quickSpend.amountCents)} &middot; ${escapeHtml(quickSpend.category)}</div>
            <div class="quick-action-sublabel">Press Enter to log instantly to today's ledger</div>
          </div>
        </div>
        <span class="quick-action-badge action-badge">LOG SPEND</span>
      </div>
    `;
  }

  const matchedScreens = QUICK_SCREENS.filter(s => {
    if (!cleanQuery || quickSpend) return true;
    return s.label.toLowerCase().includes(cleanQuery) ||
           s.id.toLowerCase().includes(cleanQuery) ||
           s.sublabel.toLowerCase().includes(cleanQuery);
  });

  matchedScreens.forEach((s, idx) => {
    const isActive = !quickSpend && idx === 0;
    html += `
      <div class="quick-action-item ${isActive ? 'active' : ''}" data-type="screen" data-tab="${s.id}" role="option" tabindex="0">
        <div class="quick-action-left">
          <div class="quick-action-icon-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
          <div>
            <div class="quick-action-label">${escapeHtml(s.label)}</div>
            <div class="quick-action-sublabel">${escapeHtml(s.sublabel)}</div>
          </div>
        </div>
        <span class="quick-action-badge">GO</span>
      </div>
    `;
  });

  if (!quickSpend && matchedScreens.length === 0) {
    html = `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
        No screens match "${escapeHtml(query)}"
      </div>
    `;
  }

  quickActionsList.innerHTML = html;
  activeQuickIndex = 0;

  quickActionsList.querySelectorAll<HTMLElement>('.quick-action-item').forEach(itemEl => {
    itemEl.addEventListener('click', () => {
      executeQuickAction(itemEl);
    });
  });
}

function executeQuickAction(itemEl: HTMLElement) {
  const type = itemEl.getAttribute('data-type');
  if (type === 'spend') {
    const amount = parseInt(itemEl.getAttribute('data-amount') || '0', 10);
    const category = itemEl.getAttribute('data-category') || 'General';
    const note = itemEl.getAttribute('data-note') || (category !== 'General' ? category : 'Quick logged');
    if (amount > 0) {
      const prevTransactions = [...state.transactions];
      state = addTransaction(state, amount, category, getTodayStr(), note);
      const newTx = state.transactions.find(t => !prevTransactions.some(p => p.id === t.id));

      persistState();
      renderAll();

      if (newTx) {
        showUndoToast(`Logged ${fmt(amount)} · ${category}`, () => {
          state.transactions = state.transactions.filter(t => t.id !== newTx.id);
          persistState();
          renderAll();
        });
      }
    }
  } else if (type === 'screen') {
    const tab = itemEl.getAttribute('data-tab');
    if (tab) {
      navigateToTab(tab);
    }
  }
  closeQuickActionsModal();
}

function openQuickActionsModal() {
  if (!modalQuickActions) return;
  if (inputQuickSearch) {
    inputQuickSearch.value = '';
    btnQuickSearchClear?.classList.remove('visible');
  }
  renderQuickActions('');
  modalQuickActions.showModal();
  setTimeout(() => inputQuickSearch?.focus(), 50);
}

function closeQuickActionsModal() {
  if (modalQuickActions && modalQuickActions.open) {
    modalQuickActions.close();
  }
}

function toggleQuickActionsModal() {
  if (!modalQuickActions) return;
  if (modalQuickActions.open) {
    closeQuickActionsModal();
  } else {
    openQuickActionsModal();
  }
}

// Search input events
inputQuickSearch?.addEventListener('input', () => {
  const val = inputQuickSearch.value;
  btnQuickSearchClear?.classList.toggle('visible', val.length > 0);
  renderQuickActions(val);
});

btnQuickSearchClear?.addEventListener('click', () => {
  if (inputQuickSearch) {
    inputQuickSearch.value = '';
    btnQuickSearchClear.classList.remove('visible');
    renderQuickActions('');
    inputQuickSearch.focus();
  }
});

inputQuickSearch?.addEventListener('keydown', (e: KeyboardEvent) => {
  const items = Array.from(quickActionsList?.querySelectorAll<HTMLElement>('.quick-action-item') || []);
  if (items.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeQuickIndex = (activeQuickIndex + 1) % items.length;
    items.forEach((it, idx) => it.classList.toggle('active', idx === activeQuickIndex));
    items[activeQuickIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeQuickIndex = (activeQuickIndex - 1 + items.length) % items.length;
    items.forEach((it, idx) => it.classList.toggle('active', idx === activeQuickIndex));
    items[activeQuickIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const activeItem = items[activeQuickIndex] || items[0];
    if (activeItem) {
      executeQuickAction(activeItem);
    }
  }
});

// Trigger button and backdrop
document.getElementById('btn-header-quick-actions')?.addEventListener('click', () => {
  openQuickActionsModal();
});

modalQuickActions?.addEventListener('click', (e) => {
  if (e.target === modalQuickActions) {
    closeQuickActionsModal();
  }
});

// Global shortcut: Ctrl+K / Cmd+K
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k')) {
    e.preventDefault();
    toggleQuickActionsModal();
  }
});

// View Mode Toggle (Simple vs Advanced)
document.getElementById('btn-view-mode-simple')?.addEventListener('click', () => {
  if (state.layoutMode === 'simple') return;
  state.layoutMode = 'simple';
  persistState();
  applyLayoutMode('simple');
  showUndoToast('Switched to Simple view (ADHD essentials)');
});

document.getElementById('btn-view-mode-advanced')?.addEventListener('click', () => {
  if (state.layoutMode === 'everything') return;
  state.layoutMode = 'everything';
  persistState();
  applyLayoutMode('everything');
  showUndoToast('Switched to Advanced view (All tools visible)');
});

// Sidebar Every Goal button
document.getElementById('btn-sidebar-every-goal')?.addEventListener('click', () => {
  navigateToTab('goals');
});

// Device Sync & Recovery Triggers
document.getElementById('btn-open-sync-pair')?.addEventListener('click', () => openDevicePairModal());
document.getElementById('btn-sync-turn-on')?.addEventListener('click', () => openDevicePairModal());
document.getElementById('btn-open-sync-join')?.addEventListener('click', () => openDeviceJoinModal());
document.getElementById('btn-open-sync-join-connected')?.addEventListener('click', () => openDeviceJoinModal());
document.getElementById('btn-show-recovery-key')?.addEventListener('click', () => openRecoveryKeyModal());
document.getElementById('btn-sync-help-badge')?.addEventListener('click', () => openSyncHelpModal());
document.getElementById('btn-open-sync-step-help')?.addEventListener('click', () => openSyncHelpModal());

// Backdrop clicks for device sync modals
modalDevicePair?.addEventListener('click', (e) => {
  if (e.target === modalDevicePair) closeDevicePairModal();
});
modalDeviceJoin?.addEventListener('click', (e) => {
  if (e.target === modalDeviceJoin) closeDeviceJoinModal();
});
modalRecoveryKey?.addEventListener('click', (e) => {
  if (e.target === modalRecoveryKey) closeRecoveryKeyModal();
});
modalSyncHelp?.addEventListener('click', (e) => {
  if (e.target === modalSyncHelp) closeSyncHelpModal();
});

// Sync Now Action
document.getElementById('btn-sync-now')?.addEventListener('click', async () => {
  ensureSyncState();
  const pill = document.getElementById('sync-status-pill');
  const btn = document.getElementById('btn-sync-now') as HTMLButtonElement | null;
  if (pill) {
    pill.setAttribute('data-state', 'syncing');
    pill.innerHTML = '<span class="device-spin-icon" style="width:11px;height:11px;border-width:1.5px;"></span> Syncing&hellip;';
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Syncing\u2026';
  }

  try {
    const vaultId = state.sync?.vaultId;
    if (vaultId) {
      const res = await fetch(`/api/sync/vault?id=${vaultId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.state && data.updatedAt && (!state.sync?.lastSyncedAt || data.updatedAt > state.sync.lastSyncedAt)) {
          const curVaultId = state.sync!.vaultId;
          const curDeviceId = state.sync!.deviceId;
          Object.assign(state, data.state);
          state.sync = {
            ...(state.sync || {}),
            isSynced: true,
            syncStatus: 'synced',
            lastSyncedAt: data.updatedAt,
            vaultId: curVaultId,
            deviceId: curDeviceId
          };
          saveState(state);
          renderAll();
        } else {
          await fetch(`/api/sync/vault?id=${vaultId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vaultId, state })
          });
        }
      } else {
        await fetch(`/api/sync/vault?id=${vaultId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vaultId, state })
        });
      }
    }
    state.sync!.lastSyncedAt = Date.now();
    state.sync!.isSynced = true;
    state.sync!.syncStatus = 'synced';
    persistState();
    renderSyncSettings();
    showUndoToast('✓ Sync complete!');
  } catch (err) {
    console.warn('Sync now error:', err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Sync now';
    }
  }
});

// Stop Syncing Action
document.getElementById('btn-sync-stop')?.addEventListener('click', () => {
  if (confirm('Stop syncing on this device? Your local data will remain completely intact.')) {
    ensureSyncState();
    state.sync!.isSynced = false;
    state.sync!.syncStatus = 'local';
    persistState();
    renderSyncSettings();
  }
});

// Delete Sync Everywhere Action
document.getElementById('btn-sync-delete')?.addEventListener('click', async () => {
  if (confirm('Delete the synced copy everywhere? This resets your device connection and creates a fresh recovery key.')) {
    ensureSyncState();
    const vaultId = state.sync?.vaultId;
    if (vaultId) {
      try {
        await fetch(`/api/sync/vault?id=${vaultId}`, { method: 'DELETE' });
      } catch {}
    }
    state.sync!.isSynced = false;
    state.sync!.syncStatus = 'local';
    state.sync!.vaultId = undefined;
    state.sync!.recoveryKey = 'PL-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    persistState();
    renderSyncSettings();
    alert('Synced copy deleted. Your local data remains active.');
  }
});

// Pairing code numeric formatter
const inputSyncPairCode = document.getElementById('input-sync-pair-code') as HTMLInputElement | null;
inputSyncPairCode?.addEventListener('input', () => {
  let raw = inputSyncPairCode.value.replace(/\D/g, '').slice(0, 6);
  if (raw.length > 3) {
    inputSyncPairCode.value = raw.slice(0, 3) + ' ' + raw.slice(3);
  } else {
    inputSyncPairCode.value = raw;
  }
});

// Submit Join Pairing Code
document.getElementById('btn-submit-pair-code')?.addEventListener('click', async () => {
  const input = document.getElementById('input-sync-pair-code') as HTMLInputElement | null;
  const feedback = document.getElementById('device-join-feedback');
  const btn = document.getElementById('btn-submit-pair-code') as HTMLButtonElement | null;
  const raw = (input?.value || '').replace(/\s+/g, '');
  if (raw.length !== 6) {
    if (feedback) {
      feedback.style.display = 'block';
      feedback.className = 'device-join-feedback error';
      feedback.textContent = 'Please enter a valid 6-digit code.';
    }
    return;
  }

  if (feedback) {
    feedback.style.display = 'block';
    feedback.className = 'device-join-feedback';
    feedback.textContent = 'Connecting to other device\u2026';
  }
  if (btn) btn.disabled = true;

  try {
    ensureSyncState();
    const guestDeviceId = state.sync!.deviceId || ('guest_' + Math.random().toString(36).substring(2, 9));
    state.sync!.deviceId = guestDeviceId;

    const res = await fetch('/api/sync/pair/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: raw, deviceId: guestDeviceId })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      if (feedback) {
        feedback.style.display = 'block';
        feedback.className = 'device-join-feedback error';
        feedback.textContent = data.error || 'Pairing code not found or expired. Check the code and try again.';
      }
      if (btn) btn.disabled = false;
      return;
    }

    if (feedback) {
      feedback.style.display = 'block';
      feedback.className = 'device-join-feedback success';
      feedback.textContent = '\u2713 Connected! Synchronizing planner data\u2026';
    }

    if (data.state) {
      const syncedState: LedgerState = {
        ...data.state,
        sync: {
          ...data.state.sync,
          isSynced: true,
          syncStatus: 'synced',
          lastSyncedAt: Date.now(),
          vaultId: data.vaultId || data.state.sync?.vaultId,
          pairingCode: raw,
          deviceId: guestDeviceId
        }
      };
      Object.assign(state, syncedState);
      saveState(state);
    } else {
      state.sync!.isSynced = true;
      state.sync!.syncStatus = 'synced';
      state.sync!.lastSyncedAt = Date.now();
      state.sync!.vaultId = data.vaultId;
      state.sync!.pairingCode = raw;
      persistState();
    }

    setTimeout(() => {
      closeDeviceJoinModal();
      if (btn) btn.disabled = false;
      renderAll();
      renderSyncSettings();
      showUndoToast('✓ Device connected and synchronized!');
    }, 900);
  } catch (err: any) {
    if (feedback) {
      feedback.style.display = 'block';
      feedback.className = 'device-join-feedback error';
      feedback.textContent = 'Could not reach sync service. Make sure both browsers are on http://localhost:4173/';
    }
    if (btn) btn.disabled = false;
  }
});

// Copy Recovery Key Action
document.getElementById('btn-copy-recovery-key')?.addEventListener('click', async () => {
  ensureSyncState();
  const key = state.sync!.recoveryKey || 'PL-8A2F-9C4D-7E1B';
  try {
    await navigator.clipboard.writeText(key);
    const btn = document.getElementById('btn-copy-recovery-key');
    if (btn) {
      btn.textContent = 'Copied! \u2713';
      setTimeout(() => { btn.textContent = 'Copy key'; }, 2000);
    }
  } catch {
    prompt('Copy your recovery key:', key);
  }
});

// Action buttons inside How It Works Guide
document.getElementById('guide-btn-step1')?.addEventListener('click', () => {
  closeHowItWorksModal();
  const modal = document.getElementById('modal-update-balance') as HTMLDialogElement;
  if (modal) {
    modal.showModal();
    const inputBal = document.getElementById('modal-input-balance') as HTMLInputElement;
    if (inputBal) {
      inputBal.value = (state.account.balance / 100).toFixed(2);
      inputBal.focus();
    }
  }
});

document.getElementById('guide-btn-step2')?.addEventListener('click', () => {
  closeHowItWorksModal();
  setActiveTab('settings');
  setTimeout(() => {
    document.getElementById('form-update-payday')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
});

document.getElementById('guide-btn-step3')?.addEventListener('click', () => {
  closeHowItWorksModal();
  setActiveTab('bills');
});

document.getElementById('guide-btn-step4')?.addEventListener('click', () => {
  closeHowItWorksModal();
  setActiveTab('today');
});

document.getElementById('guide-btn-step5')?.addEventListener('click', () => {
  closeHowItWorksModal();
  setTimeout(() => openLogSpendModal(), 50);
});

document.getElementById('guide-btn-step6')?.addEventListener('click', () => {
  closeHowItWorksModal();
  setActiveTab('envelopes');
});

// Quick balance edit trigger from breakdown
document.getElementById('bd-checking')?.parentElement?.addEventListener('click', () => {
  const modal = document.getElementById('modal-update-balance') as HTMLDialogElement;
  if (modal) {
    modal.showModal();
    const inputBal = document.getElementById('modal-input-balance') as HTMLInputElement;
    if (inputBal) {
      inputBal.value = (state.account.balance / 100).toFixed(2);
      inputBal.focus();
    }
  }
});


// Modal Update Checking Balance Submission
document.getElementById('form-modal-update-balance')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const inputBal = document.getElementById('modal-input-balance') as HTMLInputElement;
  const dollars = parseFloat(inputBal.value);
  if (isNaN(dollars) || dollars < 0) return;

  const cents = Math.round(dollars * 100);
  state = updateCheckingBalance(state, cents, getTodayStr());
  persistState();

  (document.getElementById('modal-update-balance') as HTMLDialogElement)?.close();
  renderAll();
});

// Reset Data Modal Triggers
document.getElementById('btn-trigger-reset')?.addEventListener('click', () => {
  const modal = document.getElementById('modal-reset-confirm') as HTMLDialogElement;
  if (modal) modal.showModal();
});

document.getElementById('btn-confirm-empty-reset')?.addEventListener('click', () => {
  state = resetState(true);
  autoSaveHandle = null;
  applyTheme(state.theme);
  applyColorScheme(state.colorScheme || 'royal-glimmer');
  applyLayoutMode(state.layoutMode || 'everything');
  (document.getElementById('modal-reset-confirm') as HTMLDialogElement)?.close();
  renderAll();
  alert('All numbers have been reset to $0 (clean empty file).');
});

document.getElementById('btn-confirm-demo-reset')?.addEventListener('click', () => {
  state = resetState(false);
  applyTheme(state.theme);
  applyColorScheme(state.colorScheme || 'royal-glimmer');
  applyLayoutMode(state.layoutMode || 'everything');
  (document.getElementById('modal-reset-confirm') as HTMLDialogElement)?.close();
  renderAll();
  alert('Reset to default example numbers.');
});

// ====================================================
// MONEY IN (INCOME) CONTROLLERS & EVENTS
// ====================================================
document.getElementById('btn-open-add-income')?.addEventListener('click', () => {
  const modal = document.getElementById('modal-add-income') as HTMLDialogElement;
  if (modal) {
    const dateInput = document.getElementById('income-date-input') as HTMLInputElement;
    if (dateInput) dateInput.value = getTodayStr();
    modal.showModal();
  }
});

// Income status filter tabs
const incomeFilterBtns = document.querySelectorAll('#income-filter-pills .segment-btn, #income-filter-pills .filter-pill');
incomeFilterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    incomeFilterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentIncomeFilter = (btn.getAttribute('data-income-filter') || 'all') as any;
    renderIncome();
  });
});

// Income status selection pills inside add modal
const incomeStatusPills = document.querySelectorAll('#income-status-pills button');
incomeStatusPills.forEach(pill => {
  pill.addEventListener('click', () => {
    incomeStatusPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    const val = pill.getAttribute('data-status-val') || 'arrived';
    const hidden = document.getElementById('income-status-value') as HTMLInputElement;
    if (hidden) hidden.value = val;
  });
});

// Add Income Form Submission
document.getElementById('form-add-income')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const sourceInput = document.getElementById('income-source-input') as HTMLInputElement;
  const amountInput = document.getElementById('income-amount-input') as HTMLInputElement;
  const dateInput = document.getElementById('income-date-input') as HTMLInputElement;
  const statusInput = document.getElementById('income-status-value') as HTMLInputElement;
  const notesInput = document.getElementById('income-notes-input') as HTMLInputElement;

  const dollars = parseFloat(amountInput.value);
  if (isNaN(dollars) || dollars <= 0) return;

  const cents = Math.round(dollars * 100);
  const source = sourceInput.value.trim() || 'Extra Income';
  const date = dateInput.value || getTodayStr();
  const status = (statusInput.value || 'arrived') as 'arrived' | 'soon' | 'later';
  const notes = notesInput.value.trim() || undefined;

  const newId = `inc-${Date.now()}`;
  const newItem: IncomeItem = {
    id: newId,
    source,
    amount: cents,
    date,
    status,
    notes,
    createdAt: Date.now()
  };

  state = addIncome(state, newItem);
  persistState();

  const modal = document.getElementById('modal-add-income') as HTMLDialogElement;
  modal?.close();

  sourceInput.value = '';
  amountInput.value = '';
  notesInput.value = '';
  renderAll();

  showUndoToast(`Recorded ${fmt(cents)} in · ${source}`, () => {
    state = deleteIncome(state, newId);
    persistState();
    renderAll();
  });
});

// ====================================================
// MILESTONES CONTROLLERS & EVENTS
// ====================================================
const milestoneFilterBtns = document.querySelectorAll('#milestones-filter-pills .segment-btn, #milestones-filter-pills .filter-pill');
milestoneFilterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    milestoneFilterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMilestoneFilter = (btn.getAttribute('data-milestone-filter') || 'all') as any;
    renderMilestones();
  });
});

// Universal Click Handler for dynamic Income & Milestone rows
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  // Toggle income status
  const toggleIncomeId = target.getAttribute('data-toggle-income-status');
  if (toggleIncomeId) {
    const item = (state.incomes || []).find(i => i.id === toggleIncomeId);
    if (item) {
      const nextStatus = item.status === 'arrived' ? 'soon' : item.status === 'soon' ? 'later' : 'arrived';
      const prevStatus = item.status;
      state = updateIncomeStatus(state, toggleIncomeId, nextStatus);
      persistState();
      renderAll();
      showUndoToast(`Status changed to ${nextStatus}`, () => {
        state = updateIncomeStatus(state, toggleIncomeId, prevStatus);
        persistState();
        renderAll();
      });
    }
    return;
  }

  // Delete income item
  const delIncomeId = target.getAttribute('data-delete-income');
  if (delIncomeId) {
    const item = (state.incomes || []).find(i => i.id === delIncomeId);
    if (item) {
      state = deleteIncome(state, delIncomeId);
      persistState();
      renderAll();
      showUndoToast(`Deleted ${item.source}`, () => {
        state = addIncome(state, item);
        persistState();
        renderAll();
      });
    }
    return;
  }

  // Toggle Milestone reached state
  const milestoneToggleBtn = target.closest('[data-toggle-milestone]') as HTMLElement;
  if (milestoneToggleBtn) {
    const mId = milestoneToggleBtn.getAttribute('data-toggle-milestone');
    if (mId && state.milestones) {
      state.milestones = state.milestones.map(m => {
        if (m.id === mId) {
          const nextReached = !m.isReached;
          return {
            ...m,
            isReached: nextReached,
            reachedAt: nextReached ? getTodayStr() : undefined
          };
        }
        return m;
      });
      persistState();
      renderAll();
      const updated = state.milestones.find(m => m.id === mId);
      showUndoToast(
        updated?.isReached ? `Milestone reached: ${updated.title}` : `Milestone reset: ${updated?.title}`,
        () => {
          state.milestones = state.milestones!.map(m => {
            if (m.id === mId) {
              return {
                ...m,
                isReached: !m.isReached,
                reachedAt: !m.isReached ? getTodayStr() : undefined
              };
            }
            return m;
          });
          persistState();
          renderAll();
        }
      );
    }
    return;
  }
});

// Mobile FAB trigger
document.getElementById('btn-mobile-fab-log')?.addEventListener('click', () => {
  openLogSpendModal();
});

// Print Guide action
document.getElementById('btn-print-guide')?.addEventListener('click', () => {
  window.print();
});

// Initial render
renderAll();

if (window.location.hash === '#modal' || window.location.search.includes('modal=1')) {
  setTimeout(() => openLogSpendModal(), 60);
} else if (window.location.hash === '#guide' || window.location.hash === '#how-it-works') {
  setTimeout(() => openHowItWorksModal(), 60);
}
