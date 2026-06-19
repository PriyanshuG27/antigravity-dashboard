# Antigravity Agent Usage & Prompt Optimization Dashboard

A developer control panel designed to monitor coding agent runs, analyze token consumption footprint, inspect execution logs, and optimize prompt caching layouts.

---

## 🚀 Active Features

### 1. Overview Analytics Dashboard
* **Visual Activity Heatmaps**: Color-coded calendar grids showing daily activity (orange grid for Gemini, blue grid for Claude/third-party API tokens).
* **Token Trend Line Chart**: Dynamic SVG chart tracking daily token consumption over the last 30 days.
* **KPI Metrics Scorecard**: Cards displaying total completed vs crashed runs, peak day consumption, active streaks, average session length, and 30-day token volumes.
* **Project Summaries**: Hierarchical breakdown of token usage and total execution runs grouped by project folders.
* **Tool Success Rates**: Performance indicators tracking the most frequent tool invocations and their success-to-error ratios.

### 2. Conversation Log Explorer
* **Intelligent Grouping & Sorting**: Group execution logs by project, subagent type, or calendar date. Filter by status (completed/crashed) or sort by recency and token weight.
* **Subagent Hierarchy Map**: Collapsible tree canvas that dynamically visualizes the execution chain of subagents.
* **Timeline Performance Pagination**: Caps loaded steps to 80 (rendering the first 30 steps, a performance divider, and the last 30 steps) to prevent browser thread lockups on massive 1,000+ step logs.
* **Token Efficiency Scorecard**: Calculates a performance grade (A-F) based on cache hit ratios, redundant file reads, and renders a diagnostic chart of the top 5 token-bloating payload events.

### 3. TokenHUD Prompt Cache Optimizer
* **Cache Prefix Heatmap**: Color-codes prompt lines in real-time (static instructions in green vs volatile context variables like `{Cwd}`, `{files}` in red/orange) to display cache alignment.
* **One-Click Optimizer**: Restructures prompts automatically, pushing static guidelines to the top (maximizing cached prefix length) and volatile variables to the bottom.
* **Savings Predictor**: Calculates real-time cost-per-million estimations ($1.25 uncached vs $0.30 cached) and computes active USD savings based on rules structuring.

### 4. Rules & Phase Manager
* **Sprint Phase Tabs**: Organize prompt instructions into sequential development phases (e.g. `General`, `Phase 1: Database`, `Phase 2: UI`).
* **Active Compiler Checkbox**: Check or uncheck specific phases to dynamically stitch them into the prompt compiler, keeping irrelevant phase instructions out of active context.
* **Save to Disk**: Commit compiled active rules directly to your project's `.agents/AGENTS.md` (dynamically loaded by the agent on every turn to prevent loss during history compaction).
* **Modular @Skills Catalog**: Export completed phase instructions into standalone skill markdown files (e.g. `@phase-1`). Enables searching, checkbox-bubbling, and auto-detecting rules to pull them back into context only when referenced.

### 5. Codebase Token Weight Map
* **Footprint Scan**: Recursively lists and ranks files in the active workspace by token weight, displaying colored alert badges:
  * 🔴 **Cache Risk**: Files $>20,000$ tokens (high context bloat risk).
  * 🟡 **Medium Risk**: Files between $8,000$ and $20,000$ tokens.
  * 🟢 **Safe**: Files $<8,000$ tokens.

---

## 📂 Project Structure

```
antigravity-dashboard/
├── .agents/               # Project-level prompt rules configurations
│   ├── AGENTS.md          # Active compiled ruleset loaded by agent
│   └── phases.json        # Saved development phase tabs database
├── app.py                 # Flask server with log scanner, token weight calculations, and APIs
├── run.ps1                # PowerShell launcher script
├── static/
│   ├── dashboard.js       # UI state, prompting calculations, and layout managers
│   └── style.css          # Modern dark-theme styling
└── templates/
    └── index.html         # Main dashboard layout
```

---

## 🛠️ Installation & Setup

### 1. Set Up Environment
Create and activate a local Python virtual environment:

```bash
# Windows (PowerShell)
python -m venv venv
.\venv\Scripts\Activate.ps1

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies
Install the required packages (no external binaries or complex databases needed):

```bash
pip install flask flask-cors
```

---

## 🏃 Running the Application

### Method A: PowerShell Script (Windows)
Run the launcher script to start the server and automatically launch the web browser:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\run.ps1
```

### Method B: Standard Python Start
Start the backend server:

```bash
python app.py
```

Then, open your web browser and go to:
👉 **[http://127.0.0.1:5000](http://127.0.0.1:5000)**
