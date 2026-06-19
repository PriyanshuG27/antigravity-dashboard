// Antigravity Usage Log Dashboard Script

let conversations = [];
let statsData = {};
let lastFetchedIdeQuota = null;

let activeTab = 'overview';
let activeFolder = null;
let folderGrouping = 'project';
let selectedExplorerConvId = null;

let projectPhases = [];
let activePhaseIndex = 0;
let isPhaseManagerActive = false;

document.addEventListener('DOMContentLoaded', () => {
    // Apply saved theme or auto-detect system dark mode preference
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.body.classList.add('dark-theme');
    }
    updateThemeButton();
    fetchStats();
    fetchConversations();
    initMetricCardsClickListeners();
    initGuardian();
    
    // Live update short-polling every 30 seconds, only if tab is active
    setInterval(() => {
        if (document.visibilityState === 'visible') {
            fetchStats();
            fetchConversations();
        }
    }, 30000);
});

// Switch tabs between Overview and Explorer
function switchTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    const targetBtn = document.getElementById(`tab-btn-${tabId}`);
    const targetPane = document.getElementById(`${tabId}-pane`);
    if (targetBtn) targetBtn.classList.add('active');
    if (targetPane) targetPane.classList.add('active');
    
    if (tabId === 'explorer') {
        selectedExplorerConvId = null;
        renderExplorerFolders();
        renderExplorerCards();
    } else if (tabId === 'guardian') {
        renderWeeklyActivitySummary();
    }
}

// Group conversations by Project or Month
function getFolderGroups() {
    const groups = {};
    conversations.forEach(c => {
        let key = "General";
        if (folderGrouping === 'project') {
            key = c.project || "General";
        } else if (folderGrouping === 'date') {
            key = c.date_short ? c.date_short.substring(0, 7) : "Unknown Date";
        }
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(c);
    });
    return groups;
}

// Render dynamic folders list
function renderExplorerFolders() {
    const container = document.getElementById('folder-list-container');
    if (!container) return;
    container.innerHTML = '';
    
    const groups = getFolderGroups();
    
    // Sort folder keys (descending for dates, alphabetical for projects except General)
    const folderKeys = Object.keys(groups).sort((a, b) => {
        if (folderGrouping === 'date') return b.localeCompare(a);
        if (a === 'General') return 1;
        if (b === 'General') return -1;
        return a.localeCompare(b);
    });
    
    // If activeFolder is not set or not in current keys, default to the first folder
    if (folderKeys.length > 0 && (!activeFolder || !groups[activeFolder])) {
        activeFolder = folderKeys[0];
    }
    
    folderKeys.forEach(key => {
        const count = groups[key].length;
        const div = document.createElement('div');
        div.className = `folder-item ${activeFolder === key ? 'active' : ''}`;
        
        let iconSvg = '';
        if (folderGrouping === 'project') {
            iconSvg = `<svg class="tab-icon" style="margin-right: 8px; opacity: 0.8;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
        } else {
            iconSvg = `<svg class="tab-icon" style="margin-right: 8px; opacity: 0.8;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
        }
        
        div.innerHTML = `
            <div class="folder-name-wrapper">
                ${iconSvg}
                <span>${key}</span>
            </div>
            <span class="folder-badge">${count}</span>
        `;
        
        div.addEventListener('click', () => {
            activeFolder = key;
            selectedExplorerConvId = null;
            renderExplorerFolders();
            renderExplorerCards();
        });
        
        container.appendChild(div);
    });
}

// -------------------------------------------------------------
// Quota & Prompt Guardian Controller
// -------------------------------------------------------------
let accounts = [];

function initGuardian() {
    // Load accounts from localStorage
    const savedAccounts = localStorage.getItem('guardian_accounts');
    if (savedAccounts) {
        accounts = JSON.parse(savedAccounts);
        let migrated = false;
        accounts.forEach(acc => {
            if (acc.email === undefined) {
                acc.email = "";
                migrated = true;
            }
            // Migrate flat account structure to nested Gemini + Claude structure
            if (acc.gemini === undefined || acc.claude === undefined) {
                const isGeminiPool = acc.pool === 'gemini';
                const flatWeeklyPct = acc.weeklyPct !== undefined ? acc.weeklyPct : 100;
                const flatWeeklyRefresh = acc.weeklyRefresh !== undefined ? acc.weeklyRefresh : 0;
                const flatFivehourPct = acc.fivehourPct !== undefined ? acc.fivehourPct : 100;
                const flatFivehourRefresh = acc.fivehourRefresh !== undefined ? acc.fivehourRefresh : 0;
                
                acc.gemini = {
                    weeklyPct: isGeminiPool ? flatWeeklyPct : 100,
                    weeklyRefresh: isGeminiPool ? flatWeeklyRefresh : 0,
                    fivehourPct: isGeminiPool ? flatFivehourPct : 100,
                    fivehourRefresh: isGeminiPool ? flatFivehourRefresh : 0
                };
                
                acc.claude = {
                    weeklyPct: !isGeminiPool ? flatWeeklyPct : 100,
                    weeklyRefresh: !isGeminiPool ? flatWeeklyRefresh : 0,
                    fivehourPct: !isGeminiPool ? flatFivehourPct : 100,
                    fivehourRefresh: !isGeminiPool ? flatFivehourRefresh : 0
                };
                
                delete acc.pool;
                delete acc.weeklyPct;
                delete acc.weeklyRefresh;
                delete acc.fivehourPct;
                delete acc.fivehourRefresh;
                
                migrated = true;
            }
        });
        

        if (migrated) {
            saveAccounts();
        }
    } else {
        // Initialize default nested accounts
        accounts = [
            {
                name: 'Account 1 (Primary)',
                email: 'pri2712gumber@gmail.com',
                isActive: true,
                gemini: { weeklyPct: 5, weeklyRefresh: 126, fivehourPct: 52, fivehourRefresh: 252 },
                claude: { weeklyPct: 100, weeklyRefresh: 0, fivehourPct: 100, fivehourRefresh: 0 }
            },
            {
                name: 'Account 2',
                email: 'priyanshugumber347@gmail.com',
                isActive: false,
                gemini: { weeklyPct: 91, weeklyRefresh: 9840, fivehourPct: 16, fivehourRefresh: 30 },
                claude: { weeklyPct: 100, weeklyRefresh: 0, fivehourPct: 100, fivehourRefresh: 0 }
            },
            {
                name: 'Account 3',
                email: '',
                isActive: false,
                gemini: { weeklyPct: 100, weeklyRefresh: 0, fivehourPct: 100, fivehourRefresh: 0 },
                claude: { weeklyPct: 100, weeklyRefresh: 0, fivehourPct: 100, fivehourRefresh: 0 }
            },
            {
                name: 'Account 4',
                email: '',
                isActive: false,
                gemini: { weeklyPct: 100, weeklyRefresh: 0, fivehourPct: 100, fivehourRefresh: 0 },
                claude: { weeklyPct: 100, weeklyRefresh: 0, fivehourPct: 100, fivehourRefresh: 0 }
            }
        ];
        saveAccounts();
    }
    fetchRulesFiles().then(() => {
        loadSelectedRulesFile();
    });
    loadWorkspaceFiles();
}

// -------------------------------------------------------------
// Weekly Activity Summary (auto-computed from transcript data)
// -------------------------------------------------------------
function renderWeeklyActivitySummary() {
    const container = document.getElementById('weekly-activity-summary');
    const rangeEl = document.getElementById('weekly-activity-range');
    if (!container) return;

    const now = new Date();
    // Start of current Monday (Mon=0)
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartTs = weekStart.getTime() / 1000;

    // Start of today (midnight)
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayStartTs = todayStart.getTime() / 1000;

    if (rangeEl) {
        rangeEl.textContent = `Mon ${weekStart.toLocaleDateString('en-GB', {day:'2-digit', month:'short'})} → now`;
    }

    if (!conversations || conversations.length === 0) {
        container.innerHTML = `<div style="opacity:0.5; font-size:0.8rem; font-family:'Fira Code',monospace;">No conversation data loaded yet.</div>`;
        return;
    }

    // Filter to this week's conversations
    const weekConvs = conversations.filter(c => c.timestamp >= weekStartTs);
    const geminiConvs = weekConvs.filter(c => c.pool === 'gemini');
    const claudeConvs = weekConvs.filter(c => c.pool === 'thirdparty');
    const todayConvs = conversations.filter(c => c.timestamp >= todayStartTs);    // Compute metrics
    const outToks      = weekConvs.reduce((s, c) => s + (c.output_tokens || 0), 0);
    const inToks       = weekConvs.reduce((s, c) => s + (c.input_tokens || 0), 0);
    const totalToks    = weekConvs.reduce((s, c) => s + (c.total_tokens || 0), 0);

    const gemOutToks   = geminiConvs.reduce((s, c) => s + (c.output_tokens || 0), 0);
    const gemInToks    = geminiConvs.reduce((s, c) => s + (c.input_tokens || 0), 0);
    const gemTotToks   = geminiConvs.reduce((s, c) => s + (c.total_tokens || 0), 0);

    const cldOutToks   = claudeConvs.reduce((s, c) => s + (c.output_tokens || 0), 0);
    const cldInToks    = claudeConvs.reduce((s, c) => s + (c.input_tokens || 0), 0);
    const cldTotToks   = claudeConvs.reduce((s, c) => s + (c.total_tokens || 0), 0);

    const totalMins    = weekConvs.reduce((s, c) => s + (c.duration_mins || 0), 0);
    const totalSteps   = weekConvs.reduce((s, c) => s + (c.steps || 0), 0);
    const totalRuns    = weekConvs.length;
    const totalErrors  = weekConvs.reduce((s, c) => s + (c.errors || 0), 0);
    const todayRuns    = todayConvs.length;

    const todayOutToks = todayConvs.reduce((s, c) => s + (c.output_tokens || 0), 0);
    const todayInToks  = todayConvs.reduce((s, c) => s + (c.input_tokens || 0), 0);
    const todayTotToks = todayConvs.reduce((s, c) => s + (c.total_tokens || 0), 0);

    function fmt(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
        return n.toString();
    }
    function fmtMins(m) {
        const h = Math.floor(m / 60), mm = Math.round(m % 60);
        return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
    }

    // Project breakdown by total tokens
    const byProject = {};
    weekConvs.forEach(c => {
        const p = c.project || 'General';
        if (!byProject[p]) byProject[p] = { runs: 0, outToks: 0, inToks: 0, totToks: 0, steps: 0 };
        byProject[p].runs++;
        byProject[p].outToks += c.output_tokens || 0;
        byProject[p].inToks += c.input_tokens || 0;
        byProject[p].totToks += c.total_tokens || 0;
        byProject[p].steps += c.steps || 0;
    });
    const topProjects = Object.entries(byProject)
        .sort((a, b) => b[1].totToks - a[1].totToks)
        .slice(0, 5);

    const projectRows = topProjects.map(([proj, s]) => `
        <div style="display:flex; flex-direction:column; padding: 8px 0; border-bottom:1px solid var(--border-color); gap: 4px;">
            <!-- First Row: Project Name & Total Tokens -->
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:700; color:var(--text-color); font-size:0.8rem;">${proj}</span>
                <span style="font-family:'Fira Code',monospace; font-weight:700; color:var(--chart-line); font-size:0.8rem;">
                    ${fmt(s.totToks)} <span style="font-size:0.68rem; font-weight:400; opacity:0.6; color:var(--text-color);">tot</span>
                </span>
            </div>
            <!-- Second Row: Breakdown Details & Steps -->
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.7rem; opacity:0.75; font-family:'Fira Code',monospace;">
                <span>${fmt(s.inToks)} in · ${fmt(s.outToks)} out</span>
                <span style="opacity:0.65;">${s.runs} run${s.runs !== 1 ? 's' : ''} (${s.steps} steps)</span>
            </div>
        </div>`).join('');

    container.innerHTML = `
        <!-- Key stats row -->
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px;">
            <div style="border:1.5px solid var(--border-color); border-radius:8px; padding:10px 12px; text-align:center; display:flex; flex-direction:column; justify-content:center; min-height:82px;">
                <div style="font-size:1.4rem; font-weight:700; font-family:'Fira Code',monospace; color:var(--chart-line);">${totalRuns}</div>
                <div style="font-size:0.68rem; opacity:0.6; text-transform:uppercase; margin-top:2px;">runs this week</div>
                <div style="font-size:0.7rem; opacity:0.55; margin-top:4px; font-family:'Fira Code',monospace;">
                    today: ${todayRuns} runs
                </div>
            </div>
            <div style="border:1.5px solid var(--border-color); border-radius:8px; padding:10px 12px; text-align:center; display:flex; flex-direction:column; justify-content:center; min-height:82px;">
                <div style="font-size:1.4rem; font-weight:700; font-family:'Fira Code',monospace; color:var(--chart-line);">${fmt(outToks)}</div>
                <div style="font-size:0.68rem; opacity:0.6; text-transform:uppercase; margin-top:2px;">output tokens</div>
                <div style="font-size:0.7rem; opacity:0.55; margin-top:4px; font-family:'Fira Code',monospace;">
                    in: ${fmt(inToks)} · tot: ${fmt(totalToks)}
                </div>
            </div>
            <div style="border:1.5px solid var(--border-color); border-radius:8px; padding:10px 12px; text-align:center; display:flex; flex-direction:column; justify-content:center; min-height:82px;">
                <div style="font-size:1.4rem; font-weight:700; font-family:'Fira Code',monospace; color:var(--chart-line);">${fmtMins(totalMins)}</div>
                <div style="font-size:0.68rem; opacity:0.6; text-transform:uppercase; margin-top:2px;">active time</div>
                <div style="font-size:0.7rem; opacity:0.55; margin-top:4px; font-family:'Fira Code',monospace;">
                    avg: ${fmtMins(totalMins / totalRuns || 0)}/run
                </div>
            </div>
        </div>

        <!-- Pool breakdown -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div style="border:1.5px solid var(--border-color); border-radius:8px; padding:10px 12px;">
                <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; color:var(--chart-line); margin-bottom:6px;">Gemini Pool</div>
                <div style="font-size:1.1rem; font-family:'Fira Code',monospace; font-weight:700; color:var(--chart-line);">${fmt(gemOutToks)} <span style="font-size:0.8rem; font-weight:400; opacity:0.75; color:var(--text-color);">out</span></div>
                <div style="font-size:0.7rem; opacity:0.65; font-family:'Fira Code',monospace; margin-top:2px;">
                    in: ${fmt(gemInToks)} · tot: ${fmt(gemTotToks)}
                </div>
                <div style="font-size:0.7rem; opacity:0.5; margin-top:4px;">${geminiConvs.length} run${geminiConvs.length !== 1 ? 's' : ''} this week</div>
            </div>
            <div style="border:1.5px solid var(--border-color); border-radius:8px; padding:10px 12px;">
                <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; color:var(--orange-4); margin-bottom:6px;">Claude/GPT Pool</div>
                <div style="font-size:1.1rem; font-family:'Fira Code',monospace; font-weight:700; color:var(--orange-4);">${fmt(cldOutToks)} <span style="font-size:0.8rem; font-weight:400; opacity:0.75; color:var(--text-color);">out</span></div>
                <div style="font-size:0.7rem; opacity:0.65; font-family:'Fira Code',monospace; margin-top:2px;">
                    in: ${fmt(cldInToks)} · tot: ${fmt(cldTotToks)}
                </div>
                <div style="font-size:0.7rem; opacity:0.5; margin-top:4px;">${claudeConvs.length} run${claudeConvs.length !== 1 ? 's' : ''} this week</div>
            </div>
        </div>

        <!-- Today + steps row -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div style="border:1.5px solid var(--border-color); border-radius:8px; padding:10px 12px;">
                <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; opacity:0.6; margin-bottom:6px;">Today</div>
                <div style="font-size:1.1rem; font-family:'Fira Code',monospace; font-weight:700;">${fmt(todayOutToks)} <span style="font-size:0.8rem; font-weight:400; opacity:0.75;">out</span></div>
                <div style="font-size:0.7rem; opacity:0.65; font-family:'Fira Code',monospace; margin-top:2px;">
                    in: ${fmt(todayInToks)} · tot: ${fmt(todayTotToks)}
                </div>
                <div style="font-size:0.7rem; opacity:0.5; margin-top:4px;">${todayRuns} run${todayRuns !== 1 ? 's' : ''} today</div>
            </div>
            <div style="border:1.5px solid var(--border-color); border-radius:8px; padding:10px 12px;">
                <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; opacity:0.6; margin-bottom:6px;">Total Steps</div>
                <div style="font-size:1.1rem; font-family:'Fira Code',monospace; font-weight:700;">${fmt(totalSteps)}</div>
                <div style="font-size:0.7rem; opacity:0.65; margin-top:2px;">&nbsp;</div>
                <div style="font-size:0.7rem; opacity:0.5; margin-top:4px;">${totalErrors > 0 ? `<span style="color:var(--badge-failed-text);">${totalErrors} errors</span>` : 'no errors'} this week</div>
            </div>
        </div>

        <!-- Project breakdown -->
        ${topProjects.length > 0 ? `
        <div>
            <div style="font-size:0.68rem; font-weight:700; text-transform:uppercase; opacity:0.6; margin-bottom:8px;">Top Projects This Week</div>
            ${projectRows}
        </div>` : ''}
    `;
}

function tickQuotas() {
    const now = Date.now();
    const lastTick = parseInt(localStorage.getItem('guardian_last_tick')) || now;
    const elapsedMins = Math.floor((now - lastTick) / 60000);
    
    if (elapsedMins > 0) {
        accounts.forEach(acc => {
            for (let m = 0; m < elapsedMins; m++) {
                // Ticks for Gemini pool
                if (acc.gemini.fivehourRefresh > 0) {
                    const recovery = (100 - acc.gemini.fivehourPct) / acc.gemini.fivehourRefresh;
                    acc.gemini.fivehourPct = Math.min(100, acc.gemini.fivehourPct + recovery);
                    acc.gemini.fivehourRefresh = Math.max(0, acc.gemini.fivehourRefresh - 1);
                } else {
                    acc.gemini.fivehourPct = 100;
                    acc.gemini.fivehourRefresh = 0;
                }
                
                if (acc.gemini.weeklyRefresh > 0) {
                    const recovery = (100 - acc.gemini.weeklyPct) / acc.gemini.weeklyRefresh;
                    acc.gemini.weeklyPct = Math.min(100, acc.gemini.weeklyPct + recovery);
                    acc.gemini.weeklyRefresh = Math.max(0, acc.gemini.weeklyRefresh - 1);
                } else {
                    acc.gemini.weeklyPct = 100;
                    acc.gemini.weeklyRefresh = 0;
                }
                
                // Ticks for Claude pool
                if (acc.claude.fivehourRefresh > 0) {
                    const recovery = (100 - acc.claude.fivehourPct) / acc.claude.fivehourRefresh;
                    acc.claude.fivehourPct = Math.min(100, acc.claude.fivehourPct + recovery);
                    acc.claude.fivehourRefresh = Math.max(0, acc.claude.fivehourRefresh - 1);
                } else {
                    acc.claude.fivehourPct = 100;
                    acc.claude.fivehourRefresh = 0;
                }
                
                if (acc.claude.weeklyRefresh > 0) {
                    const recovery = (100 - acc.claude.weeklyPct) / acc.claude.weeklyRefresh;
                    acc.claude.weeklyPct = Math.min(100, acc.claude.weeklyPct + recovery);
                    acc.claude.weeklyRefresh = Math.max(0, acc.claude.weeklyRefresh - 1);
                } else {
                    acc.claude.weeklyPct = 100;
                    acc.claude.weeklyRefresh = 0;
                }
            }
            acc.gemini.fivehourPct = parseFloat(acc.gemini.fivehourPct.toFixed(2));
            acc.gemini.weeklyPct = parseFloat(acc.gemini.weeklyPct.toFixed(2));
            acc.claude.fivehourPct = parseFloat(acc.claude.fivehourPct.toFixed(2));
            acc.claude.weeklyPct = parseFloat(acc.claude.weeklyPct.toFixed(2));
        });
        saveAccounts();
        localStorage.setItem('guardian_last_tick', String(now - (now - lastTick) % 60000));
        renderGuardianAccounts();
    }
}

function saveAccounts() {
    localStorage.setItem('guardian_accounts', JSON.stringify(accounts));
}

function renderGuardianAccounts() {
    const container = document.getElementById('account-slots');
    if (!container) return;
    container.innerHTML = '';
    
    accounts.forEach((acc, idx) => {
        const slot = document.createElement('div');
        slot.className = `account-slot ${acc.isActive ? 'active' : ''}`;
        
        // Calculate SVG circular progress values (circumference = 138)
        const weeklyCirc = 138;
        const fiveHourCirc = 138;
        
        // Gemini Calculations
        const geminiWeeklyOffset = weeklyCirc * (1 - acc.gemini.weeklyPct / 100);
        const geminiWeeklyCritical = acc.gemini.weeklyPct <= 10 ? 'critical' : (acc.gemini.weeklyPct <= 30 ? 'warning' : '');
        const geminiFiveHourOffset = fiveHourCirc * (1 - acc.gemini.fivehourPct / 100);
        const geminiFiveHourCritical = acc.gemini.fivehourPct <= 20 ? 'critical' : (acc.gemini.fivehourPct <= 50 ? 'warning' : '');
        
        const geminiWeeklyTime = acc.gemini.weeklyRefresh > 0 ? formatMinsToDaysHoursMins(acc.gemini.weeklyRefresh) : 'full';
        const geminiFiveHourTime = acc.gemini.fivehourRefresh > 0 ? formatMinsToHoursMins(acc.gemini.fivehourRefresh) : 'ready';
        
        // Claude Calculations
        const claudeWeeklyOffset = weeklyCirc * (1 - acc.claude.weeklyPct / 100);
        const claudeWeeklyCritical = acc.claude.weeklyPct <= 10 ? 'critical' : (acc.claude.weeklyPct <= 30 ? 'warning' : '');
        const claudeFiveHourOffset = fiveHourCirc * (1 - acc.claude.fivehourPct / 100);
        const claudeFiveHourCritical = acc.claude.fivehourPct <= 20 ? 'critical' : (acc.claude.fivehourPct <= 50 ? 'warning' : '');
        
        const claudeWeeklyTime = acc.claude.weeklyRefresh > 0 ? formatMinsToDaysHoursMins(acc.claude.weeklyRefresh) : 'full';
        const claudeFiveHourTime = acc.claude.fivehourRefresh > 0 ? formatMinsToHoursMins(acc.claude.fivehourRefresh) : 'ready';
        
        slot.innerHTML = `
            <div class="account-slot-header" style="display: flex; justify-content: space-between; align-items: center; width: 100%; border-bottom: 1.5px dashed var(--border-color); padding-bottom: 10px; margin-bottom: 6px;">
                <div class="account-nickname-row" style="display: flex; flex-direction: column; gap: 2px;">
                    <span class="account-nickname">${acc.name}</span>
                    <span class="account-email" style="font-size: 0.68rem; opacity: 0.55; font-family: 'Fira Code', monospace; font-weight: normal; letter-spacing: -0.2px;">${acc.email || 'no email linked'}</span>
                </div>
                <label class="account-radio-container" style="gap: 5px; opacity: ${acc.isActive ? '1' : '0.6'}; transition: opacity 0.2s;">
                    <input type="radio" name="active-account" class="account-radio-input" ${acc.isActive ? 'checked' : ''} onchange="setActiveAccount(${idx})">
                    <span style="font-size: 0.75rem; margin-left: 5px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">${acc.isActive ? '[Active]' : 'Activate'}</span>
                </label>
            </div>
            
            <div class="account-slot-body" style="display: flex; flex-direction: column; gap: 15px; margin-top: 10px; width: 100%;">
                <div style="display: flex; gap: 20px; flex-wrap: wrap; justify-content: space-between; align-items: center; width: 100%;">
                    
                    <!-- Gemini Section -->
                    <div style="flex: 1; min-width: 150px; border-right: 1.5px dashed var(--border-color); padding-right: 15px; display: flex; flex-direction: column; gap: 8px;">
                        <span class="eyebrow-tag" style="color: var(--chart-line); font-size: 0.7rem; font-weight: bold; letter-spacing: 0.5px;">Gemini Pool</span>
                        <div class="account-meters" style="display: flex; gap: 15px; align-items: center;">
                            <!-- Weekly Circular Meter -->
                            <div class="circular-meter meter-weekly ${geminiWeeklyCritical}">
                                <div class="circular-meter-gauge" style="position: relative; width: 50px; height: 50px;">
                                    <svg class="circular-meter-svg">
                                        <circle class="circular-meter-bg" cx="25" cy="25" r="22" />
                                        <circle class="circular-meter-fill" cx="25" cy="25" r="22" stroke-dasharray="${weeklyCirc}" stroke-dashoffset="${geminiWeeklyOffset}" />
                                    </svg>
                                    <span class="meter-label">${acc.gemini.weeklyPct}%</span>
                                </div>
                                <span class="meter-time-label" style="font-size: 0.58rem;">W: ${geminiWeeklyTime}</span>
                            </div>
                            <!-- 5-Hour Circular Meter -->
                            <div class="circular-meter meter-fivehour ${geminiFiveHourCritical}">
                                <div class="circular-meter-gauge" style="position: relative; width: 50px; height: 50px;">
                                    <svg class="circular-meter-svg">
                                        <circle class="circular-meter-bg" cx="25" cy="25" r="22" />
                                        <circle class="circular-meter-fill" cx="25" cy="25" r="22" stroke-dasharray="${fiveHourCirc}" stroke-dashoffset="${geminiFiveHourOffset}" />
                                    </svg>
                                    <span class="meter-label">${acc.gemini.fivehourPct}%</span>
                                </div>
                                <span class="meter-time-label" style="font-size: 0.58rem;">5h: ${geminiFiveHourTime}</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Claude/GPT Section -->
                    <div style="flex: 1; min-width: 150px; display: flex; flex-direction: column; gap: 8px;">
                        <span class="eyebrow-tag" style="color: var(--orange-4); font-size: 0.7rem; font-weight: bold; letter-spacing: 0.5px;">Claude/GPT Pool</span>
                        <div class="account-meters" style="display: flex; gap: 15px; align-items: center;">
                            <!-- Weekly Circular Meter -->
                            <div class="circular-meter meter-weekly ${claudeWeeklyCritical}">
                                <div class="circular-meter-gauge" style="position: relative; width: 50px; height: 50px;">
                                    <svg class="circular-meter-svg">
                                        <circle class="circular-meter-bg" cx="25" cy="25" r="22" />
                                        <circle class="circular-meter-fill" cx="25" cy="25" r="22" stroke-dasharray="${weeklyCirc}" stroke-dashoffset="${claudeWeeklyOffset}" />
                                    </svg>
                                    <span class="meter-label">${acc.claude.weeklyPct}%</span>
                                </div>
                                <span class="meter-time-label" style="font-size: 0.58rem;">W: ${claudeWeeklyTime}</span>
                            </div>
                            <!-- 5-Hour Circular Meter -->
                            <div class="circular-meter meter-fivehour ${claudeFiveHourCritical}">
                                <div class="circular-meter-gauge" style="position: relative; width: 50px; height: 50px;">
                                    <svg class="circular-meter-svg">
                                        <circle class="circular-meter-bg" cx="25" cy="25" r="22" />
                                        <circle class="circular-meter-fill" cx="25" cy="25" r="22" stroke-dasharray="${fiveHourCirc}" stroke-dashoffset="${claudeFiveHourOffset}" />
                                    </svg>
                                    <span class="meter-label">${acc.claude.fivehourPct}%</span>
                                </div>
                                <span class="meter-time-label" style="font-size: 0.58rem;">5h: ${claudeFiveHourTime}</span>
                            </div>
                        </div>
                    </div>
                    
                    <button class="theme-toggle-btn" style="padding: 6px 12px; font-size: 0.75rem; font-weight: bold; border-radius: 6px; align-self: center;" onclick="openSyncQuotaModal(${idx})">Sync</button>
                    
                </div>
            </div>
        `;
        
        container.appendChild(slot);
    });
}

function formatMinsToDaysHoursMins(mins) {
    if (mins <= 0) return '0m';
    const days = Math.floor(mins / 1440);
    const hours = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    
    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (m > 0 || parts.length === 0) parts.push(`${m}m`);
    return parts.join(' ');
}

function formatMinsToHoursMins(mins) {
    if (mins <= 0) return '0m';
    const hours = Math.floor(mins / 60);
    const m = mins % 60;
    
    let parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (m > 0 || parts.length === 0) parts.push(`${m}m`);
    return parts.join(' ');
}

function minsToDaysHoursMins(totalMins) {
    if (!totalMins || totalMins <= 0) return { days: 0, hours: 0, mins: 0 };
    const days = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    const mins = totalMins % 60;
    return { days, hours, mins };
}

function minsToHoursMinsStruct(totalMins) {
    if (!totalMins || totalMins <= 0) return { hours: 0, mins: 0 };
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return { hours, mins };
}

function setActiveAccount(index) {
    accounts.forEach((acc, idx) => {
        acc.isActive = (idx === index);
    });
    saveAccounts();
    renderGuardianAccounts();
}

function openAddAccountModal() {
    document.getElementById('modal-title-text').innerText = 'Add Google Account';
    document.getElementById('modal-account-idx').value = '-1';
    document.getElementById('modal-nickname').value = `Account ${accounts.length + 1}`;
    document.getElementById('modal-email').value = '';
    // Reset limit inputs to full/fresh defaults
    document.getElementById('modal-gemini-weekly-pct').value = '100';
    document.getElementById('modal-gemini-fivehour-pct').value = '100';
    document.getElementById('modal-gemini-weekly-refresh-hrs').value = '0';
    document.getElementById('modal-claude-weekly-pct').value = '100';
    document.getElementById('modal-claude-fivehour-pct').value = '100';
    document.getElementById('modal-claude-weekly-refresh-hrs').value = '0';
    
    document.getElementById('account-modal').style.display = 'flex';
}

function openSyncQuotaModal(index) {
    const acc = accounts[index];
    document.getElementById('modal-title-text').innerText = `Sync: ${acc.name}`;
    document.getElementById('modal-account-idx').value = index;
    document.getElementById('modal-nickname').value = acc.name;
    document.getElementById('modal-email').value = acc.email || '';
    
    // Pre-fill current limit values so the user can see and correct them
    document.getElementById('modal-gemini-weekly-pct').value = acc.gemini.weeklyPct;
    document.getElementById('modal-gemini-fivehour-pct').value = acc.gemini.fivehourPct;
    document.getElementById('modal-gemini-weekly-refresh-hrs').value = Math.round(acc.gemini.weeklyRefresh / 60);
    document.getElementById('modal-claude-weekly-pct').value = acc.claude.weeklyPct;
    document.getElementById('modal-claude-fivehour-pct').value = acc.claude.fivehourPct;
    document.getElementById('modal-claude-weekly-refresh-hrs').value = Math.round(acc.claude.weeklyRefresh / 60);
    
    document.getElementById('account-modal').style.display = 'flex';
}

function closeAccountModal() {
    document.getElementById('account-modal').style.display = 'none';
}

function saveAccountSettings() {
    const idx = parseInt(document.getElementById('modal-account-idx').value);
    const nickname = document.getElementById('modal-nickname').value.trim() || 'Unnamed Account';
    const email = document.getElementById('modal-email').value.trim();
    
    const gWeeklyPct   = Math.min(100, Math.max(0, parseFloat(document.getElementById('modal-gemini-weekly-pct').value) || 100));
    const gFivehourPct = Math.min(100, Math.max(0, parseFloat(document.getElementById('modal-gemini-fivehour-pct').value) || 100));
    const gWeeklyRefreshHrs = Math.max(0, parseFloat(document.getElementById('modal-gemini-weekly-refresh-hrs').value) || 0);
    const gWeeklyRefreshMins = Math.round(gWeeklyRefreshHrs * 60);
    
    const cWeeklyPct   = Math.min(100, Math.max(0, parseFloat(document.getElementById('modal-claude-weekly-pct').value) || 100));
    const cFivehourPct = Math.min(100, Math.max(0, parseFloat(document.getElementById('modal-claude-fivehour-pct').value) || 100));
    const cWeeklyRefreshHrs = Math.max(0, parseFloat(document.getElementById('modal-claude-weekly-refresh-hrs').value) || 0);
    const cWeeklyRefreshMins = Math.round(cWeeklyRefreshHrs * 60);
    
    if (idx === -1) {
        accounts.push({
            name: nickname,
            email: email,
            isActive: false,
            gemini: { weeklyPct: gWeeklyPct, weeklyRefresh: gWeeklyRefreshMins, fivehourPct: gFivehourPct, fivehourRefresh: 0 },
            claude: { weeklyPct: cWeeklyPct, weeklyRefresh: cWeeklyRefreshMins, fivehourPct: cFivehourPct, fivehourRefresh: 0 }
        });
    } else {
        accounts[idx].name = nickname;
        accounts[idx].email = email;
        accounts[idx].gemini.weeklyPct = gWeeklyPct;
        accounts[idx].gemini.weeklyRefresh = gWeeklyRefreshMins;
        accounts[idx].gemini.fivehourPct = gFivehourPct;
        accounts[idx].claude.weeklyPct = cWeeklyPct;
        accounts[idx].claude.weeklyRefresh = cWeeklyRefreshMins;
        accounts[idx].claude.fivehourPct = cFivehourPct;
    }
    
    saveAccounts();
    localStorage.setItem('guardian_last_tick', String(Date.now()));
    closeAccountModal();
    renderGuardianAccounts();
}

function startIdeQuotaAutoSync() {
    // Run once immediately, then every 30 seconds (refetch every 30-60s)
    syncIdeQuota();
    setInterval(syncIdeQuota, 30000);
}

async function syncIdeQuota() {
    try {
        const res = await fetch('/api/ide/quota');
        if (!res.ok) return;
        const data = await res.json();
        
        if (!data || !data.email) return;
        
        // Cache the fetched data for the [CONNECTED] banner in the Sync modal.
        // NOTE: Credits from the DB are OVERAGE credits, not rate limits.
        // We never auto-update quota meters or auto-activate accounts from this data.
        lastFetchedIdeQuota = data;
        
        // Refresh the guardian panel so the active account's [CONNECTED] indicator
        // updates without touching any account data.
        renderGuardianAccounts();
    } catch (e) {
        console.error('Error syncing Antigravity quota info:', e);
    }
}

// Prompt Linter & Optimizer
function lintPromptText() {
    const input = document.getElementById('linter-input').value.trim();
    const warningsDiv = document.getElementById('linter-warnings');
    const optBtn = document.getElementById('optimize-prompt-btn');
    
    if (!input) {
        warningsDiv.style.display = 'none';
        optBtn.disabled = true;
        return;
    }
    
    const warnings = [];
    
    // Check for dynamic parameters early in prompt
    const dynamicVars = ['{Cwd}', '{files}', '{current_time}', '{cursor_line}', '{timestamp}', '{context}'];
    
    // Analyze if variables appear in the first 50% of prompt
    const halfLen = Math.floor(input.length / 2);
    const firstHalf = input.substring(0, halfLen);
    
    const foundEarlyVars = [];
    dynamicVars.forEach(v => {
        if (firstHalf.toLowerCase().includes(v.toLowerCase())) {
            foundEarlyVars.push(v);
        }
    });
    
    if (foundEarlyVars.length > 0) {
        warnings.push(`<strong>[CACHE KILLER]</strong> Dynamic placeholders <code>${foundEarlyVars.join(', ')}</code> are placed in the first half of the prompt instruction. This breaks prefix cache matching on every single step run. Move them to the end of the prompt!`);
    }
    
    // Check if codebase references are placed after dynamic parameters
    const codeKeywords = ['codebase', 'files', 'directory', 'repository', 'functions'];
    const hasDynamicEarly = foundEarlyVars.length > 0;
    
    if (hasDynamicEarly) {
        warnings.push(`<strong>[OPTIMIZATION TIP]</strong> Place static context (e.g. codebase summaries, schemas, rules) at the top of your prompt, and dynamic parameters (e.g. current query, file paths) at the very bottom. This maximizes cached prefix length.`);
    }
    
    // Render warnings
    if (warnings.length > 0) {
        warningsDiv.style.display = 'block';
        warningsDiv.innerHTML = warnings.map(w => `<div class="warning-item" style="margin-bottom: 8px; border-left: 3px solid var(--badge-failed-text); padding-left: 8px; color: var(--text-color);">${w}</div>`).join('');
        optBtn.disabled = false;
    } else {
        warningsDiv.style.display = 'block';
        warningsDiv.innerHTML = `<div style="color: var(--badge-success-text); font-weight: bold;">[PASS] Prompt structure looks optimal for cache prefix reuse!</div>`;
        optBtn.disabled = false;
    }
    updatePromptCachingVisuals(input);
}

function optimizePromptText() {
    const input = document.getElementById('linter-input').value.trim();
    if (!input) return;
    
    const lines = input.split('\n');
    const dynamicVars = ['{Cwd}', '{files}', '{current_time}', '{cursor_line}', '{timestamp}', '{context}'];
    
    const staticLines = [];
    const dynamicLines = [];
    
    lines.forEach(line => {
        const hasVar = dynamicVars.some(v => line.toLowerCase().includes(v.toLowerCase()));
        if (hasVar) {
            dynamicLines.push(line);
        } else {
            staticLines.push(line);
        }
    });
    
    const optimized = [
        `# Static Instructions & Rules (Cached Prefix)`,
        ...staticLines,
        ``,
        `# Dynamic Variables & Workspace Context (Volatile)`,
        ...dynamicLines
    ].join('\n');
    
    const optContainer = document.getElementById('optimized-prompt-container');
    const optOutput = document.getElementById('linter-output');
    
    if (optContainer && optOutput) {
        optContainer.style.display = 'block';
        optOutput.value = optimized;
    }
    updatePromptCachingVisuals(optimized);
}

function copyOptimizedPrompt() {
    const output = document.getElementById('linter-output');
    if (output) {
        output.select();
        navigator.clipboard.writeText(output.value);
        alert('Optimized prompt copied to clipboard!');
    }
}

    

// Change folder grouping mode
function changeFolderGrouping() {
    folderGrouping = document.getElementById('folder-group-select').value;
    activeFolder = null;
    selectedExplorerConvId = null;
    renderExplorerFolders();
    renderExplorerCards();
}

// Filter and render conversations in the middle column
function renderExplorerCards() {
    const stack = document.getElementById('explorer-cards-stack');
    if (!stack) return;
    stack.innerHTML = '';
    
    if (!activeFolder) {
        stack.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.5; font-size: 0.85rem;">No folders available.</div>';
        return;
    }
    
    const groups = getFolderGroups();
    let folderConvs = groups[activeFolder] || [];
    
    // Calculate folder combined stats (before filters are applied)
    const totalCount = folderConvs.length;
    let totalTokens = 0;
    let totalDuration = 0;
    let completedCount = 0;
    folderConvs.forEach(c => {
        totalTokens += c.total_tokens || 0;
        totalDuration += c.duration_mins || 0;
        if (c.status === 'Completed') {
            completedCount++;
        }
    });
    const successRate = totalCount > 0 ? ((completedCount / totalCount) * 100).toFixed(0) : 0;
    
    // Render the folder stats summary bar
    const statsSummaryDiv = document.getElementById('folder-stats-summary');
    if (statsSummaryDiv) {
        if (totalCount > 0) {
            statsSummaryDiv.style.display = 'flex';
            statsSummaryDiv.innerHTML = `
                <span><strong>${totalCount}</strong> logs</span>
                <span><strong>${formatTokens(totalTokens)}</strong> tokens</span>
                <span><strong>${successRate}%</strong> success</span>
            `;
        } else {
            statsSummaryDiv.style.display = 'none';
        }
    }
    
    // If no conversation is selected, show empty state with folder summary details
    if (selectedExplorerConvId === null) {
        const emptyState = document.getElementById('reader-empty-state');
        const content = document.getElementById('reader-content');
        if (emptyState && content) {
            emptyState.style.display = 'flex';
            content.style.display = 'none';
            updateReaderEmptyState();
        }
    }
    
    const searchQuery = document.getElementById('explorer-search').value.toLowerCase().trim();
    const statusFilter = document.getElementById('explorer-status').value;
    const sortBy = document.getElementById('explorer-sort').value;
    
    if (searchQuery) {
        folderConvs = folderConvs.filter(c => 
            c.title.toLowerCase().includes(searchQuery) ||
            c.id.includes(searchQuery) ||
            c.date_short.includes(searchQuery)
        );
    }
    
    if (statusFilter !== 'all') {
        folderConvs = folderConvs.filter(c => c.status === statusFilter);
    }
    
    if (sortBy === 'date-desc') {
        folderConvs.sort((a, b) => b.timestamp - a.timestamp);
    } else if (sortBy === 'date-asc') {
        folderConvs.sort((a, b) => a.timestamp - b.timestamp);
    } else if (sortBy === 'tokens-desc') {
        folderConvs.sort((a, b) => b.total_tokens - a.total_tokens);
    } else if (sortBy === 'duration-desc') {
        folderConvs.sort((a, b) => b.duration_mins - a.duration_mins);
    }
    
    if (folderConvs.length === 0) {
        stack.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.5; font-size: 0.85rem;">No matching logs in this folder.</div>';
        return;
    }
    
    folderConvs.forEach(c => {
        const card = document.createElement('div');
        card.className = `conv-card ${selectedExplorerConvId === c.id ? 'active' : ''}`;
        
        const badgeClass = c.status === 'Completed' ? 'status-success' : 'status-failed';
        
        card.innerHTML = `
            <div class="conv-card-meta">
                <span>${c.date_short}</span>
                <span class="status-badge ${badgeClass}" style="font-size: 0.65rem; padding: 1px 4px;">${c.status.toLowerCase()}</span>
            </div>
            <div class="conv-card-title">${escapeHtml(c.title)}</div>
            <div class="conv-card-badges">
                <span class="card-stat-badge">${c.steps} steps</span>
                <span class="card-stat-badge">${formatTokens(c.total_tokens)}</span>
                <span class="card-stat-badge">${c.duration_mins}m</span>
            </div>
        `;
        
        card.addEventListener('click', () => {
            selectedExplorerConvId = c.id;
            document.querySelectorAll('.conv-card').forEach(cc => cc.classList.remove('active'));
            card.classList.add('active');
            openExplorerConversation(c.id);
        });
        
        stack.appendChild(card);
    });
}

function filterExplorerConversations() {
    renderExplorerCards();
}

// Render heatmap grid
function renderHeatmapGrid(elementId, heatmapData, type) {
    const grid = document.getElementById(elementId);
    if (!grid) return;
    grid.innerHTML = '';
    
    // Sort keys Day 1 to Day 25
    const keys = Object.keys(heatmapData).sort((a, b) => {
        return parseInt(a.replace('DAY ', '')) - parseInt(b.replace('DAY ', ''));
    });
    
    keys.forEach(key => {
        const dayInfo = heatmapData[key];
        const row = document.createElement('div');
        row.className = 'heatmap-row';
        
        const label = document.createElement('div');
        label.className = 'row-label';
        label.innerText = key;
        row.appendChild(label);
        
        const cellsContainer = document.createElement('div');
        cellsContainer.className = 'row-cells';
        
        dayInfo.values.forEach((hourVal, hour) => {
            const cell = document.createElement('div');
            const tier = getCellTier(hourVal);
            cell.className = `heatmap-cell heatmap-${type}-${tier}`;
            
            // Format hour string (e.g. 09:00)
            const hrStr = hour.toString().padStart(2, '0') + ':00';
            const tooltipText = `${dayInfo.date} ${hrStr} - ${hourVal.toLocaleString()} tokens`;
            cell.setAttribute('data-tooltip', tooltipText);
            
            // Filter by this date when cell is clicked
            cell.addEventListener('click', () => {
                switchTab('explorer');
                
                document.getElementById('folder-group-select').value = 'date';
                folderGrouping = 'date';
                
                const monthStr = dayInfo.date.substring(0, 7);
                activeFolder = monthStr;
                
                const searchInput = document.getElementById('explorer-search');
                if (searchInput) {
                    searchInput.value = dayInfo.date;
                }
                
                renderExplorerFolders();
                renderExplorerCards();
            });
            
            cellsContainer.appendChild(cell);
        });
        
        row.appendChild(cellsContainer);
        grid.appendChild(row);
    });
}

// Fetch conversations list
async function fetchConversations() {
    try {
        const res = await fetch('/api/conversations');
        conversations = await res.json();
        
        // Render project summaries on overview tab
        renderProjectAnalytics();
        
        if (activeTab === 'explorer') {
            renderExplorerFolders();
            renderExplorerCards();
        } else if (activeTab === 'guardian') {
            renderWeeklyActivitySummary();
        }
    } catch (err) {
        console.error('Error fetching conversations:', err);
    }
}

let activeConvSteps = [];
let activeConvId = null;

// Open conversation in Logs Explorer Reader
async function openExplorerConversation(id, forceShowAll = false) {
    activeConvId = id;
    const emptyState = document.getElementById('reader-empty-state');
    const content = document.getElementById('reader-content');
    const timelineLogs = document.getElementById('reader-timeline-logs');
    if (!emptyState || !content) return;
    
    // Clear previous timeline logs early and show a loading placeholder
    if (timelineLogs) {
        timelineLogs.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.5;">Loading steps...</div>';
    }
    
    try {
        const res = await fetch(`/api/conversations/${id}`);
        if (!res.ok) {
            throw new Error(`Server returned status ${res.status}`);
        }
        const data = await res.json();
        
        if (!data || data.error || !data.steps) {
            throw new Error(data && data.error ? data.error : "Failed to load steps data.");
        }
        
        activeConvSteps = data.steps;
        const meta = conversations.find(c => c.id === id);
        
        // Hide empty state, show reader contents
        emptyState.style.display = 'none';
        content.style.display = 'block';
        
        // Title and Status
        document.getElementById('reader-goal-title').innerText = meta ? meta.title : 'Untitled Task';
        const statusBadge = document.getElementById('reader-status-badge');
        const statusText = meta ? String(meta.status).toLowerCase() : 'unknown';
        statusBadge.innerText = statusText;
        statusBadge.className = `status-badge ${meta && meta.status === 'Completed' ? 'status-success' : 'status-failed'}`;
        
        // Meta details cards
        document.getElementById('reader-val-date').innerText = meta ? meta.date : '-';
        document.getElementById('reader-val-active').innerText = meta ? `${meta.duration_mins}m (Elapsed: ${meta.elapsed_duration_mins}m)` : '-';
        document.getElementById('reader-val-tokens').innerText = meta ? `${formatTokens(meta.total_tokens)} (In: ${formatTokens(meta.input_tokens)} / Out: ${formatTokens(meta.output_tokens)})` : '-';
        document.getElementById('reader-val-steps').innerText = data.steps.length;
        
        // Subagent Hierarchy Tree
        const treeSection = document.getElementById('reader-subagent-section');
        const treeCanvas = document.getElementById('reader-tree-canvas');
        treeCanvas.innerHTML = '';
        
        if (data.subagents && data.subagents.length > 0) {
            treeSection.style.display = 'block';
            
            // Parent root node
            const rootNode = document.createElement('div');
            rootNode.className = 'tree-node';
            rootNode.innerHTML = `<span style="font-weight: bold; color: var(--orange-5);">[Parent Agent]</span> ID: ${id.slice(0, 8)}...`;
            treeCanvas.appendChild(rootNode);
            
            // Subagents children
            data.subagents.forEach(subId => {
                if (subId) {
                    const subNode = document.createElement('div');
                    subNode.className = 'tree-node';
                    subNode.style.paddingLeft = '20px';
                    subNode.innerHTML = `
                        <div class="tree-node-line"></div>
                        <span style="font-weight: bold; color: var(--blue-5);">[Subagent]</span> ID: ${subId.slice(0, 8)}... 
                        <button class="retro-select" style="padding: 2px 6px; font-size: 0.75rem; margin-left: 10px;" onclick="openExplorerConversation('${subId}')">view</button>
                    `;
                    treeCanvas.appendChild(subNode);
                }
            });
        } else {
            treeSection.style.display = 'none';
        }
        
        // Render diagnostics & timeline logs
        renderConversationDiagnostics(activeConvSteps);
        renderTimelineSteps(forceShowAll);
        autoSelectSkillsForActiveConv();
        
    } catch (err) {
        console.error('Error loading task details:', err);
        // Hide empty state and show content so the error is visible
        emptyState.style.display = 'none';
        content.style.display = 'block';
        
        // Reset meta values
        document.getElementById('reader-goal-title').innerText = 'Failed to Load Conversation';
        const statusBadge = document.getElementById('reader-status-badge');
        statusBadge.innerText = 'error';
        statusBadge.className = 'status-badge status-failed';
        document.getElementById('reader-val-date').innerText = '-';
        document.getElementById('reader-val-active').innerText = '-';
        document.getElementById('reader-val-tokens').innerText = '-';
        document.getElementById('reader-val-steps').innerText = '-';
        
        document.getElementById('reader-subagent-section').style.display = 'none';
        
        if (timelineLogs) {
            timelineLogs.innerHTML = `
                <div style="padding: 30px; text-align: center; color: var(--badge-failed-text); font-weight: 500;">
                    <svg class="empty-icon" style="stroke: var(--badge-failed-text); width: 36px; height: 36px; margin-bottom: 10px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <div>Failed to load timeline steps.</div>
                    <div style="font-family: monospace; font-size: 0.75rem; opacity: 0.8; margin-top: 5px;">${escapeHtml(err.message)}</div>
                </div>
            `;
        }
    }
}

// Sub-render method with pagination/truncation to prevent browser freezes
function renderTimelineSteps(forceShowAll = false) {
    const timelineLogs = document.getElementById('reader-timeline-logs');
    if (!timelineLogs) return;
    timelineLogs.innerHTML = '';
    
    const steps = activeConvSteps;
    if (steps.length === 0) {
        timelineLogs.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.5;">No steps recorded in this log.</div>';
        return;
    }
    
    const limit = 80;
    const border = 30; // first 30 and last 30
    
    let isTruncated = false;
    if (steps.length > limit && !forceShowAll) {
        isTruncated = true;
    }
    
    if (!isTruncated) {
        steps.forEach(step => appendStepCard(step, timelineLogs));
    } else {
        // Render first N steps
        for (let i = 0; i < border; i++) {
            appendStepCard(steps[i], timelineLogs);
        }
        
        // Render divider
        const div = document.createElement('div');
        div.className = 'steps-hidden-divider';
        div.innerHTML = `
            <div class="dashed-divider" style="margin: 10px 0; width: 100%;"></div>
            <div class="hidden-info-box">
                <span>[ ... ${steps.length - border * 2} steps hidden to optimize performance ... ]</span>
                <button class="retro-select" onclick="renderTimelineSteps(true)" style="padding: 4px 8px; font-size: 0.75rem;">Load All ${steps.length} Steps</button>
            </div>
            <div class="dashed-divider" style="margin: 10px 0; width: 100%;"></div>
        `;
        timelineLogs.appendChild(div);
        
        // Render last N steps
        for (let i = steps.length - border; i < steps.length; i++) {
            appendStepCard(steps[i], timelineLogs);
        }
    }
}

// Appends a single step card safely
function appendStepCard(step, container) {
    try {
        const stepCard = document.createElement('div');
        stepCard.className = 'step-card';
        
        const header = document.createElement('div');
        header.className = 'step-header';
        
        const badgeClass = step.status === 'ERROR' ? 'status-failed' : '';
        const statusVal = step.status ? String(step.status).toLowerCase() : '';
        const statusLabel = statusVal ? `<span class="status-badge ${badgeClass}" style="margin-left: 10px;">${statusVal}</span>` : '';
        const sourceText = step.source ? String(step.source) : 'UNKNOWN';
        const typeText = step.type ? String(step.type) : 'STEP';
        const indexVal = step.step_index !== undefined ? step.step_index : '?';
        const tokensVal = step.tokens !== undefined ? step.tokens : 0;
        
        header.innerHTML = `
            <div>
                <span class="step-source">[${sourceText}]</span> 
                <span class="step-type">${typeText}</span>
                ${statusLabel}
            </div>
            <div>Step ${indexVal} | Est. ${formatTokens(tokensVal)} tokens</div>
        `;
        stepCard.appendChild(header);
        
        const body = document.createElement('div');
        body.className = 'step-body';
        
        if (step.thinking) {
            const thinkingDiv = document.createElement('div');
            thinkingDiv.className = 'step-thinking';
            thinkingDiv.innerText = `Thinking: ${step.thinking}`;
            body.appendChild(thinkingDiv);
        }
        
        if (step.content) {
            const contentDiv = document.createElement('div');
            contentDiv.className = 'step-content';
            
            let escaped = escapeHtml(step.content);
            escaped = escaped.replace(/&lt;USER_REQUEST&gt;([\s\S]*?)&lt;\/USER_REQUEST&gt;/g, 
                `<div style="border: 1px dashed var(--border-color); padding: 10px; margin: 10px 0; background-color: rgba(0,0,0,0.01);"><strong>&lt;USER_REQUEST&gt;</strong><br>$1<br><strong>&lt;/USER_REQUEST&gt;</strong></div>`);
            
            contentDiv.innerHTML = escaped;
            body.appendChild(contentDiv);
        }
        
        if (step.tool_calls && step.tool_calls.length > 0) {
            const toolDiv = document.createElement('div');
            toolDiv.className = 'step-tool-calls';
            toolDiv.innerHTML = `<strong>Tool Invocations:</strong><pre style="margin-top: 5px; font-family: inherit; font-size: 0.8rem; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(step.tool_calls, null, 2)}</pre>`;
            body.appendChild(toolDiv);
        }
        
        stepCard.appendChild(body);
        container.appendChild(stepCard);
    } catch (stepErr) {
        console.error('Error rendering step:', step, stepErr);
        const errorCard = document.createElement('div');
        errorCard.className = 'step-card';
        errorCard.style.borderColor = 'var(--badge-failed-text)';
        errorCard.innerHTML = `
            <div class="step-header" style="background-color: var(--badge-failed-bg); color: var(--badge-failed-text);">
                Error rendering step ${step && step.step_index !== undefined ? step.step_index : 'unknown'}
            </div>
            <div class="step-body" style="font-family: monospace; font-size: 0.75rem; color: var(--badge-failed-text);">
                ${escapeHtml(stepErr.stack || stepErr.message)}
            </div>
        `;
        container.appendChild(errorCard);
    }
}

// Utility to escape HTML strings
function escapeHtml(text) {
    if (text === undefined || text === null) return '';
    const str = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Theme Toggle
function toggleTheme() {
    const body = document.body;
    if (body.classList.contains('dark-theme')) {
        body.classList.remove('dark-theme');
        localStorage.setItem('theme', 'light');
    } else {
        body.classList.add('dark-theme');
        localStorage.setItem('theme', 'dark');
    }
    updateThemeButton();
}

function updateThemeButton() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const isDark = document.body.classList.contains('dark-theme');
    btn.innerHTML = isDark ? 'light mode' : 'dark mode';
}

// On-demand manual sync
async function manualRefresh(event) {
    const btn = event?.target;
    const originalText = btn ? btn.innerText : 'refresh';
    if (btn) {
        btn.innerText = 'syncing...';
        btn.disabled = true;
    }
    
    try {
        await Promise.all([fetchStats(), fetchConversations()]);
        if (btn) btn.innerText = 'done';
    } catch (err) {
        if (btn) btn.innerText = 'error';
        console.error('Manual refresh failed:', err);
    }
    
    setTimeout(() => {
        if (btn) {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    }, 1200);
}

// SVG Trend Chart Renderer
function renderTrendChart(history) {
    const svg = document.getElementById('token-trend-svg');
    svg.innerHTML = '';
    
    if (history.length === 0) return;
    
    const width = 800;
    const height = 150;
    const margin = { top: 15, right: 20, bottom: 25, left: 60 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    
    // Scale calculations
    const maxVal = Math.max(...history.map(d => d.tokens), 1000000); // minimum scale limit
    const scaleY = chartHeight / maxVal;
    const stepX = chartWidth / (history.length - 1 || 1);
    
    // Build coordinates
    const pts = history.map((d, i) => ({
        x: margin.left + i * stepX,
        y: margin.top + chartHeight - (d.tokens * scaleY),
        tokens: d.tokens,
        date: d.date
    }));
    
    // Generate Grid Lines
    let gridHtml = '';
    for (let pct of [0, 0.5, 1]) {
        const y = margin.top + chartHeight - (pct * chartHeight);
        const valLabel = formatTokens(pct * maxVal);
        gridHtml += `
            <line class="chart-grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"></line>
            <text x="${margin.left - 8}" y="${y + 4}" font-size="9" text-anchor="end" fill="var(--text-color)" opacity="0.6" font-family="inherit">${valLabel}</text>
        `;
    }
    
    // Axis Lines
    const axisHtml = `
        <line class="chart-axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}"></line>
        <line class="chart-axis-line" x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}"></line>
    `;
    
    // Date Labels (X-Axis)
    let datesHtml = '';
    const labelIndices = [0, Math.floor(history.length / 2), history.length - 1];
    labelIndices.forEach(idx => {
        if (idx >= 0 && idx < history.length) {
            const p = pts[idx];
            const dateStr = p.date.split('-').slice(1).join('/'); // MM/DD
            datesHtml += `<text x="${p.x}" y="${height - 8}" font-size="9" text-anchor="middle" fill="var(--text-color)" opacity="0.6" font-family="inherit">${dateStr}</text>`;
        }
    });
    
    // Line and Fill Paths
    const pathD = 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ');
    const fillD = pathD + ` L ${pts[pts.length - 1].x} ${margin.top + chartHeight} L ${pts[0].x} ${margin.top + chartHeight} Z`;
    
    const chartLineHtml = `<path class="chart-plot-line" d="${pathD}"></path>`;
    const chartFillHtml = `<path class="chart-plot-fill" d="${fillD}"></path>`;
    
    // Interaction Points
    let pointsHtml = '';
    pts.forEach(p => {
        pointsHtml += `
            <circle class="chart-point" cx="${p.x}" cy="${p.y}" r="3.5"
                onmouseover="showChartTooltip(event, '${p.date}', ${p.tokens})"
                onmouseout="hideChartTooltip()"
            />
        `;
    });
    
    svg.innerHTML = gridHtml + axisHtml + datesHtml + chartFillHtml + chartLineHtml + pointsHtml;
}

// Tool Analytics Renderer
function renderToolAnalytics(topTools) {
    const container = document.getElementById('tools-analytics-grid');
    container.innerHTML = '';
    
    if (topTools.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; opacity: 0.6; padding: 20px;">No tool metrics available.</div>';
        return;
    }
    
    topTools.forEach(tool => {
        const card = document.createElement('div');
        card.className = 'tool-card';
        
        let rateClass = 'sr-high';
        if (tool.success_rate < 80) {
            rateClass = 'sr-medium';
        }
        if (tool.success_rate < 50) {
            rateClass = 'sr-low';
        }
        
        card.innerHTML = `
            <div class="tool-card-header">
                <span style="font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tool.name}</span>
                <span class="tool-card-calls">${tool.calls} calls</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; opacity: 0.8; margin-top: 4px;">
                <span>Success Rate</span>
                <span>${tool.success_rate}%</span>
            </div>
            <div class="tool-progress-bar-container" style="margin-top: 5px;">
                <div class="tool-progress-bar ${rateClass}" style="width: ${tool.success_rate}%;"></div>
            </div>
        `;
        container.appendChild(card);
    });
}

// Tooltip helpers
function showChartTooltip(event, date, tokens) {
    const tooltip = document.getElementById('chart-tooltip');
    tooltip.innerText = `${date}: ${tokens.toLocaleString()} tokens`;
    tooltip.style.display = 'block';
    
    const wrapper = event.target.closest('.chart-wrapper');
    const rect = wrapper.getBoundingClientRect();
    const x = event.clientX - rect.left + 12;
    const y = event.clientY - rect.top - 28;
    
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
}

function hideChartTooltip() {
    const tooltip = document.getElementById('chart-tooltip');
    tooltip.style.display = 'none';
}

function deductTokensFromActiveAccount(tokens, poolType) {
    const activeIdx = accounts.findIndex(acc => acc.isActive);
    if (activeIdx === -1) return;
    
    const acc = accounts[activeIdx];
    const pool = poolType === 'claude' ? acc.claude : acc.gemini;
    
    // Weekly Limit: remaining percentage decreases
    const weeklyCapacity = 5000000; // 5M tokens baseline
    const weeklyPctDiff = (tokens / weeklyCapacity) * 100;
    pool.weeklyPct = Math.max(0, parseFloat((pool.weeklyPct - weeklyPctDiff).toFixed(2)));
    
    // 5-Hour Limit: left percentage decreases (Left % model)
    const fiveHourCapacity = 500000; // 500K tokens baseline
    const fiveHourPctDiff = (tokens / fiveHourCapacity) * 100;
    pool.fivehourPct = Math.max(0, parseFloat((pool.fivehourPct - fiveHourPctDiff).toFixed(2)));
    
    // Auto-initialize countdown when limits decrease
    if (pool.fivehourPct < 100 && pool.fivehourRefresh <= 0) {
        pool.fivehourRefresh = 300; // 5 hours in minutes
    }
    
    saveAccounts();
    localStorage.setItem('guardian_last_tick', String(Date.now()));
    renderGuardianAccounts();
}

// Fetch stats summary and update the Overview charts & indicators
async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        statsData = await res.json();
        
        // Update stats cards
        document.getElementById('stat-completed-runs').innerText = statsData.completed_runs || 0;
        document.getElementById('stat-crashed-runs').innerText = statsData.crashed_runs || 0;
        document.getElementById('stat-total-tokens').innerText = formatTokens(statsData.total_tokens);
        document.getElementById('stat-output-tokens').innerText = formatTokens(statsData.output_tokens);
        document.getElementById('stat-peak-day').innerText = formatTokens(statsData.peak_day_tokens);
        
        // Dynamic token deduction from active account using localStorage
        const newGeminiTokens = statsData.gemini_total_tokens || 0;
        const storedLastGeminiStr = localStorage.getItem('guardian_last_gemini_tokens');
        if (storedLastGeminiStr !== null) {
            const storedLastGemini = parseInt(storedLastGeminiStr) || 0;
            if (newGeminiTokens > storedLastGemini) {
                deductTokensFromActiveAccount(newGeminiTokens - storedLastGemini, 'gemini');
            }
        }
        localStorage.setItem('guardian_last_gemini_tokens', String(newGeminiTokens));
        
        const newClaudeTokens = statsData.claude_total_tokens || 0;
        const storedLastClaudeStr = localStorage.getItem('guardian_last_claude_tokens');
        if (storedLastClaudeStr !== null) {
            const storedLastClaude = parseInt(storedLastClaudeStr) || 0;
            if (newClaudeTokens > storedLastClaude) {
                deductTokensFromActiveAccount(newClaudeTokens - storedLastClaude, 'claude');
            }
        }
        localStorage.setItem('guardian_last_claude_tokens', String(newClaudeTokens));
        
        localStorage.setItem('guardian_last_total_tokens', String(statsData.total_tokens || 0));
        
        // Update peak day label
        const peakLabel = document.querySelector('#stat-peak-day').nextElementSibling;
        if (peakLabel) {
            peakLabel.innerText = `peak day (${statsData.peak_day_date})`;
        }
        
        document.getElementById('stat-streak').innerText = `${statsData.streak}d`;
        document.getElementById('stat-avg-session').innerText = `${statsData.avg_session_mins}m`;
        document.getElementById('stat-recent-30d').innerText = formatTokens(statsData.recent_30d_tokens);
        
        // Calculate totals for heatmaps
        let totalOrange = 0;
        Object.values(statsData.heatmap_orange).forEach(day => {
            totalOrange += day.values.reduce((sum, val) => sum + val, 0);
        });
        document.getElementById('orange-total').innerText = `${formatTokens(totalOrange)} total`;
        
        let totalBlue = 0;
        Object.values(statsData.heatmap_blue).forEach(day => {
            totalBlue += day.values.reduce((sum, val) => sum + val, 0);
        });
        document.getElementById('blue-total').innerText = `${formatTokens(totalBlue)} total`;
        
        // Render Heatmaps
        renderHeatmapGrid('heatmap-orange-grid', statsData.heatmap_orange, 'orange');
        renderHeatmapGrid('heatmap-blue-grid', statsData.heatmap_blue, 'blue');
        
        // Render Trend Chart
        renderTrendChart(statsData.trend_history);
        
        // Render Tool Success rates
        renderToolAnalytics(statsData.top_tools);
    } catch (err) {
        console.error('Error fetching stats:', err);
    }
}

// Format token numbers into compact strings (e.g. 1.2M, 45K, or 19.0B)
function formatTokens(num) {
    const val = Number(num);
    if (num === undefined || num === null || isNaN(val)) return '0';
    if (val >= 1000000000) {
        return (val / 1000000000).toFixed(1) + 'B';
    }
    if (val >= 1000000) {
        return (val / 1000000).toFixed(1) + 'M';
    }
    if (val >= 1000) {
        return (val / 1000).toFixed(1) + 'K';
    }
    return val.toLocaleString();
}

// Classify token counts into contribution heatmap tiers (0 to 5)
function getCellTier(num) {
    if (!num || num === 0) return 0;
    if (num <= 5000) return 1;
    if (num <= 20000) return 2;
    if (num <= 75000) return 3;
    if (num <= 250000) return 4;
    return 5;
}

// Bind click event listeners for metrics cards in Bento layout to filter/route to Logs Explorer
function initMetricCardsClickListeners() {
    const bindClick = (id, handler) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', handler);
        }
    };

    bindClick('card-completed-runs', () => {
        switchTab('explorer');
        const statusSel = document.getElementById('explorer-status');
        if (statusSel) {
            statusSel.value = 'Completed';
        }
        filterExplorerConversations();
    });

    bindClick('card-crashed-runs', () => {
        switchTab('explorer');
        const statusSel = document.getElementById('explorer-status');
        if (statusSel) {
            statusSel.value = 'Crashed';
        }
        filterExplorerConversations();
    });

    bindClick('card-total-tokens', () => {
        switchTab('explorer');
        const sortSel = document.getElementById('explorer-sort');
        if (sortSel) {
            sortSel.value = 'tokens-desc';
        }
        filterExplorerConversations();
    });

    bindClick('card-output-tokens', () => {
        switchTab('explorer');
        const sortSel = document.getElementById('explorer-sort');
        if (sortSel) {
            sortSel.value = 'tokens-desc';
        }
        filterExplorerConversations();
    });

    bindClick('card-avg-session', () => {
        switchTab('explorer');
        const sortSel = document.getElementById('explorer-sort');
        if (sortSel) {
            sortSel.value = 'duration-desc';
        }
        filterExplorerConversations();
    });

    bindClick('card-recent-30d', () => {
        switchTab('explorer');
        const sortSel = document.getElementById('explorer-sort');
        if (sortSel) {
            sortSel.value = 'date-desc';
        }
        filterExplorerConversations();
    });

    bindClick('card-peak-day', () => {
        if (!statsData || !statsData.peak_day_date || statsData.peak_day_date === 'N/A') return;
        switchTab('explorer');
        
        // Switch folder grouping to date
        const groupSel = document.getElementById('folder-group-select');
        if (groupSel) {
            groupSel.value = 'date';
            folderGrouping = 'date';
        }
        
        // Month string is YYYY-MM
        const monthStr = statsData.peak_day_date.substring(0, 7);
        activeFolder = monthStr;
        
        // Set search text to specific date
        const searchInput = document.getElementById('explorer-search');
        if (searchInput) {
            searchInput.value = statsData.peak_day_date;
        }
        
        renderExplorerFolders();
        renderExplorerCards();
    });
}

// Aggregate combined metrics by project category
function getProjectStats() {
    const projectStats = {};
    conversations.forEach(c => {
        const proj = c.project || "General";
        if (!projectStats[proj]) {
            projectStats[proj] = {
                name: proj,
                runs: 0,
                tokens: 0,
                totalDuration: 0,
                completed: 0,
                crashed: 0
            };
        }
        projectStats[proj].runs += 1;
        projectStats[proj].tokens += c.total_tokens || 0;
        projectStats[proj].totalDuration += c.duration_mins || 0;
        if (c.status === 'Completed') {
            projectStats[proj].completed += 1;
        } else {
            projectStats[proj].crashed += 1;
        }
    });
    
    // Calculate averages and success rates
    Object.values(projectStats).forEach(p => {
        p.avgDuration = p.runs > 0 ? (p.totalDuration / p.runs).toFixed(1) : 0;
        p.successRate = p.runs > 0 ? ((p.completed / p.runs) * 100).toFixed(1) : 0;
    });
    
    return projectStats;
}

// Render bento-style clickable project stats cards in the Overview pane
function renderProjectAnalytics() {
    const container = document.getElementById('project-analytics-grid');
    if (!container) return;
    container.innerHTML = '';
    
    const projectStats = getProjectStats();
    
    // Sort projects alphabetically (except General at the end)
    const projectNames = Object.keys(projectStats).sort((a, b) => {
        if (a === 'General') return 1;
        if (b === 'General') return -1;
        return a.localeCompare(b);
    });
    
    projectNames.forEach(name => {
        const p = projectStats[name];
        const card = document.createElement('div');
        card.className = 'project-card';
        
        let rateColor = 'var(--badge-success-text)';
        if (p.successRate < 80) rateColor = 'var(--orange-4)';
        if (p.successRate < 50) rateColor = 'var(--badge-failed-text)';
        
        card.innerHTML = `
            <div class="project-card-header">
                <span class="project-card-name">${name}</span>
                <span class="project-card-badge">${p.runs} runs</span>
            </div>
            <div class="project-card-body">
                <div class="project-stat-row">
                    <span>Est. Tokens</span>
                    <strong>${formatTokens(p.tokens)}</strong>
                </div>
                <div class="project-stat-row">
                    <span>Avg Duration</span>
                    <strong>${p.avgDuration}m</strong>
                </div>
                <div class="project-stat-row">
                    <span>Success Rate</span>
                    <strong style="color: ${rateColor};">${p.successRate}%</strong>
                </div>
            </div>
        `;
        
        card.addEventListener('click', () => {
            goToProjectFolder(name);
        });
        
        container.appendChild(card);
    });
}

// Navigate to the explorer tab and filter by selected project folder
function goToProjectFolder(projectName) {
    switchTab('explorer');
    
    // Set folder grouping to project
    const groupSel = document.getElementById('folder-group-select');
    if (groupSel) {
        groupSel.value = 'project';
        folderGrouping = 'project';
    }
    
    // Clear search and status filter when jumping from overview
    const searchInput = document.getElementById('explorer-search');
    if (searchInput) {
        searchInput.value = '';
    }
    
    const statusSel = document.getElementById('explorer-status');
    if (statusSel) {
        statusSel.value = 'all';
    }
    
    activeFolder = projectName;
    selectedExplorerConvId = null;
    
    renderExplorerFolders();
    renderExplorerCards();
}

// Render dynamic folder summary in the empty state pane of Column 3
function updateReaderEmptyState() {
    const emptyState = document.getElementById('reader-empty-state');
    if (!emptyState) return;
    
    if (!activeFolder) {
        emptyState.innerHTML = `
            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <circle cx="10" cy="9" r="1"/>
            </svg>
            <h3 style="font-family: 'Fira Code', monospace; text-transform: uppercase; font-size: 1rem; margin-top: 10px;">select conversation</h3>
            <p style="font-size: 0.8rem; max-width: 280px; margin-top: 5px;">Click on any folder and select a log to display its active timeline and tool events side-by-side.</p>
        `;
        return;
    }
    
    const groups = getFolderGroups();
    const folderConvs = groups[activeFolder] || [];
    
    const totalCount = folderConvs.length;
    let totalTokens = 0;
    let totalDuration = 0;
    let completedCount = 0;
    folderConvs.forEach(c => {
        totalTokens += c.total_tokens || 0;
        totalDuration += c.duration_mins || 0;
        if (c.status === 'Completed') {
            completedCount++;
        }
    });
    
    const crashedCount = totalCount - completedCount;
    const successRate = totalCount > 0 ? ((completedCount / totalCount) * 100).toFixed(0) : 0;
    const avgDuration = totalCount > 0 ? (totalDuration / totalCount).toFixed(1) : 0;
    
    const completedPct = totalCount > 0 ? (completedCount / totalCount * 100).toFixed(0) : 0;
    const crashedPct = totalCount > 0 ? (100 - completedPct) : 0;
    
    let successColor = 'var(--badge-success-text)';
    if (successRate < 80) successColor = 'var(--orange-4)';
    if (successRate < 50) successColor = 'var(--badge-failed-text)';
    
    emptyState.innerHTML = `
        <div class="folder-bento-grid">
            <!-- Header Card -->
            <div class="bento-card bento-header">
                <span class="bento-label">Folder Analytics</span>
                <h2>${activeFolder}</h2>
            </div>
            
            <!-- Success Rate Card -->
            <div class="bento-card bento-success">
                <span class="bento-label">Success Rate</span>
                <div class="bento-value-large" style="color: ${successColor};">${successRate}%</div>
                <div class="bento-progress-track">
                    <div class="bento-progress-fill" style="width: ${successRate}%; background-color: ${successColor};"></div>
                </div>
            </div>
            
            <!-- Total Runs Card -->
            <div class="bento-card">
                <span class="bento-label">Total Runs</span>
                <div class="bento-value-med">${totalCount}</div>
                <span class="bento-subtext">conversations</span>
            </div>
            
            <!-- Combined Volume Card -->
            <div class="bento-card">
                <span class="bento-label">Combined Volume</span>
                <div class="bento-value-med">${formatTokens(totalTokens)}</div>
                <span class="bento-subtext">tokens</span>
            </div>
            
            <!-- Avg Duration Card -->
            <div class="bento-card">
                <span class="bento-label">Avg Duration</span>
                <div class="bento-value-med">${avgDuration}m</div>
                <span class="bento-subtext">per session</span>
            </div>
            
            <!-- Runs Distribution Card -->
            <div class="bento-card bento-split">
                <span class="bento-label">Runs Distribution</span>
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 600; margin-top: 4px;">
                    <span style="color: var(--badge-success-text);">${completedCount} completed</span>
                    <span style="color: var(--badge-failed-text);">${crashedCount} crashed</span>
                </div>
                <div class="bento-split-bar-track">
                    <div class="bento-split-bar-fill success" style="width: ${completedPct}%;"></div>
                    <div class="bento-split-bar-fill crashed" style="width: ${crashedPct}%;"></div>
                </div>
            </div>
            
            <p style="grid-column: span 2; font-size: 0.75rem; text-align: center; margin-top: 15px; opacity: 0.6; font-family: 'Fira Sans', sans-serif;">
                Select a conversation card from the list to display its timeline logs.
            </p>
        </div>
    `;
}

// =============================================================
// Workspace Codebase Token Weight Map (Option 2)
// =============================================================
async function loadWorkspaceFiles() {
    const listEl = document.getElementById('workspace-files-list');
    if (!listEl) return;
    
    try {
        const res = await fetch('/api/workspace/files');
        const files = await res.json();
        
        listEl.innerHTML = '';
        if (files.length === 0) {
            listEl.innerHTML = '<span style="opacity: 0.5; font-size: 0.8rem;">No files found in workspace.</span>';
            return;
        }
        
        files.forEach(file => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.flexDirection = 'column';
            div.style.gap = '6px';
            div.style.padding = '8px 10px';
            div.style.border = '1px solid var(--border-color)';
            div.style.borderRadius = '6px';
            div.style.backgroundColor = 'var(--card-bg)';
            
            const fileLink = `file:///d:/antigravity-dashboard/${file.path}`;
            const pathSpan = `<a href="${fileLink}" target="_blank" style="color: var(--text-color); text-decoration: none; font-weight: 600; font-family: 'Fira Code', monospace; font-size: 0.72rem; word-break: break-word; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 75%;" title="${file.path}">${file.path}</a>`;
            
            let badge = '';
            if (file.tokens > 20000) {
                badge = `<span style="background-color: rgba(244, 67, 54, 0.15); color: var(--badge-failed-text); border: 1px solid var(--badge-failed-text); border-radius: 4px; padding: 1px 4px; font-size: 0.6rem; font-weight: bold; text-transform: uppercase; display: inline-block;">Cache Risk</span>`;
            } else if (file.tokens > 8000) {
                badge = `<span style="background-color: rgba(255, 152, 0, 0.15); color: var(--orange-4); border: 1px solid var(--orange-4); border-radius: 4px; padding: 1px 4px; font-size: 0.6rem; font-weight: bold; text-transform: uppercase; display: inline-block;">Medium</span>`;
            } else {
                badge = `<span style="background-color: rgba(76, 175, 80, 0.15); color: var(--badge-success-text); border: 1px solid var(--badge-success-text); border-radius: 4px; padding: 1px 4px; font-size: 0.6rem; font-weight: bold; text-transform: uppercase; display: inline-block;">Safe</span>`;
            }
            
            function fmtNum(n) {
                if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
                return n.toString();
            }
            
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; gap: 8px; width: 100%;">
                    ${pathSpan}
                    <span style="font-family: 'Fira Code', monospace; font-weight: 600; font-size: 0.75rem; color: var(--chart-line); white-space: nowrap;">
                        ${fmtNum(file.tokens)} <span style="font-size:0.65rem; font-weight:400; opacity:0.6; color: var(--text-color);">tokens</span>
                    </span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; width: 100%;">
                    ${badge}
                    <span style="font-size: 0.68rem; opacity: 0.5; font-family: 'Fira Code', monospace;">${(file.size_bytes / 1024).toFixed(1)} KB</span>
                </div>
            `;
            listEl.appendChild(div);
        });
    } catch (err) {
        listEl.innerHTML = `<span style="color: var(--badge-failed-text); font-size: 0.8rem;">Failed to load files: ${err.message}</span>`;
    }
}

// =============================================================
// TokenHUD V2 Rules Loader/Saver & Cache Visualizer
// =============================================================
let rulesFiles = [];
let activeRulesPath = null;

async function fetchRulesFiles() {
    const selectEl = document.getElementById('rules-file-select');
    const skillsContainer = document.getElementById('skills-checklist-container');
    if (!selectEl) return;
    
    try {
        const res = await fetch('/api/rules');
        rulesFiles = await res.json();
        
        selectEl.innerHTML = '<option value="">[paste prompt manually]</option>';
        if (skillsContainer) skillsContainer.innerHTML = '';
        
        let hasSkills = false;
        
        rulesFiles.forEach(file => {
            if (file.skill_handle === undefined) {
                const opt = document.createElement('option');
                opt.value = file.path;
                opt.textContent = `${file.name} ${file.exists ? '' : ' (new)'}`;
                selectEl.appendChild(opt);
            } else {
                hasSkills = true;
                if (skillsContainer) {
                    const label = document.createElement('label');
                    label.style.display = 'flex';
                    label.style.alignItems = 'start';
                    label.style.gap = '6px';
                    label.style.cursor = 'pointer';
                    label.style.fontSize = '0.72rem';
                    label.style.margin = '2px 0';
                    label.title = file.description || '';
                    
                    label.innerHTML = `
                        <input type="checkbox" value="${file.skill_handle}" data-desc="${file.description || ''}" onchange="compilePromptBuilder(); sortSkillsList();" style="margin-top: 2px;">
                        <span>
                            <strong style="color:var(--chart-line);">@${file.skill_handle}</strong>: 
                            <span style="opacity:0.8;">${file.description || 'Custom guidelines.'}</span>
                        </span>
                    `;
                    skillsContainer.appendChild(label);
                }
            }
        });
        
        if (!hasSkills && skillsContainer) {
            skillsContainer.innerHTML = '<span style="font-size: 0.72rem; opacity: 0.5;">No active skills found.</span>';
        } else {
            sortSkillsList();
            filterSkillsList();
            if (activeConvSteps && activeConvSteps.length > 0) {
                autoSelectSkillsForActiveConv();
            }
        }
    } catch (err) {
        console.error('Error fetching rules files:', err);
    }
}

function filterSkillsList() {
    const input = document.getElementById('skills-search-input');
    const query = input ? input.value.toLowerCase().trim() : '';
    
    const container = document.getElementById('skills-checklist-container');
    if (!container) return;
    
    const labels = Array.from(container.children);
    labels.forEach(label => {
        const inputEl = label.querySelector('input');
        if (!inputEl) return;
        
        const handle = inputEl.value.toLowerCase();
        const desc = (inputEl.getAttribute('data-desc') || '').toLowerCase();
        
        if (query === '' || handle.includes(query) || desc.includes(query)) {
            label.style.display = 'flex';
        } else {
            label.style.display = 'none';
        }
    });
}

function sortSkillsList() {
    const container = document.getElementById('skills-checklist-container');
    if (!container) return;
    
    const labels = Array.from(container.children);
    const checkedLabels = [];
    const uncheckedLabels = [];
    const nonChecklistItems = [];
    
    labels.forEach(label => {
        const inputEl = label.querySelector('input');
        if (!inputEl) {
            nonChecklistItems.push(label);
            return;
        }
        if (inputEl.checked) {
            checkedLabels.push(label);
        } else {
            uncheckedLabels.push(label);
        }
    });
    
    const sortByHandle = (a, b) => {
        const aVal = a.querySelector('input').value.toLowerCase();
        const bVal = b.querySelector('input').value.toLowerCase();
        return aVal.localeCompare(bVal);
    };
    
    checkedLabels.sort(sortByHandle);
    uncheckedLabels.sort(sortByHandle);
    
    container.innerHTML = '';
    checkedLabels.forEach(el => container.appendChild(el));
    uncheckedLabels.forEach(el => container.appendChild(el));
    nonChecklistItems.forEach(el => container.appendChild(el));
}

function autoSelectSkillsForActiveConv() {
    if (!activeConvSteps || activeConvSteps.length === 0) return;
    
    // 1. Gather text content ONLY from user inputs, model planning/thinking, and tool arguments (not stdout/outputs)
    let combinedText = '';
    activeConvSteps.forEach(step => {
        const type = step.type;
        const source = step.source;
        
        if (type === 'USER_INPUT') {
            combinedText += ' ' + (step.content || '');
        } else if (source === 'MODEL' && type === 'PLANNER_RESPONSE') {
            combinedText += ' ' + (step.content || '') + ' ' + (step.thinking || '');
            if (step.tool_calls) {
                step.tool_calls.forEach(tc => {
                    combinedText += ' ' + (tc.name || '');
                    if (tc.args) {
                        for (let val of Object.values(tc.args)) {
                            if (typeof val === 'string') {
                                combinedText += ' ' + val;
                            }
                        }
                    }
                });
            }
        }
    });
    combinedText = combinedText.toLowerCase();
    
    // 2. Uncheck all checkboxes first
    const checkboxes = document.querySelectorAll('#skills-checklist-container input[type="checkbox"]');
    if (checkboxes.length === 0) return;
    
    let matchedCount = 0;
    checkboxes.forEach(cb => {
        const handle = cb.value.toLowerCase();
        const desc = (cb.getAttribute('data-desc') || '').toLowerCase();
        
        let isMatch = false;
        
        // Match condition:
        // - Explicit reference like "@handle"
        // - Or handle name matches as a distinct word in the text (to avoid matching substring of other words)
        const escapedHandle = handle.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const wordRegex = new RegExp('\\b' + escapedHandle + '\\b', 'i');
        const atRegex = new RegExp('@' + escapedHandle + '\\b', 'i');
        
        if (atRegex.test(combinedText) || wordRegex.test(combinedText)) {
            isMatch = true;
        } else {
            // Check major parts
            const parts = handle.split('-');
            if (parts.length > 1) {
                const firstPart = parts[0];
                const secondPart = parts[1];
                if (['google', 'aws', 'azure', 'react', 'vue', 'using'].includes(firstPart)) {
                    const secondRegex = new RegExp('\\b' + secondPart.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i');
                    if (secondPart.length > 2 && secondRegex.test(combinedText)) {
                        isMatch = true;
                    }
                } else if (firstPart.length > 2) {
                    const firstRegex = new RegExp('\\b' + firstPart.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i');
                    if (firstRegex.test(combinedText)) {
                        isMatch = true;
                    }
                }
            }
        }
        
        // Fallback checks for common integrations:
        if (!isMatch) {
            if (handle === 'firebase' && (combinedText.includes('firestore') || combinedText.includes('firebase'))) {
                isMatch = true;
            } else if (handle.includes('git') && (combinedText.includes('git ') || combinedText.includes('git-') || combinedText.includes('worktree'))) {
                isMatch = true;
            } else if (handle.includes('python') && (combinedText.includes('.py') || combinedText.includes('python'))) {
                isMatch = true;
            } else if (handle.includes('react') && (combinedText.includes('.jsx') || combinedText.includes('.tsx') || combinedText.includes('react'))) {
                isMatch = true;
            } else if (handle.includes('javascript') && (combinedText.includes('.js') || combinedText.includes('javascript'))) {
                isMatch = true;
            } else if (handle.includes('css') && (combinedText.includes('.css') || combinedText.includes('css'))) {
                isMatch = true;
            } else if (handle.includes('threejs') && (combinedText.includes('threejs') || combinedText.includes('three.js'))) {
                isMatch = true;
            } else if (handle.includes('telegram') && combinedText.includes('telegram')) {
                isMatch = true;
            } else if (handle.includes('zod') && combinedText.includes('zod')) {
                isMatch = true;
            }
        }
        
        cb.checked = isMatch;
        if (isMatch) matchedCount++;
    });
    
    console.log(`Auto-selected ${matchedCount} skills based on conversation usage.`);
    
    sortSkillsList();
    compilePromptBuilder();
}

async function loadSelectedRulesFile() {
    const selectEl = document.getElementById('rules-file-select');
    const saveBtn = document.getElementById('save-rules-btn');
    const inputEl = document.getElementById('linter-input');
    const phaseBar = document.getElementById('phase-manager-bar');
    
    if (!selectEl || !inputEl) return;
    
    const path = selectEl.value;
    activeRulesPath = path;
    
    const isProjectRules = path && path.endsWith('AGENTS.md') && !path.includes('config');
    const isManual = !path;
    
    if (isProjectRules || isManual) {
        isPhaseManagerActive = true;
        if (phaseBar) phaseBar.style.display = 'flex';
        if (saveBtn) saveBtn.style.display = 'inline-block';
        
        await loadProjectPhases();
        return;
    }
    
    isPhaseManagerActive = false;
    if (phaseBar) phaseBar.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'inline-block';
    
    inputEl.placeholder = 'Loading file...';
    try {
        const res = await fetch(`/api/rules/load?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);
        inputEl.value = data.content;
        compilePromptBuilder();
    } catch (err) {
        console.error('Failed to load rules file:', err);
        alert(`Failed to load file: ${err.message}`);
    }
}

async function saveActiveRulesFile() {
    const saveBtn = document.getElementById('save-rules-btn');
    const inputEl = document.getElementById('linter-input');
    
    if (!inputEl) return;
    
    if (isPhaseManagerActive) {
        await saveProjectPhasesToServer();
        alert("Project Rules & Phases compiled and saved to AGENTS.md!");
        return;
    }
    
    if (!activeRulesPath) return;
    
    const originalText = saveBtn ? saveBtn.innerText : '[save to disk]';
    if (saveBtn) {
        saveBtn.innerText = 'saving...';
        saveBtn.disabled = true;
    }
    
    try {
        const res = await fetch('/api/rules/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: activeRulesPath,
                content: inputEl.value
            })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        if (saveBtn) saveBtn.innerText = 'saved!';
        fetchRulesFiles().then(() => {
            const selectEl = document.getElementById('rules-file-select');
            if (selectEl) selectEl.value = activeRulesPath;
        });
    } catch (err) {
        console.error('Failed to save rules file:', err);
        alert(`Failed to save rules file: ${err.message}`);
        if (saveBtn) saveBtn.innerText = 'error';
    }
    
    setTimeout(() => {
        if (saveBtn) {
            saveBtn.innerText = originalText;
            saveBtn.disabled = false;
        }
    }, 1200);
}

async function loadProjectPhases() {
    try {
        const res = await fetch('/api/phases');
        projectPhases = await res.json();
        
        if (activePhaseIndex >= projectPhases.length) {
            activePhaseIndex = 0;
        }
        
        renderPhaseTabs();
        updateLinterInputFromActivePhase();
    } catch (err) {
        console.error('Failed to load project phases:', err);
    }
}

function renderPhaseTabs() {
    const listEl = document.getElementById('phase-tabs-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    
    projectPhases.forEach((phase, idx) => {
        const tab = document.createElement('button');
        tab.className = `theme-toggle-btn ${activePhaseIndex === idx ? 'active' : ''}`;
        tab.style.padding = '4px 8px';
        tab.style.fontSize = '0.75rem';
        
        const nameDecorated = phase.enabled ? phase.name : `<span style="text-decoration: line-through; opacity: 0.6;">${phase.name}</span>`;
        tab.innerHTML = nameDecorated;
        
        tab.onclick = (e) => {
            e.preventDefault();
            switchActivePhase(idx);
        };
        
        listEl.appendChild(tab);
    });
    
    const activePhase = projectPhases[activePhaseIndex];
    const enabledCheckbox = document.getElementById('phase-enabled-checkbox');
    if (enabledCheckbox && activePhase) {
        enabledCheckbox.checked = activePhase.enabled;
    }
    
    const deleteBtn = document.getElementById('delete-phase-btn');
    if (deleteBtn && activePhase) {
        deleteBtn.style.display = activePhase.name === 'General' ? 'none' : 'inline-block';
    }
}

function switchActivePhase(index) {
    const inputEl = document.getElementById('linter-input');
    if (inputEl && projectPhases[activePhaseIndex]) {
        projectPhases[activePhaseIndex].content = inputEl.value;
    }
    
    activePhaseIndex = index;
    renderPhaseTabs();
    updateLinterInputFromActivePhase();
}

function updateLinterInputFromActivePhase() {
    const inputEl = document.getElementById('linter-input');
    if (!inputEl) return;
    const activePhase = projectPhases[activePhaseIndex];
    if (activePhase) {
        inputEl.value = activePhase.content || '';
    }
    compilePromptBuilder();
}

function onLinterInputEdit() {
    const inputEl = document.getElementById('linter-input');
    if (!inputEl) return;
    
    if (isPhaseManagerActive && projectPhases[activePhaseIndex]) {
        projectPhases[activePhaseIndex].content = inputEl.value;
    }
    compilePromptBuilder();
}

function toggleActivePhaseEnabled() {
    const activePhase = projectPhases[activePhaseIndex];
    const checkbox = document.getElementById('phase-enabled-checkbox');
    if (activePhase && checkbox) {
        activePhase.enabled = checkbox.checked;
        renderPhaseTabs();
        compilePromptBuilder();
    }
}

function addNewPhase(event) {
    if (event) event.preventDefault();
    const name = prompt("Enter new Phase name (e.g. Phase 2):");
    if (!name || !name.trim()) return;
    
    const exists = projectPhases.some(p => p.name.toLowerCase() === name.trim().toLowerCase());
    if (exists) {
        alert("A phase with this name already exists!");
        return;
    }
    
    const inputEl = document.getElementById('linter-input');
    if (inputEl && projectPhases[activePhaseIndex]) {
        projectPhases[activePhaseIndex].content = inputEl.value;
    }
    
    projectPhases.push({
        name: name.trim(),
        enabled: true,
        content: `# ${name.trim()} Rules\n\n- Write phase instructions here...`
    });
    
    activePhaseIndex = projectPhases.length - 1;
    renderPhaseTabs();
    updateLinterInputFromActivePhase();
    saveProjectPhasesToServer();
}

function deleteActivePhase(event) {
    if (event) event.preventDefault();
    const activePhase = projectPhases[activePhaseIndex];
    if (!activePhase || activePhase.name === 'General') return;
    
    if (!confirm(`Are you sure you want to delete ${activePhase.name}?`)) return;
    
    projectPhases.splice(activePhaseIndex, 1);
    activePhaseIndex = 0;
    
    renderPhaseTabs();
    updateLinterInputFromActivePhase();
    saveProjectPhasesToServer();
}

async function saveProjectPhasesToServer() {
    const inputEl = document.getElementById('linter-input');
    if (inputEl && projectPhases[activePhaseIndex]) {
        projectPhases[activePhaseIndex].content = inputEl.value;
    }
    
    try {
        const res = await fetch('/api/phases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(projectPhases)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        console.log("Phases saved and compiled to AGENTS.md:", data.agents_path);
    } catch (err) {
        console.error('Failed to save phases:', err);
        alert(`Failed to save phases: ${err.message}`);
    }
}

async function exportActivePhaseToSkill(event) {
    if (event) event.preventDefault();
    const activePhase = projectPhases[activePhaseIndex];
    if (!activePhase) return;
    
    const inputEl = document.getElementById('linter-input');
    if (inputEl) {
        activePhase.content = inputEl.value;
    }
    
    if (!activePhase.content.trim()) {
        alert("Cannot export empty rules to skill!");
        return;
    }
    
    const confirmMsg = `Export "${activePhase.name}" as a reusable skill? This will write to .agents/skills/${activePhase.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}/SKILL.md and make it checkable in the catalog.`;
    if (!confirm(confirmMsg)) return;
    
    try {
        const res = await fetch('/api/phases/export_skill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: activePhase.name,
                content: activePhase.content
            })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        alert(`Success! Phase exported as skill: @${data.skill_handle}`);
        await fetchRulesFiles();
    } catch (err) {
        console.error('Failed to export phase to skill:', err);
        alert(`Export failed: ${err.message}`);
    }
}

function updatePromptCachingVisuals(promptText) {
    const statsDiv = document.getElementById('cache-savings-stats');
    const visualizerDiv = document.getElementById('prompt-cache-visualizer');
    const visualizerContainer = document.getElementById('prompt-cache-visualizer-container');
    
    if (!promptText) {
        if (statsDiv) statsDiv.style.display = 'none';
        if (visualizerContainer) visualizerContainer.style.display = 'none';
        return;
    }
    
    const lines = promptText.split('\n');
    const dynamicVars = ['{Cwd}', '{files}', '{current_time}', '{cursor_line}', '{timestamp}', '{context}'];
    
    // Find the first line containing any volatile dynamic variable (caching breakpoint)
    let firstVarLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const hasVar = dynamicVars.some(v => lines[i].toLowerCase().includes(v.toLowerCase()));
        if (hasVar) {
            firstVarLineIdx = i;
            break;
        }
    }
    
    // Cached prefix is everything BEFORE the first volatile variable line
    let staticCharCount = 0;
    let totalCharCount = promptText.length || 1;
    
    if (firstVarLineIdx === -1) {
        staticCharCount = totalCharCount;
    } else {
        const staticText = lines.slice(0, firstVarLineIdx).join('\n');
        staticCharCount = staticText.length;
    }
    
    const efficiency = Math.round((staticCharCount / totalCharCount) * 100);
    
    // Standard Gemini 1.5 Pro pricing:
    const unoptCost = 1.25; // $1.25 per 1M input tokens
    const cacheHitRate = 0.3125; // $0.3125 per 1M cached tokens (75% discount)
    
    const optCost = (efficiency / 100) * cacheHitRate + (1 - efficiency / 100) * unoptCost;
    const savings = unoptCost - optCost;
    const savingsPct = Math.round((savings / unoptCost) * 100);
    
    if (statsDiv) {
        statsDiv.style.display = 'block';
        statsDiv.innerHTML = `
            <div style="font-weight: 700; margin-bottom: 4px; display: flex; justify-content: space-between;">
                <span>Cache Efficiency Estimate:</span>
                <span style="color: ${efficiency > 50 ? 'var(--badge-success-text)' : 'var(--badge-failed-text)'};">${efficiency}%</span>
            </div>
            <div style="font-size: 0.72rem; opacity: 0.9; margin-bottom: 2px;">
                Cached Prefix: <strong>${Math.round(staticCharCount/3.5)}</strong> tokens / 
                Total: <strong>${Math.round(totalCharCount/3.5)}</strong> tokens.
            </div>
            <div style="font-size: 0.72rem; opacity: 0.9;">
                Est. Cost/1M Tokens: <strong>$${optCost.toFixed(4)}</strong> 
                <span style="opacity: 0.6; text-decoration: line-through;">(was $${unoptCost.toFixed(2)})</span>
            </div>
            <div style="font-size: 0.72rem; color: var(--badge-success-text); font-weight: 600; margin-top: 2px;">
                Clipped ${savingsPct}% off token cost ($${savings.toFixed(4)} saved per 1M input tokens).
            </div>
        `;
    }
    
    if (visualizerDiv && visualizerContainer) {
        visualizerContainer.style.display = 'block';
        visualizerDiv.innerHTML = '';
        
        lines.forEach((line, idx) => {
            if (!line.trim()) {
                visualizerDiv.innerHTML += '<div style="height: 0.5em;"></div>';
                return;
            }
            
            // Caching breaks starting from the first dynamic variable line onwards
            const isCacheMiss = firstVarLineIdx !== -1 && idx >= firstVarLineIdx;
            
            const color = isCacheMiss ? 'var(--badge-failed-text)' : 'var(--badge-success-text)';
            const bg = isCacheMiss ? 'rgba(244, 67, 54, 0.08)' : 'rgba(76, 175, 80, 0.08)';
            const border = isCacheMiss ? 'var(--badge-failed-text)' : 'var(--badge-success-text)';
            
            const lineSpan = document.createElement('span');
            lineSpan.style.display = 'block';
            lineSpan.style.padding = '2px 6px';
            lineSpan.style.margin = '2px 0';
            lineSpan.style.borderLeft = `3.5px solid ${border}`;
            lineSpan.style.backgroundColor = bg;
            lineSpan.style.color = 'var(--text-color)';
            lineSpan.style.opacity = isCacheMiss ? '0.9' : '1.0';
            
            let formattedLine = escapeHtml(line);
            dynamicVars.forEach(v => {
                const regex = new RegExp(v.replace(/[{}]/g, '\\$&'), 'gi');
                formattedLine = formattedLine.replace(regex, match => `<strong style="color: var(--badge-failed-text); font-weight: 700; background-color: rgba(244,67,54,0.15); padding: 0 2px; border-radius: 2px;">${match}</strong>`);
            });
            
            lineSpan.innerHTML = `${formattedLine} <span style="font-size:0.6rem; opacity:0.5; float:right;">[${isCacheMiss ? 'CACHING BREAK' : 'CACHED'}]</span>`;
            visualizerDiv.appendChild(lineSpan);
        });
    }
}

function compilePromptBuilder() {
    const inputEl = document.getElementById('linter-input');
    const previewContainer = document.getElementById('stitched-preview-container');
    const previewOutput = document.getElementById('stitched-preview-output');
    
    if (!inputEl) return;
    
    let baseRules = "";
    if (isPhaseManagerActive) {
        const activePhase = projectPhases[activePhaseIndex];
        if (activePhase) {
            activePhase.content = inputEl.value;
        }
        const activeParts = projectPhases
            .filter(p => p.enabled && p.content && p.content.trim())
            .map(p => p.content.trim());
        baseRules = activeParts.join('\n\n');
    } else {
        baseRules = inputEl.value.trim();
    }
    
    if (!baseRules) {
        if (previewContainer) previewContainer.style.display = 'none';
        updatePromptCachingVisuals('');
        return;
    }
    
    // 1. Gather selected skills from catalog checkboxes
    const skillCheckboxes = document.querySelectorAll('#skills-checklist-container input[type="checkbox"]:checked');
    const skillsList = [];
    skillCheckboxes.forEach(cb => {
        const handle = cb.value;
        const desc = cb.getAttribute('data-desc') || 'Custom guidelines.';
        skillsList.push(`- Use @${handle}: ${desc}`);
    });
    
    // 2. Gather checked volatile variables
    const varCheckboxes = document.querySelectorAll('#variables-checklist-container input[type="checkbox"]:checked');
    const varsList = [];
    varCheckboxes.forEach(cb => {
        varsList.push(cb.value);
    });
    
    // 3. Stitch prompt blocks
    const promptParts = [];
    
    // Block 1: Base Rules (always top, cached)
    promptParts.push(baseRules);
    
    // Block 2: Skills Catalog (if any checked, cached)
    if (skillsList.length > 0) {
        promptParts.push('');
        promptParts.push('# Enabled Skills Catalog');
        skillsList.forEach(s => promptParts.push(s));
    }
    
    // Block 3: Volatile Variables (always bottom, cache misses)
    if (varsList.length > 0) {
        promptParts.push('');
        promptParts.push('# Volatile Context Variables');
        varsList.forEach(v => {
            if (v === '{Cwd}') {
                promptParts.push(`Active Workspace Directory: ${v}`);
            } else if (v === '{files}') {
                promptParts.push(`Workspace File Weight Map: ${v}`);
            } else if (v === '{current_time}') {
                promptParts.push(`Current System Timestamp: ${v}`);
            } else if (v === '{context}') {
                promptParts.push(`Historical Conversation Log: ${v}`);
            } else {
                promptParts.push(`Context variable: ${v}`);
            }
        });
    }
    
    const stitchedPrompt = promptParts.join('\n');
    
    // Update Stitched Preview panel
    if (previewContainer && previewOutput) {
        previewContainer.style.display = 'block';
        previewOutput.value = stitchedPrompt;
    }
    
    // Update caching visuals on the combined stitched prompt
    updatePromptCachingVisuals(stitchedPrompt);
}

function copyStitchedPrompt() {
    const output = document.getElementById('stitched-preview-output');
    if (output) {
        output.select();
        navigator.clipboard.writeText(output.value);
        alert('Stitched prompt copied to clipboard!');
    }
}

// =============================================================
// Token Efficiency Scorecard & Context Diagnostics (Option 3)
// =============================================================
function toggleDiagnostics() {
    const panel = document.getElementById('diagnostics-panel');
    const btn = document.getElementById('toggle-diagnostics-btn');
    if (!panel || !btn) return;
    
    if (panel.style.display === 'none') {
        panel.style.display = 'flex';
        btn.innerText = '[hide diagnostics]';
    } else {
        panel.style.display = 'none';
        btn.innerText = '[show diagnostics]';
    }
}

function computeRunGrade(successRate, redundantFilesCount, cacheHitRatio) {
    let score = 4; // 4=A, 3=B, 2=C, 1=D, 0=F
    
    if (successRate >= 0.95) score = 4;
    else if (successRate >= 0.85) score = 3;
    else if (successRate >= 0.70) score = 2;
    else if (successRate >= 0.50) score = 1;
    else score = 0;
    
    if (redundantFilesCount > 4) score = 0;
    else if (redundantFilesCount >= 3) score = Math.max(0, score - 2);
    else if (redundantFilesCount >= 1) score = Math.max(0, score - 1);
    
    if (cacheHitRatio < 0.30) score = Math.max(0, score - 2);
    else if (cacheHitRatio < 0.50) score = Math.max(0, score - 1);
    
    const grades = ['F', 'D', 'C', 'B', 'A'];
    return grades[score];
}

function getConversationDiagnostics(steps) {
    let lastPlannerStep = null;
    let toolCallIndex = 0;
    const resources = {};
    
    steps.forEach(step => {
        const source = step.source;
        const type = step.type;
        
        if (source === 'MODEL' && type === 'PLANNER_RESPONSE') {
            lastPlannerStep = step;
            toolCallIndex = 0;
        } else if (source === 'MODEL' && type !== 'PLANNER_RESPONSE') {
            const toolName = type.toLowerCase();
            const content = step.content || '';
            const payloadTokens = Math.max(1, Math.floor(content.length / 3.5));
            
            let resourceDesc = 'unknown';
            if (lastPlannerStep) {
                const toolCalls = lastPlannerStep.tool_calls || [];
                if (toolCallIndex < toolCalls.length) {
                    const tc = toolCalls[toolCallIndex];
                    const args = tc.args || {};
                    const name = tc.name;
                    
                    if (name === 'view_file') {
                        resourceDesc = (args.AbsolutePath || 'unknown').replace(/"/g, '');
                    } else if (name === 'run_command' || name === 'unsandboxed') {
                        resourceDesc = (args.CommandLine || 'unknown').replace(/"/g, '');
                    } else if (name === 'grep_search') {
                        resourceDesc = `grep: ${args.Query || 'unknown'} in ${args.SearchPath || ''}`.replace(/"/g, '');
                    } else if (name === 'list_dir') {
                        resourceDesc = (args.DirectoryPath || 'unknown').replace(/"/g, '');
                    } else if (name === 'replace_file_content') {
                        resourceDesc = `edit: ${args.TargetFile || 'unknown'}`.replace(/"/g, '');
                    } else {
                        resourceDesc = `${name} (general)`;
                    }
                    toolCallIndex++;
                } else {
                    resourceDesc = `${toolName} (unmatched)`;
                }
            } else {
                resourceDesc = `${toolName} (no planner)`;
            }
            
            resourceDesc = resourceDesc.replace(/\\/g, '/');
            
            const key = `${toolName}||${resourceDesc}`;
            if (!resources[key]) {
                resources[key] = { tool: toolName, desc: resourceDesc, calls: 0, tokens: 0 };
            }
            resources[key].calls++;
            resources[key].tokens += payloadTokens;
        }
    });
    
    return Object.values(resources).sort((a, b) => b.tokens - a.tokens);
}

function renderConversationDiagnostics(steps) {
    const panel = document.getElementById('diagnostics-panel');
    if (!panel) return;
    
    panel.style.display = 'none';
    const btn = document.getElementById('toggle-diagnostics-btn');
    if (btn) btn.innerText = '[show diagnostics]';
    
    if (!steps || steps.length === 0) {
        panel.innerHTML = '<div style="opacity: 0.5; font-size: 0.8rem;">No step data to analyze.</div>';
        return;
    }
    
    const resourceData = getConversationDiagnostics(steps);
    const meta = conversations.find(c => c.id === activeConvId);
    
    const totalInput = meta ? meta.input_tokens : 0;
    const uncachedInput = steps.reduce((s, c) => s + (c.tokens || 0), 0);
    const cacheHitRatio = totalInput > 0 ? Math.max(0, Math.min(0.99, (totalInput - uncachedInput) / totalInput)) : 0.75;
    
    const totalToolCalls = steps.filter(c => c.source === 'MODEL' && c.type !== 'PLANNER_RESPONSE').length;
    const failedToolCalls = steps.filter(c => c.source === 'MODEL' && c.type !== 'PLANNER_RESPONSE' && c.status === 'ERROR').length;
    const successRate = totalToolCalls > 0 ? (totalToolCalls - failedToolCalls) / totalToolCalls : 1.0;
    
    const redundantFiles = resourceData.filter(r => r.tool === 'view_file' && r.calls > 2);
    const redundantFilesCount = redundantFiles.length;
    
    const grade = computeRunGrade(successRate, redundantFilesCount, cacheHitRatio);
    
    let gradeColor = 'var(--badge-success-text)';
    if (grade === 'F') gradeColor = 'var(--badge-failed-text)';
    else if (grade === 'D' || grade === 'C') gradeColor = 'var(--orange-4)';
    
    const checklist = [];
    if (redundantFilesCount > 0) {
        redundantFiles.forEach(rf => {
            const fileName = rf.desc.split('/').pop();
            checklist.push(`Reduce redundant reads of file <code style="font-size:0.75rem;">${fileName}</code> (accessed ${rf.calls} times) by caching content in memory.`);
        });
    }
    if (successRate < 0.90) {
        checklist.push(`Fix failed tool calls: check error logs in the timeline steps list to resolve command flags or permissions.`);
    }
    if (cacheHitRatio < 0.60) {
        checklist.push(`Optimize prompt structure: move dynamic placeholders to the bottom of rules/AGENTS.md to restore caching.`);
    }
    const worstBloater = resourceData[0];
    if (worstBloater && worstBloater.tokens > 25000) {
        checklist.push(`Shorten high-volume output of <code>${worstBloater.tool}</code> on resource: <em>${worstBloater.desc.split('/').pop()}</em> (${Math.round(worstBloater.tokens/1000)}K tokens).`);
    }
    
    const checklistHtml = checklist.length > 0 
        ? checklist.map(item => `
            <div style="display: flex; gap: 8px; font-size: 0.78rem; opacity: 0.85; margin-bottom: 6px;">
                <span style="color: var(--orange-4); font-weight: bold;">[!]</span>
                <span>${item}</span>
            </div>`).join('')
        : `<div style="color: var(--badge-success-text); font-size: 0.78rem; font-weight: 600;">[✓] All token efficiency metrics are optimal for this run!</div>`;
        
    const totalToolTokens = resourceData.reduce((s, r) => s + r.tokens, 0) || 1;
    const topBloaters = resourceData.slice(0, 5);
    const bloatersHtml = topBloaters.length > 0
        ? topBloaters.map(r => {
            const pct = Math.round((r.tokens / totalToolTokens) * 100);
            const fileName = r.desc.split('/').pop();
            const filePath = r.desc.startsWith('/') || r.desc.includes(':') ? r.desc : `d:/antigravity-dashboard/${r.desc}`;
            const fileLink = `file:///${filePath}`;
            
            const nameLabel = r.tool === 'view_file' || r.tool === 'code_action'
                ? `<a href="${fileLink}" target="_blank" style="color: var(--text-color); text-decoration: none; font-weight: 500; font-family: 'Fira Code', monospace; font-size: 0.7rem;">${fileName}</a>`
                : `<span style="font-family: 'Fira Code', monospace; font-size: 0.7rem;">${fileName || r.desc}</span>`;
                
            return `
                <div style="margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 3px;">
                        <span><strong style="text-transform: uppercase; font-size: 0.65rem; color: var(--chart-line); padding: 1px 4px; border: 1.5px solid var(--border-color); border-radius: 4px; margin-right: 6px;">${r.tool}</strong> ${nameLabel}</span>
                        <span style="opacity: 0.85; font-family: 'Fira Code', monospace; font-size: 0.72rem;">${Math.round(r.tokens/1000)}K tokens (${r.calls} call${r.calls !== 1 ? 's' : ''})</span>
                    </div>
                    <div style="height: 6px; background-color: var(--border-color); border-radius: 3px; overflow: hidden; width: 100%;">
                        <div style="height: 100%; background-color: var(--chart-line); width: ${pct}%; border-radius: 3px;"></div>
                    </div>
                </div>`;
          }).join('')
        : '<div style="opacity: 0.5; font-size: 0.78rem;">No tool calls in this run.</div>';
        
    panel.innerHTML = `
        <div style="display: grid; grid-template-columns: 80px 1fr; gap: 15px; border-bottom: 1px dashed var(--border-color); padding-bottom: 12px;">
            <div style="border: 2px solid ${gradeColor}; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 74px; background-color: rgba(0,0,0,0.015);">
                <span style="font-size: 0.65rem; text-transform: uppercase; opacity: 0.75; font-weight: bold; margin-bottom: -2px;">Grade</span>
                <span style="font-size: 2.2rem; font-weight: 900; color: ${gradeColor}; line-height: 1.1; font-family: 'Fira Code', monospace;">${grade}</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.78rem;">
                <div>
                    <div style="opacity: 0.6; font-size: 0.68rem; text-transform: uppercase;">Cache Hit Rate</div>
                    <div style="font-weight: 700; font-family: 'Fira Code', monospace; font-size: 1.05rem; margin-top: 2px; color: ${cacheHitRatio > 0.6 ? 'var(--badge-success-text)' : 'var(--badge-failed-text)'};">${Math.round(cacheHitRatio * 100)}%</div>
                </div>
                <div>
                    <div style="opacity: 0.6; font-size: 0.68rem; text-transform: uppercase;">Tool Success Rate</div>
                    <div style="font-weight: 700; font-family: 'Fira Code', monospace; font-size: 1.05rem; margin-top: 2px; color: ${successRate > 0.9 ? 'var(--badge-success-text)' : 'var(--badge-failed-text)'};">${Math.round(successRate * 100)}%</div>
                </div>
                <div>
                    <div style="opacity: 0.6; font-size: 0.68rem; text-transform: uppercase;">Redundant Reads</div>
                    <div style="font-weight: 700; font-family: 'Fira Code', monospace; font-size: 1.05rem; margin-top: 2px; color: ${redundantFilesCount === 0 ? 'var(--badge-success-text)' : 'var(--orange-4)'};">${redundantFilesCount} file${redundantFilesCount !== 1 ? 's' : ''}</div>
                </div>
                <div>
                    <div style="opacity: 0.6; font-size: 0.68rem; text-transform: uppercase;">Tool Payload Size</div>
                    <div style="font-weight: 700; font-family: 'Fira Code', monospace; font-size: 1.05rem; margin-top: 2px; color: var(--chart-line);">${Math.round(totalToolTokens/1000)}K tokens</div>
                </div>
            </div>
        </div>
        
        <div style="border-bottom: 1px dashed var(--border-color); padding-bottom: 12px;">
            <div style="font-size: 0.68rem; font-weight: 700; text-transform: uppercase; opacity: 0.6; margin-bottom: 8px;">Run Efficiency Checklist</div>
            ${checklistHtml}
        </div>
        
        <div>
            <div style="font-size: 0.68rem; font-weight: 700; text-transform: uppercase; opacity: 0.6; margin-bottom: 8px;">Tool Payload Diagnostics (Top 5 Bloaters)</div>
            ${bloatersHtml}
        </div>
    `;
}
