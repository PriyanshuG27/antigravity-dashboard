import json
import glob
import os
import re
import shutil
import sqlite3
import base64
from datetime import datetime, timedelta
from flask import Flask, jsonify, render_template, send_from_directory, request
from flask_cors import CORS

app = Flask(__name__, 
            static_folder="static", 
            template_folder="templates")
CORS(app)

BRAIN_DIR = r"C:\Users\pri27\.gemini\antigravity\brain"

# Calculate local timezone offset relative to UTC (Zulu)
from datetime import datetime, timedelta
LOCAL_OFFSET = datetime.now() - datetime.utcnow()
LOCAL_OFFSET = timedelta(minutes=round(LOCAL_OFFSET.total_seconds() / 60.0))

def estimate_tokens(text):
    if not text:
        return 0
    # Average 3.5 characters per token for a mix of English and code/JSON
    return max(1, int(len(text) / 3.5))

def parse_dt(dt_str, to_local=True):
    if not dt_str:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%S.%f+00:00"):
        try:
            dt = datetime.strptime(dt_str.replace("Z", ""), fmt.split(".")[0])
            if to_local:
                return dt + LOCAL_OFFSET
            return dt
        except ValueError:
            continue
    try:
        clean_str = dt_str.split(".")[0].split("+")[0].replace("T", " ").replace("Z", "")
        dt = datetime.strptime(clean_str, "%Y-%m-%d %H:%M:%S")
        if to_local:
            return dt + LOCAL_OFFSET
        return dt
    except Exception:
        return None

STEPS_CACHE = {}

def get_conversation_data(conv_id):
    transcript_path = os.path.join(BRAIN_DIR, conv_id, ".system_generated", "logs", "transcript.jsonl")
    transcript_full_path = os.path.join(BRAIN_DIR, conv_id, ".system_generated", "logs", "transcript_full.jsonl")
    
    # Prefer full transcript if available, fallback to truncated transcript
    path_to_use = transcript_full_path if os.path.exists(transcript_full_path) else transcript_path
    
    if not os.path.exists(path_to_use):
        return None
        
    try:
        mtime = os.path.getmtime(path_to_use)
        size = os.path.getsize(path_to_use)
    except Exception:
        return None
        
    cached = STEPS_CACHE.get(conv_id)
    if cached and cached[0] == mtime and cached[1] == size:
        return cached[2]
        
    steps = []
    try:
        with open(path_to_use, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    steps.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except Exception:
        return None
        
    if not steps:
        return None
        
    steps.sort(key=lambda x: x.get("step_index", 0))
    STEPS_CACHE[conv_id] = (mtime, size, steps)
    return steps

CONV_CACHE = {}
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "conv_cache.json")
CACHE_VERSION = 4

def load_cache():
    global CONV_CACHE
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                
                # Invalidate if version mismatch or old format
                if data.get("_cache_version") != CACHE_VERSION:
                    print(f"Cache version mismatch (got {data.get('_cache_version')}, expected {CACHE_VERSION}). Rebuilding cache...")
                    CONV_CACHE = {}
                    return
                    
                temp_cache = {}
                for k, v in data.items():
                    if k == "_cache_version":
                        continue
                    if isinstance(v, list) and len(v) == 3:
                        conv_summary = v[2]
                        if "llm_hours" in conv_summary and "tool_hours" in conv_summary and "project" in conv_summary and "daily_breakdown" in conv_summary:
                            if "pool" not in conv_summary:
                                conv_summary["pool"] = "gemini"
                            temp_cache[k] = (v[0], v[1], conv_summary)
                CONV_CACHE = temp_cache
        except Exception as e:
            print(f"Error loading cache: {e}")
            CONV_CACHE = {}
    else:
        CONV_CACHE = {}

def save_cache():
    try:
        save_data = {"_cache_version": CACHE_VERSION}
        for k, v in CONV_CACHE.items():
            save_data[k] = v
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(save_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving cache: {e}")

load_cache()

def summarize_conversations():
    log_files = glob.glob(os.path.join(BRAIN_DIR, "*", ".system_generated", "logs", "transcript.jsonl"))
    conversations = []
    cache_updated = False
    
    for path in log_files:
        conv_id = path.split(os.sep)[-4]
        
        # Check modification time and size of the transcript file we will actually use
        transcript_path = path
        transcript_full_path = os.path.join(BRAIN_DIR, conv_id, ".system_generated", "logs", "transcript_full.jsonl")
        path_to_use = transcript_full_path if os.path.exists(transcript_full_path) else transcript_path
        
        if not os.path.exists(path_to_use):
            continue
            
        try:
            mtime = os.path.getmtime(path_to_use)
            size = os.path.getsize(path_to_use)
        except Exception:
            continue
            
        cached = CONV_CACHE.get(conv_id)
        if cached and cached[0] == mtime and cached[1] == size:
            conversations.append(cached[2])
            continue
            
        steps = get_conversation_data(conv_id)
        if not steps:
            continue
            
        start_time_str = steps[0].get("created_at")
        end_time_str = steps[-1].get("created_at")
        
        start_dt = parse_dt(start_time_str)
        end_dt = parse_dt(end_time_str)
        
        if not start_dt or not end_dt:
            continue
            
        duration_sec = (end_dt - start_dt).total_seconds()
        
        # Get goal/title
        title = "Untitled Task"
        for step in steps:
            if step.get("type") == "USER_INPUT" and step.get("content"):
                content = step["content"]
                # Extract content inside <USER_REQUEST> if present
                req_match = re.search(r"<USER_REQUEST>(.*?)</USER_REQUEST>", content, re.DOTALL)
                if req_match:
                    title = req_match.group(1).strip()
                else:
                    title = content.strip()
                # Truncate title
                if len(title) > 80:
                    title = title[:80] + "..."
                break
                
        # Count stats
        llm_input_tokens = 0
        llm_output_tokens = 0
        tool_io_tokens = 0
        tool_calls_count = 0
        errors_count = 0
        
        history_char_count = 0
        conv_tools = {}
        
        # New daily breakdown structure
        daily_breakdown = {}
        
        llm_hours = [0] * 24
        tool_hours = [0] * 24
        
        for step in steps:
            source = step.get("source")
            step_type = step.get("type")
            status = step.get("status")
            content = step.get("content") or ""
            thinking = step.get("thinking") or ""
            tool_calls = step.get("tool_calls") or []
            
            # Estimate tokens
            content_tokens = estimate_tokens(content)
            thinking_tokens = estimate_tokens(thinking)
            tool_calls_tokens = estimate_tokens(json.dumps(tool_calls))
            
            # Step content accumulates in history
            step_total_chars = len(content) + len(thinking) + len(json.dumps(tool_calls))
            
            step_tokens = content_tokens + thinking_tokens + tool_calls_tokens
            
            step_dt = parse_dt(step.get("created_at"), to_local=True)
            
            step_total_tokens = 0
            if source == "MODEL" and step_type == "PLANNER_RESPONSE":
                step_total_tokens = step_tokens + estimate_tokens(" " * history_char_count)
                
            if step_dt:
                step_day_str = step_dt.strftime("%Y-%m-%d")
                step_hour = step_dt.hour
                
                if step_day_str not in daily_breakdown:
                    daily_breakdown[step_day_str] = {
                        "llm_hours": [0] * 24,
                        "tool_hours": [0] * 24,
                        "total_tokens": 0
                    }
                
                if source == "MODEL" and step_type == "PLANNER_RESPONSE":
                    llm_hours[step_hour] += step_tokens
                    daily_breakdown[step_day_str]["llm_hours"][step_hour] += step_tokens
                elif source == "MODEL" and step_type != "PLANNER_RESPONSE":
                    tool_hours[step_hour] += step_tokens
                    daily_breakdown[step_day_str]["tool_hours"][step_hour] += step_tokens
                    
                daily_breakdown[step_day_str]["total_tokens"] += step_total_tokens
            
            if source == "MODEL" and step_type == "PLANNER_RESPONSE":
                # Model invocation: context contains all history up to now
                llm_input_tokens += estimate_tokens(" " * history_char_count)
                # Output is what model returned
                llm_output_tokens += thinking_tokens + content_tokens + tool_calls_tokens
            elif source == "MODEL" and step_type != "PLANNER_RESPONSE":
                # Tool running
                tool_io_tokens += content_tokens
                tool_calls_count += 1
                if status == "ERROR":
                    errors_count += 1
                    
                tool_name = step_type.lower().replace("_", " ")
                if tool_name not in conv_tools:
                    conv_tools[tool_name] = {"calls": 0, "errors": 0}
                conv_tools[tool_name]["calls"] += 1
                if status == "ERROR":
                    conv_tools[tool_name]["errors"] += 1
                    
            history_char_count += step_total_chars
            
        # Calculate active time
        sorted_steps = sorted(steps, key=lambda x: parse_dt(x.get("created_at")) or datetime.min)
        active_sec = 0
        for i in range(1, len(sorted_steps)):
            dt1 = parse_dt(sorted_steps[i-1].get("created_at"))
            dt2 = parse_dt(sorted_steps[i].get("created_at"))
            if dt1 and dt2:
                diff = (dt2 - dt1).total_seconds()
                if diff < 600: # gap less than 10 minutes
                    active_sec += diff
                else:
                    active_sec += 30 # default resume overhead
                
        active_duration_mins = round(max(0.5, active_sec / 60.0), 1)
        
        # Calculate overall status based on final step
        last_step = steps[-1]
        last_status = last_step.get("status")
        overall_status = "Crashed" if last_status == "ERROR" else "Completed"
        
        error_rate = round((errors_count / len(steps)) * 100, 1) if steps else 0
        
        # Determine project folder
        project = None
        
        # 1. Match from Tool Paths
        tool_paths = []
        for step in steps:
            tool_calls = step.get("tool_calls") or []
            for tc in tool_calls:
                args = tc.get("args") or {}
                for arg_name, arg_val in args.items():
                    if isinstance(arg_val, str):
                        tool_paths.append(arg_val)
                    elif isinstance(arg_val, list):
                        for item in arg_val:
                            if isinstance(item, str):
                                tool_paths.append(item)
                                
        PROJECT_MAP = {
            "antigravity-dashboard": "Antigravity",
            "fitdesi": "Fitdesi",
            "prahari": "Prahari",
            "recall": "Recall",
            "ours": "Ours",
            "zenkai": "Zenkai"
        }
        
        for tp in tool_paths:
            tp_lower = tp.lower().replace('\\', '/')
            for key, name in PROJECT_MAP.items():
                if f"/{key}" in tp_lower or f"\\{key}" in tp_lower or tp_lower.startswith(f"{key}/") or tp_lower.startswith(f"{key}\\") or f":/{key}" in tp_lower or f":\\{key}" in tp_lower:
                    project = name
                    break
            if project:
                break
                
        # 2. Match from user_information workspace URIs in step 1
        if not project and len(steps) > 0:
            first_step_content = steps[0].get("content") or ""
            for key, name in PROJECT_MAP.items():
                if re.search(rf"[a-zA-Z]:\\{key}\b", first_step_content, re.IGNORECASE) or re.search(rf"[a-zA-Z]:/{key}\b", first_step_content, re.IGNORECASE):
                    project = name
                    break
                    
        # 3. Match from Title using word boundaries
        if not project:
            title_lower = title.lower()
            for key, name in PROJECT_MAP.items():
                if re.search(rf"\b{key}\b", title_lower, re.IGNORECASE):
                    project = name
                    break
                    
        # 4. Match from User Input content using word boundaries
        if not project:
            for step in steps:
                if step.get("type") == "USER_INPUT" and step.get("content"):
                    user_content_lower = step["content"].lower()
                    for key, name in PROJECT_MAP.items():
                        if re.search(rf"\b{key}\b", user_content_lower, re.IGNORECASE):
                            project = name
                            break
                if project:
                    break
                    
        if not project:
            project = "General"
                    
        # Determine pool type (gemini or thirdparty)
        pool = "gemini"
        for step in steps:
            content_lower = (step.get("content") or "").lower()
            thinking_lower = (step.get("thinking") or "").lower()
            if any(k in content_lower or k in thinking_lower for k in ["claude", "gpt", "openai", "anthropic"]):
                pool = "thirdparty"
                break
            
        conv_summary = {
            "id": conv_id,
            "title": title,
            "project": project,
            "pool": pool,
            "date": start_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "date_short": start_dt.strftime("%Y-%m-%d"),
            "timestamp": start_dt.timestamp(),
            "duration_mins": active_duration_mins,
            "elapsed_duration_mins": round(max(0.5, duration_sec / 60.0), 1),
            "input_tokens": llm_input_tokens,
            "output_tokens": llm_output_tokens,
            "total_tokens": llm_input_tokens + llm_output_tokens,
            "tool_tokens": tool_io_tokens,
            "daily_breakdown": daily_breakdown,
            "steps": len(steps),
            "tools_called": tool_calls_count,
            "errors": errors_count,
            "error_rate": error_rate,
            "status": overall_status,
            "tools": conv_tools,
            "llm_hours": llm_hours,
            "tool_hours": tool_hours
        }
        
        CONV_CACHE[conv_id] = (mtime, size, conv_summary)
        conversations.append(conv_summary)
        cache_updated = True
        
    if cache_updated:
        save_cache()
        
    conversations.sort(key=lambda x: x["timestamp"], reverse=True)
    return conversations

def decode_varint(data, pos):
    val = 0
    shift = 0
    while True:
        if pos >= len(data):
            break
        b = data[pos]
        pos += 1
        val |= (b & 0x7F) << shift
        shift += 7
        if not (b & 0x80):
            break
    return val, pos

def parse_proto(data):
    res = []
    i = 0
    n = len(data)
    while i < n:
        tag, i = decode_varint(data, i)
        field_num = tag >> 3
        wire_type = tag & 0x07
        
        if wire_type == 0:
            val, i = decode_varint(data, i)
            res.append((field_num, wire_type, val))
        elif wire_type == 1:
            if i + 8 > n:
                break
            val = int.from_bytes(data[i:i+8], 'little')
            i += 8
            res.append((field_num, wire_type, val))
        elif wire_type == 2:
            length, i = decode_varint(data, i)
            if i + length > n:
                break
            sub = data[i:i+length]
            i += length
            res.append((field_num, wire_type, sub))
        elif wire_type == 5:
            if i + 4 > n:
                break
            val = int.from_bytes(data[i:i+4], 'little')
            i += 4
            res.append((field_num, wire_type, val))
        else:
            break
    return res

def get_app_quota():
    db_path = r"C:\Users\pri27\AppData\Roaming\Antigravity\User\globalStorage\state.vscdb"
    if not os.path.exists(db_path):
        return None
    
    # Copy to a temporary location to avoid locks
    temp_dir = os.path.join(BRAIN_DIR, "46282598-95f4-462d-b3ae-58248d5e455e", "scratch")
    os.makedirs(temp_dir, exist_ok=True)
    temp_db = os.path.join(temp_dir, "state_temp.vscdb")
    
    try:
        shutil.copy2(db_path, temp_db)
    except Exception as e:
        print(f"Failed to copy DB: {e}")
        return None
        
    try:
        conn = sqlite3.connect(temp_db)
        cursor = conn.cursor()
        
        # 1. Fetch available credits
        cursor.execute("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.modelCredits'")
        row_credits = cursor.fetchone()
        gemini_rem = 100
        gemini_tot = 100
        claude_rem = None
        claude_tot = None
        
        if row_credits:
            data = base64.b64decode(row_credits[0])
            parsed = parse_proto(data)
            for f_num, wt, val in parsed:
                if wt == 2:
                    sub = parse_proto(val)
                    sub_dict = {f[0]: f[2] for f in sub}
                    key_name = sub_dict.get(1, b"").decode('utf-8', errors='ignore')
                    if key_name == "availableCreditsSentinelKey":
                        val_bytes = base64.b64decode(sub_dict.get(2, b""))
                        val_parsed = parse_proto(val_bytes)
                        val_dict = {f[0]: f[2] for f in val_parsed}
                        gemini_rem = val_dict.get(2, 100)

        # 2. Fetch user status (email, name, total limits)
        cursor.execute("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.userStatus'")
        row_status = cursor.fetchone()
        email = ""
        name = ""
        if row_status:
            data = base64.b64decode(row_status[0])
            sub1 = parse_proto(data)
            sub1_dict = {f[0]: f[2] for f in sub1}
            field1_bytes = sub1_dict.get(1)
            if field1_bytes:
                sub2 = parse_proto(field1_bytes)
                sub2_dict = {f[0]: f[2] for f in sub2}
                field2_bytes = sub2_dict.get(2)
                if field2_bytes:
                    sub3 = parse_proto(field2_bytes)
                    sub3_dict = {f[0]: f[2] for f in sub3}
                    b64_bytes = sub3_dict.get(1)
                    if b64_bytes:
                        inner_data = base64.b64decode(b64_bytes)
                        inner_fields = parse_proto(inner_data)
                        
                        for f_num, wt, val in inner_fields:
                            if wt == 2:
                                if f_num == 3:
                                    name = val.decode('utf-8', errors='ignore')
                                elif f_num == 7:
                                    email = val.decode('utf-8', errors='ignore')
                                elif f_num == 36:
                                    try:
                                        f36_proto = parse_proto(val)
                                        for f_num_36, wt_36, val_36 in f36_proto:
                                            if f_num_36 == 14:
                                                f14_proto = parse_proto(val_36)
                                                f14_dict = {f[0]: f[2] for f in f14_proto}
                                                c_type = f14_dict.get(1)
                                                c_rem = f14_dict.get(2)
                                                c_tot = f14_dict.get(3)
                                                if c_type == 1:
                                                    gemini_rem = c_rem if c_rem is not None else gemini_rem
                                                    gemini_tot = c_tot if c_tot is not None else gemini_tot
                                                elif c_type == 2:
                                                    claude_rem = c_rem
                                                    claude_tot = c_tot
                                    except Exception as ex:
                                        print(f"Failed parsing field 36: {ex}")
        conn.close()
        
        # Clean up temp file
        try:
            os.remove(temp_db)
        except:
            pass
            
        gemini_pct = round((gemini_rem / gemini_tot) * 100, 2) if gemini_tot > 0 else 100
        res = {
            "email": email,
            "name": name,
            "remaining": gemini_rem,
            "total": gemini_tot,
            "percentage": gemini_pct,
            "gemini": {
                "remaining": gemini_rem,
                "total": gemini_tot,
                "percentage": gemini_pct
            },
            "claude": None
        }
        
        if claude_rem is not None and claude_tot is not None:
            claude_pct = round((claude_rem / claude_tot) * 100, 2) if claude_tot > 0 else 100
            res["claude"] = {
                "remaining": claude_rem,
                "total": claude_tot,
                "percentage": claude_pct
            }
            
        return res
    except Exception as e:
        print(f"Error reading state DB: {e}")
        try:
            os.remove(temp_db)
        except:
            pass
        return None

@app.route("/api/ide/quota")
def get_ide_quota_endpoint():
    res = get_app_quota()
    if res is None:
        return jsonify({"error": "Antigravity state DB not found or failed to load"}), 404
    return jsonify(res)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/stats")
def get_stats():
    convs = summarize_conversations()
    if not convs:
        return jsonify({
            "total_tokens": 0,
            "gemini_total_tokens": 0,
            "claude_total_tokens": 0,
            "output_tokens": 0,
            "peak_day_tokens": 0,
            "peak_day_date": "N/A",
            "streak": 0,
            "avg_session_mins": 0,
            "recent_30d_tokens": 0,
            "heatmap_orange": {},
            "heatmap_blue": {},
            "top_tools": [],
            "trend_history": []
        })
        
    # Stats aggregation
    total_tokens = sum(c["total_tokens"] for c in convs)
    gemini_total_tokens = sum(c["total_tokens"] for c in convs if c.get("pool") == "gemini")
    claude_total_tokens = sum(c["total_tokens"] for c in convs if c.get("pool") == "thirdparty")
    output_tokens = sum(c["output_tokens"] for c in convs)
    
    # Group by date
    daily_stats = {}
    now = datetime.now()
    cutoff_30d = now - timedelta(days=30)
    recent_30d_tokens = 0
    
    # Pre-populate last 30 days to ensure continuous calendar layout
    for i in range(30):
        d = now - timedelta(days=i)
        day_str = d.strftime("%Y-%m-%d")
        daily_stats[day_str] = {
            "llm_hours": [0] * 24,
            "tool_hours": [0] * 24,
            "total_tokens": 0
        }
        
    for c in convs:
        daily_breakdown = c.get("daily_breakdown", {})
        if not daily_breakdown:
            conv_dt = datetime.fromtimestamp(c["timestamp"])
            day_str = conv_dt.strftime("%Y-%m-%d")
            daily_breakdown = {
                day_str: {
                    "llm_hours": c.get("llm_hours", [0] * 24),
                    "tool_hours": c.get("tool_hours", [0] * 24),
                    "total_tokens": c.get("total_tokens", 0)
                }
            }
            
        for day_str, stats in daily_breakdown.items():
            try:
                day_dt = datetime.strptime(day_str, "%Y-%m-%d")
            except Exception:
                continue
                
            if day_dt >= cutoff_30d:
                recent_30d_tokens += stats.get("total_tokens", 0)
                
            if day_str not in daily_stats:
                daily_stats[day_str] = {
                    "llm_hours": [0] * 24,
                    "tool_hours": [0] * 24,
                    "total_tokens": 0
                }
                
            daily_stats[day_str]["total_tokens"] += stats.get("total_tokens", 0)
            
            c_llm = stats.get("llm_hours", [0] * 24)
            c_tool = stats.get("tool_hours", [0] * 24)
            for h in range(24):
                daily_stats[day_str]["llm_hours"][h] += c_llm[h]
                daily_stats[day_str]["tool_hours"][h] += c_tool[h]

    # Peak day
    peak_day_tokens = 0
    peak_day_date = "N/A"
    for day_str, stats in daily_stats.items():
        if stats["total_tokens"] > peak_day_tokens:
            peak_day_tokens = stats["total_tokens"]
            peak_day_date = day_str
            
    # Streak calculation
    sorted_days = sorted([d for d, s in daily_stats.items() if s["total_tokens"] > 0])
    streak = 0
    if sorted_days:
        current_streak = 1
        max_streak = 1
        for i in range(1, len(sorted_days)):
            d1 = datetime.strptime(sorted_days[i-1], "%Y-%m-%d")
            d2 = datetime.strptime(sorted_days[i], "%Y-%m-%d")
            if (d2 - d1).days == 1:
                current_streak += 1
            elif (d2 - d1).days > 1:
                max_streak = max(max_streak, current_streak)
                current_streak = 1
        max_streak = max(max_streak, current_streak)
        streak = max_streak
        
    avg_session_mins = sum(c["duration_mins"] for c in convs) / len(convs)
    completed_runs = sum(1 for c in convs if c.get("status") == "Completed")
    crashed_runs = sum(1 for c in convs if c.get("status") == "Crashed")
    
    # Format heatmaps for display (chronological order)
    # Heatmaps consist of lists of 24-hr values for the last 25 active days (or 30 calendar days)
    # We will sort the keys so they display top-down (newest or oldest)
    # Standard contribution log shows Day 1 at top, Day 25 at bottom (oldest to newest)
    sorted_all_days = sorted(list(daily_stats.keys()))
    # Limit to last 25 days to match the layout in the image
    display_days = sorted_all_days[-25:] if len(sorted_all_days) >= 25 else sorted_all_days
    
    heatmap_orange = {}
    heatmap_blue = {}
    
    for i, day in enumerate(display_days):
        label = f"DAY {i+1}"
        heatmap_orange[label] = {
            "date": day,
            "values": daily_stats[day]["llm_hours"]
        }
        heatmap_blue[label] = {
            "date": day,
            "values": daily_stats[day]["tool_hours"]
        }
        
    # Aggregate tool calls
    global_tools = {}
    for c in convs:
        for tool_name, stats in c.get("tools", {}).items():
            if tool_name not in global_tools:
                global_tools[tool_name] = {"calls": 0, "errors": 0}
            global_tools[tool_name]["calls"] += stats["calls"]
            global_tools[tool_name]["errors"] += stats["errors"]
            
    sorted_tools = sorted(global_tools.items(), key=lambda x: x[1]["calls"], reverse=True)
    top_tools = []
    for name, stats in sorted_tools[:5]:
        success_rate = 100.0
        if stats["calls"] > 0:
            success_rate = round(((stats["calls"] - stats["errors"]) / stats["calls"]) * 100, 1)
        top_tools.append({
            "name": name,
            "calls": stats["calls"],
            "errors": stats["errors"],
            "success_rate": success_rate
        })
        
    # Trend history (last 30 calendar days chronologically)
    trend_history = []
    for day in sorted_all_days[-30:]:
        trend_history.append({
            "date": day,
            "tokens": daily_stats[day]["total_tokens"]
        })
        
    return jsonify({
        "total_tokens": total_tokens,
        "gemini_total_tokens": gemini_total_tokens,
        "claude_total_tokens": claude_total_tokens,
        "output_tokens": output_tokens,
        "peak_day_tokens": peak_day_tokens,
        "peak_day_date": peak_day_date,
        "streak": streak,
        "avg_session_mins": round(avg_session_mins, 1),
        "recent_30d_tokens": recent_30d_tokens,
        "completed_runs": completed_runs,
        "crashed_runs": crashed_runs,
        "heatmap_orange": heatmap_orange,
        "heatmap_blue": heatmap_blue,
        "top_tools": top_tools,
        "trend_history": trend_history
    })

@app.route("/api/conversations")
def get_conversations():
    return jsonify(summarize_conversations())

@app.route("/api/conversations/<id>")
def get_conversation_details(id):
    steps = get_conversation_data(id)
    if not steps:
        return jsonify({"error": "Conversation not found"}), 404
        
    timeline = []
    subagents = []
    
    # To identify subagent relationships
    uuid_pattern = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    
    for step in steps:
        source = step.get("source")
        step_type = step.get("type")
        status = step.get("status")
        content = step.get("content", "")
        thinking = step.get("thinking", "")
        tool_calls = step.get("tool_calls", [])
        created_at = step.get("created_at")
        
        # Check for subagents spawned
        if "invoke_subagent" in json.dumps(tool_calls) or "invoke_subagent" in content:
            found_uuids = re.findall(uuid_pattern, content)
            for uid in found_uuids:
                if uid != id and uid not in subagents:
                    subagents.append(uid)
                    
        timeline.append({
            "step_index": step.get("step_index", 0),
            "source": source,
            "type": step_type,
            "status": status,
            "created_at": created_at,
            "content": content,
            "thinking": thinking,
            "tool_calls": tool_calls,
            "tokens": estimate_tokens(content) + estimate_tokens(thinking) + estimate_tokens(json.dumps(tool_calls))
        })
        
    return jsonify({
        "id": id,
        "steps": timeline,
        "subagents": subagents
    })


def parse_skill_metadata(file_path):
    desc = "Custom guidelines and rules."
    clean_name = os.path.basename(os.path.dirname(file_path))
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read(1000)
            match = re.search(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
            if match:
                fm_text = match.group(1)
                for line in fm_text.split('\n'):
                    if ':' in line:
                        k, v = line.split(':', 1)
                        k = k.strip().lower()
                        v = v.strip().strip('"').strip("'")
                        if k == "description":
                            desc = v
                        elif k == "name":
                            clean_name = v
        except Exception:
            pass
    return clean_name, desc


SKILLS_CACHE = None

@app.route("/api/rules")
def list_rules():
    global SKILLS_CACHE
    refresh = request.args.get("refresh") == "true"
    if refresh:
        SKILLS_CACHE = None

    global_config_dir = r"C:\Users\pri27\.gemini\config"
    project_agents_dir = os.path.join(".", ".agents")
    
    rules = []
    
    # 1. Global rules
    global_rules_path = os.path.join(global_config_dir, "AGENTS.md")
    rules.append({
        "id": "global_rules",
        "name": "Global Rules (AGENTS.md)",
        "path": os.path.abspath(global_rules_path),
        "exists": os.path.exists(global_rules_path)
    })
    
    # 2. Project rules
    project_rules_path = os.path.join(project_agents_dir, "AGENTS.md")
    rules.append({
        "id": "project_rules",
        "name": "Project Rules (AGENTS.md)",
        "path": os.path.abspath(project_rules_path),
        "exists": os.path.exists(project_rules_path)
    })
    
    # 3. Global & Project skills (cached)
    if SKILLS_CACHE is None:
        from concurrent.futures import ThreadPoolExecutor
        
        skills = []
        
        # A. C:\Users\pri27\.agents\skills (Antigravity global skills)
        global_agents_dir = r"C:\Users\pri27\.agents"
        global_skills_glob = os.path.join(global_agents_dir, "skills", "*", "SKILL.md")
        global_files = glob.glob(global_skills_glob)
        
        # B. .agents\skills (Project skills)
        project_skills_glob = os.path.join(project_agents_dir, "skills", "*", "SKILL.md")
        project_files = glob.glob(project_skills_glob)
        
        # Combine
        all_skill_files = [(fp, "global") for fp in global_files] + [(fp, "project") for fp in project_files]
        
        def process_skill_file(item):
            fp, scope = item
            skill_name = os.path.basename(os.path.dirname(fp))
            clean_name, desc = parse_skill_metadata(fp)
            return {
                "id": f"{scope}_skill_{skill_name}",
                "name": f"{scope.capitalize()} Skill: {clean_name} (SKILL.md)",
                "path": os.path.abspath(fp),
                "exists": True,
                "skill_handle": skill_name,
                "description": desc
            }
            
        if all_skill_files:
            with ThreadPoolExecutor(max_workers=32) as executor:
                skills = list(executor.map(process_skill_file, all_skill_files))
                
        # C. C:\Users\pri27\.gemini\config\plugins (Plugins)
        global_plugins_dir = r"C:\Users\pri27\.gemini\config\plugins"
        if os.path.exists(global_plugins_dir):
            for entry in os.listdir(global_plugins_dir):
                entry_path = os.path.join(global_plugins_dir, entry)
                if os.path.isdir(entry_path):
                    plugin_json_path = os.path.join(entry_path, "plugin.json")
                    plugin_name = entry
                    plugin_desc = "Curated plugin guidelines."
                    if os.path.exists(plugin_json_path):
                        try:
                            with open(plugin_json_path, "r", encoding="utf-8") as f:
                                pj_data = json.load(f)
                            plugin_name = pj_data.get("name", entry)
                            plugin_desc = pj_data.get("description", plugin_desc)
                        except Exception:
                            pass
                    skills.append({
                        "id": f"plugin_skill_{entry}",
                        "name": f"Plugin Skill: {plugin_name} (plugin.json)",
                        "path": os.path.abspath(plugin_json_path if os.path.exists(plugin_json_path) else entry_path),
                        "exists": True,
                        "skill_handle": entry,
                        "description": plugin_desc
                    })
        SKILLS_CACHE = skills
        
    rules.extend(SKILLS_CACHE)
    return jsonify(rules)


@app.route("/api/rules/load")
def load_rule_file():
    path = request.args.get("path")
    if not path:
        return jsonify({"error": "Path parameter is required"}), 400
        
    abs_path = os.path.abspath(path)
    allowed = False
    
    global_config_dir = os.path.abspath(r"C:\Users\pri27\.gemini\config")
    workspace_dir = os.path.abspath(".")
    
    if abs_path.startswith(global_config_dir) or abs_path.startswith(workspace_dir):
        allowed = True
        
    if not allowed:
        return jsonify({"error": "Access denied"}), 403
        
    if not os.path.exists(abs_path):
        if abs_path.endswith("AGENTS.md"):
            return jsonify({
                "content": "# Custom Rules\n\n- Prefer clean formatting\n- Move dynamic variables to the end of prompts",
                "exists": False
            })
        return jsonify({"content": "", "exists": False})
        
    try:
        with open(abs_path, "r", encoding="utf-8") as f:
            content = f.read()
        return jsonify({"content": content, "exists": True})
    except Exception as e:
        return jsonify({"error": f"Failed to read file: {str(e)}"}), 500


@app.route("/api/rules/save", methods=["POST"])
def save_rule_file():
    data = request.json or {}
    path = data.get("path")
    content = data.get("content")
    
    if not path or content is None:
        return jsonify({"error": "Path and content are required"}), 400
        
    abs_path = os.path.abspath(path)
    allowed = False
    
    global_config_dir = os.path.abspath(r"C:\Users\pri27\.gemini\config")
    workspace_dir = os.path.abspath(".")
    
    if abs_path.startswith(global_config_dir) or abs_path.startswith(workspace_dir):
        allowed = True
        
    if not allowed:
        return jsonify({"error": "Access denied"}), 403
        
    try:
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(content)
        return jsonify({"status": "success", "path": abs_path})
    except Exception as e:
        return jsonify({"error": f"Failed to save file: {str(e)}"}), 500


@app.route("/api/phases")
def get_phases():
    project_agents_dir = os.path.join(".", ".agents")
    phases_file = os.path.join(project_agents_dir, "phases.json")
    
    if os.path.exists(phases_file):
        try:
            with open(phases_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                return jsonify(data)
        except Exception as e:
            return jsonify({"error": f"Failed to read phases: {str(e)}"}), 500
            
    # Otherwise, return default templates
    general_content = "# General Rules\n\n- Prefer clean formatting\n- Move dynamic variables to the end of prompts"
    project_rules_path = os.path.join(project_agents_dir, "AGENTS.md")
    if os.path.exists(project_rules_path):
        try:
            with open(project_rules_path, "r", encoding="utf-8") as f:
                general_content = f.read()
        except:
            pass
            
    default_phases = [
        {
            "name": "General",
            "enabled": True,
            "content": general_content
        },
        {
            "name": "Phase 1",
            "enabled": True,
            "content": "# Phase 1 Rules\n\n- Write phase instructions here..."
        }
    ]
    return jsonify(default_phases)


@app.route("/api/phases", methods=["POST"])
def save_phases():
    data = request.json or []
    project_agents_dir = os.path.join(".", ".agents")
    os.makedirs(project_agents_dir, exist_ok=True)
    
    phases_file = os.path.join(project_agents_dir, "phases.json")
    try:
        with open(phases_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        # Also compile enabled phases and write to .agents/AGENTS.md
        compiled_parts = []
        for phase in data:
            if phase.get("enabled", False) and phase.get("content", "").strip():
                compiled_parts.append(phase["content"].strip())
                
        compiled_rules = "\n\n".join(compiled_parts)
        
        project_rules_path = os.path.join(project_agents_dir, "AGENTS.md")
        with open(project_rules_path, "w", encoding="utf-8") as f:
            f.write(compiled_rules)
            
        return jsonify({"status": "success", "path": phases_file, "agents_path": project_rules_path})
    except Exception as e:
        return jsonify({"error": f"Failed to save phases: {str(e)}"}), 500


@app.route("/api/phases/export_skill", methods=["POST"])
def export_phase_to_skill():
    global SKILLS_CACHE
    data = request.json or {}
    name = data.get("name")
    content = data.get("content", "")
    
    if not name or not content.strip():
        return jsonify({"error": "Name and content are required"}), 400
        
    # Generate skill handle (e.g., "Phase 1" -> "phase-1")
    skill_handle = re.sub(r'[^a-zA-Z0-9\-]', '', name.lower().replace(' ', '-'))
    skill_handle = re.sub(r'-+', '-', skill_handle).strip('-')
    
    if not skill_handle:
        skill_handle = "custom-phase"
        
    project_agents_dir = os.path.join(".", ".agents")
    skill_dir = os.path.join(project_agents_dir, "skills", skill_handle)
    os.makedirs(skill_dir, exist_ok=True)
    
    skill_file = os.path.join(skill_dir, "SKILL.md")
    
    skill_content = f"""---
name: {name}
description: Reusable guidelines exported from {name}.
---

{content.strip()}
"""
    try:
        with open(skill_file, "w", encoding="utf-8") as f:
            f.write(skill_content)
            
        SKILLS_CACHE = None
        return jsonify({
            "status": "success",
            "skill_handle": skill_handle,
            "path": skill_file
        })
    except Exception as e:
        return jsonify({"error": f"Failed to export skill: {str(e)}"}), 500


@app.route("/api/workspace/files")
def get_workspace_files():
    exclude_dirs = ['.git', 'node_modules', '__pycache__', '.gemini', '.agents']
    files_list = []
    
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for file in files:
            if file.endswith(('.py', '.js', '.css', '.html', '.json', '.md', '.sql', '.txt', '.sh', '.ps1')):
                file_path = os.path.join(root, file)
                try:
                    size = os.path.getsize(file_path)
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                    tokens = estimate_tokens(content)
                    rel_path = os.path.relpath(file_path, '.')
                    files_list.append({
                        "path": rel_path.replace('\\', '/'),
                        "size_bytes": size,
                        "tokens": tokens
                    })
                except Exception:
                    continue
                    
    files_list.sort(key=lambda x: x['tokens'], reverse=True)
    return jsonify(files_list)


if __name__ == "__main__":
    print("Starting Antigravity Usage Log Dashboard server at http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)
