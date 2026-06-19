# Antigravity Developer & Prompt Cache Dashboard

A premium developer control panel and prompt optimization dashboard. This application provides real-time Gemini & third-party API quota tracking, cache efficiency visualization, timeline log explorers, and a progressive rules & phase manager designed to optimize coding agent prompts and context usage.

---

## 🚀 Key Features

### 1. Multi-Account Quota HUD
* **Concurrent Pools**: Track Gemini and third-party models (Claude/GPT) separately for up to 4 accounts in a responsive side-by-side bento layout.
* **Unified Remaining Indicators**: Circular progress meters indicating left-over capacity (flashing red if $\le 10\%$, orange if $\le 30\%$).
* **Offline IDE Syncing**: Safely parses active IDE quota state databases (`state.vscdb`) offline using custom protobuf decoders to automatically sync remaining credits and emails.

### 2. Prompt Guardian & Cache Optimizer
* **Visual Cache Heatmap**: Color-codes prompt lines (static rules in green vs volatile variables like `{Cwd}`, `{files}` in red/orange) to visualize cache alignment.
* **One-Click Restructuring**: Auto-reorders templates to keep static code guidelines at the top (cached) and volatile context placeholders at the bottom.
* **USD Cost & Savings Estimator**: Calculates real-time cost-per-million predictions ($1.25 uncached vs $0.30 cached) based on volatile placement.

### 3. Rules & Phase Manager
* **Sequential Phase Tabs**: Organize guidelines by developmental stages (e.g. `General Rules`, `Phase 1: Ingestion`, `Phase 2: Graph Network`).
* **Interactive Compiler Checklist**: Check/uncheck specific phase tabs to dynamically compile active rules and exclude future/past rules from prompt bloat.
* **Compaction-Resistant Storage**: Save active rules directly to your project's `.agents/AGENTS.md` (which the agent re-injects on every single turn).
* **Modular @Skills Export**: Convert finished phases into standalone skills (e.g., `.agents/skills/phase-1/SKILL.md`) to pull them back into context on-demand.

### 4. Codebase Token Weight Map
* **Recursive Workspace Scan**: Scans project files, sorts them by token size, and displays them with color-coded risk alerts:
  * 🔴 **Cache Risk**: Files $>20,000$ tokens (high context bloat risk).
  * 🟡 **Medium Risk**: Files between $8,000$ and $20,000$ tokens.
  * 🟢 **Safe**: Files $<8,000$ tokens.

### 5. Timeline Logs & Performance Pagination
* **Performance Pagination**: Caps loaded steps to $80$ items (rendering first $30$, a dashed divider, and last $30$ with an optional `[Load All]` trigger) to prevent browser threads from freezing on massive $1000+$ step conversation histories.
* **Scorecards & Diagnostics**: Computes grading (A-F) based on cache hit ratios, redundant file reads, and displays a bar chart of the top 5 tool payload bloaters.

---

## 📂 Project Structure

```
antigravity-dashboard/
├── .agents/               # Project-level prompt rules configurations
│   ├── AGENTS.md          # Active compiled ruleset loaded by agent
│   └── phases.json        # Saved development phase tabs database
├── app.py                 # Flask server with offline quota & token scanning logic
├── run.ps1                # PowerShell launcher script
├── static/
│   ├── dashboard.js       # UI state, prompting calculations, and websocket manager
│   └── style.css          # Premium modern dark-theme styling
└── templates/
    └── index.html         # Main dashboard layout
```

---

## 🛠️ Installation & Setup

### Prerequisites
* Python 3.8+ installed on your system.
* Active Git configurations.

### 1. Set Up Environment
Create and activate a local virtual environment:

```bash
# Windows (PowerShell)
python -m venv venv
.\venv\Scripts\Activate.ps1

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies
Install Flask and its cross-origin resource sharing library:

```bash
pip install flask flask-cors
```

---

## 🏃 Running the Application

There are two ways to start the dashboard:

### Method A: Using the PowerShell Script (Windows)
Run the launcher script to automatically start the server and launch the web browser:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\run.ps1
```

### Method B: Standard Python Execution
Start the backend manually:

```bash
python app.py
```

Then, open your web browser and navigate to:
👉 **[http://127.0.0.1:5000](http://127.0.0.1:5000)**
