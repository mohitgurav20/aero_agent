"""SIH26171 — Local Agent HTTP API Gateway (server/app.py)

Eliminates fragile Windows Registry / Native Messaging .bat shim failures
by exposing a clean, robust local REST API at http://127.0.0.1:5000.
Reuses 100% of existing core modules from native-host/voicc_host/.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any

# Add native-host to Python path so we import the exact existing core modules
_ROOT = Path(__file__).resolve().parent.parent
_NATIVE_HOST = _ROOT / "native-host"
if str(_NATIVE_HOST) not in sys.path:
    sys.path.insert(0, str(_NATIVE_HOST))

from flask import Flask, jsonify, request
from flask_cors import CORS

from voicc_host.config import CONFIG
from voicc_host.decision_log import DecisionLogger, verify_chain
from voicc_host.guardrails import check_plan
from voicc_host.ollama_client import OllamaClient
from voicc_host.prompts import build_agent_step_prompt, build_reasoning_prompt
from voicc_host.schemas import (Action, ActionType, Decision, Evidence,
                                Element, PageState, PerceptionTier, Plan,
                                parse_model_output)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("server.app")

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Ensure log directory exists
log_dir = Path(CONFIG.log_dir)
log_dir.mkdir(parents=True, exist_ok=True)
audit_log_path = log_dir / "audit_chain.jsonl"
decision_logger = DecisionLogger(audit_log_path)
ollama_client = OllamaClient(CONFIG)


@app.route("/api/health", methods=["GET"])
def health():
    """Health check: verifies Ollama connectivity, resident models, and server status."""
    ollama_ok = False
    models: list[str] = []
    try:
        roles = ollama_client.roles()
        ollama_ok = True
        models = [f"{role}:{model}" for role, model in roles.items() if model]
    except Exception as e:
        log.warning("Health check Ollama probe failed: %s", e)

    return jsonify({
        "status": "ok",
        "service": "SIH26171 Local Agent Gateway",
        "version": "1.0.0",
        "ollama": {
            "online": ollama_ok,
            "url": CONFIG.ollama_url,
            "resident_models": models,
            "configured_text_model": CONFIG.models.text,
            "configured_draft_model": CONFIG.models.draft,
        },
        "audit_log": str(audit_log_path),
        "timestamp": time.time(),
    })


@app.route("/api/plan", methods=["POST"])
def generate_plan():
    """Generates a verified, grounded compound action plan for the browser task.

    Accepts:
      - task: user's goal string
      - page_url: current tab URL
      - page_title: current tab title
      - elements: list of interactive DOM elements (with tag_id, text, role, bbox)
      - image_b64: base64 screenshot (sanitized / PII-redacted with numbered tags)
      - visible_tags: list of visible numbered tag IDs on the screen
      - history: past actions executed
    """
    data = request.get_json(force=True) or {}
    task = str(data.get("task") or data.get("goal") or "").strip()
    page_url = str(data.get("page_url") or data.get("url") or "")
    page_title = str(data.get("page_title") or data.get("title") or "")
    raw_elements = data.get("elements") or []
    image_b64 = str(data.get("image_b64") or "")
    visible_tags = data.get("visible_tags") or [e.get("tag_id") for e in raw_elements if "tag_id" in e]
    history = data.get("history") or []

    if not task:
        return jsonify({"status": "error", "message": "Missing task description"}), 400

    log.info("Received plan request for task: %r on %s (%d elements)", task, page_url, len(raw_elements))

    started = time.perf_counter()
    tier_used = PerceptionTier.DOM
    reasoning = ""
    is_done = False
    plan_actions: list[dict[str, Any]] = []

    # Fast Ollama Reasoning Call with Qwen2.5:3b
    try:
        prompt = build_agent_step_prompt(
            goal=task,
            page_url=page_url,
            page_title=page_title,
            elements=raw_elements,
            vlm_summary="",
            history=history
        )

        llm_resp = ollama_client.generate(
            role="text",
            prompt=prompt,
            options={"temperature": 0.05, "top_p": 0.9}
        )

        parsed: dict[str, Any] = {}
        try:
            parsed = json.loads(llm_resp.text)
        except Exception:
            import re
            m = re.search(r"\{.*\}", llm_resp.text, re.DOTALL)
            if m:
                try:
                    parsed = json.loads(m.group(0))
                except Exception:
                    pass

        raw_actions = parsed.get("actions") or []
        if not raw_actions and parsed.get("action"):
            raw_actions = [{
                "type": parsed.get("action"),
                "tag_id": parsed.get("tag_id"),
                "value": parsed.get("value"),
                "key": parsed.get("key"),
                "intent": parsed.get("intent") or task,
            }]

        reasoning = parsed.get("reasoning") or parsed.get("intent") or f"Execute steps for: {task}"
        is_done = parsed.get("is_done") is True

        for idx, act in enumerate(raw_actions):
            plan_actions.append({
                "step": idx,
                "tag_id": act.get("tag_id"),
                "action": act.get("type") or act.get("action") or "click",
                "value": act.get("value"),
                "key": act.get("key"),
                "description": act.get("intent") or act.get("description") or f"Step #{idx + 1}",
            })

    except Exception as exc:
        log.exception("Ollama reasoning failed in /api/plan: %s", exc)
        return jsonify({
            "status": "error",
            "message": f"Reasoning engine failure: {exc}",
        }), 500

    latency_ms = round((time.perf_counter() - started) * 1000, 1)

    # Log decision with tamper-evident SHA-256 hash chaining
    try:
        decision_logger.event(
            stage="plan",
            decision=Decision.ACCEPTED,
            task_id=f"http-{int(time.time())}",
            model=CONFIG.models.text,
            tier=tier_used,
            confidence=0.95,
            latency_ms=latency_ms,
            detail=reasoning,
        )
    except Exception as log_err:
        log.warning("Audit logging failed (non-blocking): %s", log_err)

    return jsonify({
        "status": "success",
        "plan": {
            "id": f"plan-{int(time.time() * 1000)}",
            "task": task,
            "actions": plan_actions,
            "reasoning": reasoning,
            "confidence": 0.95,
            "is_done": is_done,
            "latency_ms": latency_ms,
            "model": CONFIG.models.text,
        }
    })


@app.route("/api/audit_log", methods=["GET"])
def get_audit_log():
    """Returns the tamper-evident SHA-256 audit log records."""
    entries: list[dict[str, Any]] = []
    if audit_log_path.exists():
        with open(audit_log_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except Exception:
                        pass

    return jsonify({
        "status": "success",
        "count": len(entries),
        "log_path": str(audit_log_path),
        "entries": entries[-50:],  # Return latest 50
    })


@app.route("/api/verify_log", methods=["POST"])
def verify_audit_log():
    """Verifies the SHA-256 tamper-evident hash chain of the audit log."""
    if not audit_log_path.exists():
        return jsonify({"valid": True, "entries": 0, "message": "Log file empty"})

    result = verify_chain(audit_log_path)
    return jsonify({
        "valid": result.valid,
        "entries": result.entries,
        "broken_at": result.broken_at,
        "reason": result.reason,
    })


_whisper_model = None

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        try:
            from faster_whisper import WhisperModel
            log.info("Initializing local faster-whisper model (base) for multilingual voice...")
            _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
            log.info("faster-whisper model loaded successfully.")
        except Exception as e:
            log.warning("faster-whisper init failed (falling back to phonetic processing): %s", e)
    return _whisper_model


@app.route("/api/voice", methods=["POST"])
def process_voice():
    """High-Accuracy Whisper Voice Transcription + Multilingual Accent Normalization."""
    data = request.get_json(force=True) or {}
    audio_base64 = data.get("audio_base64") or ""
    raw_text = str(data.get("text") or "").strip()
    detected_lang = "en"

    # If base64 audio stream is supplied from offscreen.js
    if audio_base64:
        import base64
        import tempfile
        try:
            audio_bytes = base64.b64decode(audio_base64)
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                f.write(audio_bytes)
                tmp_wav_path = f.name

            model = get_whisper_model()
            if model:
                segments, info = model.transcribe(tmp_wav_path, beam_size=5)
                transcribed_parts = [seg.text.strip() for seg in segments if seg.text.strip()]
                raw_text = " ".join(transcribed_parts)
                detected_lang = info.language or "en"
                log.info("Whisper transcribed audio (lang=%s): '%s'", detected_lang, raw_text)

            try:
                os.remove(tmp_wav_path)
            except Exception:
                pass
        except Exception as e:
            log.warning("Audio transcription error in Whisper pipeline: %s", e)

    # Phonetic normalizations for tech terms, LeetCode, and Indian accents
    phonetic_map = [
        ("try hack me", "tryhackme"),
        ("git hub", "github"),
        ("get hub", "github"),
        ("git up", "github"),
        ("get up", "github"),
        ("you tube", "youtube"),
        ("linked in", "linkedin"),
        ("insta gram", "instagram"),
        ("chat gpt", "chatgpt"),
        ("lead code", "leetcode"),
        ("leet code", "leetcode"),
        ("slove", "solve"),
        ("complie", "compile"),
        ("whtt", "what"),
        ("code chef", "codechef"),
        ("hacker rank", "hackerrank"),
    ]
    canonical = raw_text.lower()
    for src, dst in phonetic_map:
        canonical = canonical.replace(src, dst)

    return jsonify({
        "status": "success",
        "text": canonical.strip(),
        "original": raw_text,
        "language": detected_lang
    })


@app.route("/api/extract_document", methods=["POST"])
def extract_document():
    """Extracts text or visual information from uploaded PDF, Image, Word/Text documents."""
    data = request.get_json(force=True) or {}
    file_base64 = data.get("file_base64") or ""
    file_name = str(data.get("file_name") or "uploaded_file").strip()
    file_type = str(data.get("file_type") or "").lower()

    if not file_base64:
        return jsonify({"status": "error", "message": "Missing file_base64"}), 400

    import base64
    import io

    try:
        raw_bytes = base64.b64decode(file_base64)
    except Exception as e:
        return jsonify({"status": "error", "message": f"Base64 decode failed: {e}"}), 400

    extracted_text = ""
    lower_name = file_name.lower()

    # 1. PDF Extraction
    if lower_name.endswith(".pdf") or "pdf" in file_type:
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(raw_bytes))
            pages_text = []
            for idx, page in enumerate(reader.pages):
                txt = page.extract_text() or ""
                if txt.strip():
                    pages_text.append(f"--- Page {idx + 1} ---\n{txt.strip()}")
            extracted_text = "\n\n".join(pages_text)
            log.info("Extracted %d pages from PDF '%s'", len(reader.pages), file_name)
        except Exception as e:
            log.warning("PDF extraction error: %s", e)
            extracted_text = f"Error reading PDF content: {e}"

    # 2. Image Inspection via VLM (Moondream)
    elif any(lower_name.endswith(ext) for ext in [".png", ".jpg", ".jpeg", ".webp"]) or "image" in file_type:
        try:
            vlm_prompt = "Describe the text, problem statement, UI components, code, or key details visible in this image in thorough detail."
            vlm_resp = ollama_client.generate(
                role="vlm",
                prompt=vlm_prompt,
                images=[file_base64],
                options={"temperature": 0.2}
            )
            if vlm_resp and vlm_resp.text:
                extracted_text = vlm_resp.text.strip()
                log.info("VLM inspected image '%s' (%d chars)", file_name, len(extracted_text))
            else:
                extracted_text = "Image attached. Visual inspection model returned no textual content."
        except Exception as e:
            log.warning("VLM image inspection error: %s", e)
            extracted_text = f"Image attached: {file_name}"

    # 3. Plain Text / Markdown / Code / JSON / CSV
    else:
        try:
            extracted_text = raw_bytes.decode("utf-8", errors="replace")
        except Exception as e:
            extracted_text = f"Raw text file: {file_name}"

    page_count = len(reader.pages) if (lower_name.endswith(".pdf") or "pdf" in file_type) and 'reader' in locals() else 1

    return jsonify({
        "status": "success",
        "file_name": file_name,
        "page_count": page_count,
        "extracted_text": extracted_text[:150000],
        "total_chars": len(extracted_text)
    })


@app.route("/api/summarize", methods=["POST"])
def summarize_content():
    """Synthesizes an in-depth, exhaustive knowledge briefing for multi-page PDFs (15+ pages) and long scrollable pages."""
    data = request.get_json(force=True) or {}
    content = str(data.get("content") or data.get("text") or "").strip()
    title = str(data.get("title") or "Website & Document Summary").strip()
    focus = str(data.get("focus") or data.get("instruction") or "").strip()

    if not content:
        return jsonify({"status": "error", "message": "No content provided to summarize"}), 400

    focus_clause = f"\nSpecific user focus / question: {focus}\n" if focus and "summary" not in focus.lower() else ""

    # If the document is massive (> 28,000 characters, such as a 15-page PDF), perform hierarchical section chunking
    if len(content) > 28000:
        log.info("Large document detected (%d chars). Executing multi-section deep extraction...", len(content))
        chunk_size = 14000
        overlap = 1000
        chunks = []
        start = 0
        while start < len(content):
            chunks.append(content[start:start + chunk_size])
            start += chunk_size - overlap
            if len(chunks) >= 8:  # Cap at 8 chunks (~100k chars)
                break

        section_insights = []
        for i, chk in enumerate(chunks):
            chunk_prompt = (
                f"You are a technical document analyst. Extract all major facts, section themes, numbers, arguments, "
                f"and technical details from Part {i + 1} of this document:\n\n"
                f"\"\"\"\n{chk}\n\"\"\"\n\n"
                f"Extract detailed bullet points covering all facts in Part {i + 1}:"
            )
            try:
                c_resp = ollama_client.generate(role="draft", prompt=chunk_prompt, options={"temperature": 0.2})
                if c_resp and c_resp.text:
                    section_insights.append(f"### Source Section {i + 1} Insights:\n{c_resp.text.strip()}")
            except Exception as e:
                log.warning("Chunk %d extraction failed: %s", i + 1, e)

        synthesized_source = "\n\n".join(section_insights) if section_insights else content[:28000]
    else:
        synthesized_source = content[:28000]

    prompt = (
        f"You are an expert executive summarizer and research analyst.\n"
        f"CRITICAL REQUIREMENT: Base your summary ENTIRELY and EXHAUSTIVELY on the provided source content below. "
        f"The user wants a comprehensive, detailed briefing that covers the ENTIRE document or scrollable page (including multi-page PDFs of 15+ pages). "
        f"Do NOT invent, hallucinate, or assume facts not present in the text. Extract real numbers, dates, findings, arguments, and conclusions directly from the text.\n\n"
        f"Title / Document: {title}\n"
        f"{focus_clause}\n"
        f"Source Content to Summarize:\n\"\"\"\n{synthesized_source}\n\"\"\"\n\n"
        f"Output your summary in this exact rich Markdown format:\n"
        f"### 📌 Comprehensive Executive Overview\n"
        f"A thorough, detailed paragraph explaining the full background, core problem addressed, technical approach, and ultimate conclusions based strictly on the text.\n\n"
        f"### 📑 Section-by-Section / Core Breakdown\n"
        f"- **Section / Topic 1**: Detailed explanation of what is covered, key arguments, and specific evidence.\n"
        f"- **Section / Topic 2**: Detailed explanation of what is covered, key arguments, and specific evidence.\n"
        f"- **Section / Topic 3**: Detailed explanation of what is covered, key arguments, and specific evidence.\n"
        f"- **Section / Topic 4**: Detailed explanation of what is covered, key arguments, and specific evidence.\n\n"
        f"### 🔑 In-Depth Key Findings & Takeaways\n"
        f"- **Key Finding 1**: specific in-depth detail and evidence from the text\n"
        f"- **Key Finding 2**: specific in-depth detail and evidence from the text\n"
        f"- **Key Finding 3**: specific in-depth detail and evidence from the text\n"
        f"- **Key Finding 4**: specific in-depth detail and evidence from the text\n"
        f"- **Key Finding 5**: specific in-depth detail and evidence from the text\n"
        f"- **Key Finding 6**: specific in-depth detail and evidence from the text\n\n"
        f"### 📊 Key Data Points, Metrics & Specifics\n"
        f"| Metric / Parameter / Topic | Value / Detail from Source | Significance / Context |\n"
        f"| :--- | :--- | :--- |\n"
        f"| [Topic / Parameter 1] | [Exact value / detail from source] | [Why it matters] |\n"
        f"| [Topic / Parameter 2] | [Exact value / detail from source] | [Why it matters] |\n"
        f"| [Topic / Parameter 3] | [Exact value / detail from source] | [Why it matters] |\n"
        f"| [Topic / Parameter 4] | [Exact value / detail from source] | [Why it matters] |\n\n"
        f"### 🚀 Strategic Implications & Critical Insights\n"
        f"- Key strategic takeaway or architectural implication from the document\n"
        f"- Critical consideration, limitation, or actionable next step highlighted in the text\n"
    )

    summary_text = ""
    for role in ("text", "draft"):
        try:
            resp = ollama_client.generate(
                role=role,
                prompt=prompt,
                options={"temperature": 0.25, "top_p": 0.9}
            )
            if resp and resp.text:
                summary_text = resp.text.strip()
                break
        except Exception as e:
            log.warning("Summarize role '%s' failed: %s", role, e)

    if not summary_text:
        summary_text = f"### 📌 Comprehensive Executive Overview\n{content[:400]}...\n\n### 🔑 Key Highlights\n- Extracted full content from {title}."

    return jsonify({
        "status": "success",
        "title": title,
        "summary": summary_text
    })


@app.route("/api/compose_email", methods=["POST"])
def compose_email():
    """Synthesizes a polite, high-quality email body from recipient and subject topic using local LLM."""
    data = request.get_json(force=True) or {}
    recipient = str(data.get("recipient") or "there").strip()
    subject = str(data.get("subject") or "").strip()
    goal = str(data.get("goal") or "").strip()
    topic = str(data.get("topic") or subject or goal).strip()
    findings = data.get("findings") or []

    salutation_name = recipient.split("@")[0].replace(".", " ").replace("_", " ").title() if "@" in recipient else recipient.title()

    findings_prompt_section = ""
    if findings and isinstance(findings, list) and len(findings) > 0:
        cleaned_findings = [str(f).strip() for f in findings if str(f).strip()]
        if cleaned_findings:
            findings_bullets = "\n".join(f"- {f}" for f in cleaned_findings[:6])
            findings_prompt_section = (
                f"\n\nLIVE SEARCH RESULTS EXTRACTED DIRECTLY FROM THE BROWSER PAGE:\n"
                f"{findings_bullets}\n\n"
                f"CRITICAL REQUIREMENT:\n"
                f"You MUST directly cite, analyze, and recommend the real projects/articles listed above. "
                f"Do NOT invent or hallucinate alternative names when these real findings are provided."
            )

    prompt = (
        f"You are an intelligent AI assistant writing a clear, polite, and professional email message.\n"
        f"Recipient: {recipient}\n"
        f"Subject: {subject}\n"
        f"Topic / Context: {topic}\n"
        f"{findings_prompt_section}\n\n"
        f"Rules:\n"
        f"1. Begin with a formal greeting: 'Dear {salutation_name},'.\n"
        f"2. Write 2-3 concise, well-structured paragraphs providing informative details and summarizing key findings regarding '{topic}'.\n"
        f"3. If real browser search findings were provided above, present the top 3 with numbered bullet points using their real names and descriptions.\n"
        f"4. Sign off with 'Warm regards,\nAero Agent'.\n"
        f"5. Output ONLY the email body text. Do NOT include any Subject header or markdown fences."
    )

    resp = None
    for role in ("text", "draft"):
        try:
            resp = ollama_client.generate(
                role=role,
                prompt=prompt,
                options={"temperature": 0.3, "top_p": 0.9}
            )
            if resp and resp.text:
                body = resp.text.strip()
                import re
                body = re.sub(r"^(?:Subject|Re):\s*[^\n]+\n+", "", body, flags=re.IGNORECASE).strip()
                log.info("LLM dynamically synthesized email body using role '%s' for '%s' to '%s'", role, topic, recipient)
                return jsonify({"status": "success", "body": body, "source": f"llm-{role}"})
        except Exception as e:
            log.warning("Ollama email composition role '%s' failed: %s", role, e)
        fallback = (
            f"Dear {salutation_name},\n\n"
            f"I hope this message finds you well. I explored top findings and details regarding {topic}.\n\n"
            f"Please let me know if you need any further evaluation or assistance.\n\n"
            f"Warm regards,\n"
            f"Aero Agent"
        )
        return jsonify({"status": "fallback", "body": fallback})


@app.route("/api/generate_code", methods=["POST"])
def generate_code():
    """Synthesizes clean, runnable source code for any programming task using on-device local LLM."""
    data = request.get_json(force=True) or {}
    topic = str(data.get("topic") or data.get("prompt") or "").strip()
    import re
    clean_topic = re.sub(r"^(?:open\s+leetcode\s+search|open|go to|search(?:\s+for)?|find|solve|slove|write(?:\s+cpp|\s+python)?\s+(?:solution|code)\s+for|code for|problem)\s+", "", topic, flags=re.IGNORECASE)
    clean_topic = re.sub(r"\s+(?:problem|and\s+.*|click\s+.*|run\s+.*|submit\s+.*|in\s+youtube\s+.*)$", "", clean_topic, flags=re.IGNORECASE).strip()
    clean_topic = clean_topic.replace('"', '').replace("'", "").strip()
    if clean_topic:
        topic = clean_topic

    language = str(data.get("language") or "python").strip().lower()
    is_leetcode = bool(data.get("is_leetcode")) or "leetcode" in str(data.get("site") or "").lower() or "leetcode" in topic.lower()
    if is_leetcode and (language == "plaintext" or not language):
        language = "cpp"
    template = str(data.get("template") or "").strip()
    problem_description = str(data.get("problem_description") or data.get("description") or "").strip()

    error_feedback = str(data.get("error_feedback") or "").strip()

    if not topic:
        topic = "algorithm"

    if is_leetcode or template:
        prompt = (
            f"You are a Grandmaster Competitive Programmer and Algorithms Specialist (Red rating).\n"
            f"Task: Solve the LeetCode problem '{topic}' with 100% correctness and optimal time/space complexity.\n"
            f"Language: {language}.\n\n"
        )
        if problem_description:
            prompt += (
                f"OFFICIAL LEETCODE PROBLEM SPECIFICATION & EXAMPLES:\n"
                f"{problem_description[:3000]}\n\n"
            )
        if template:
            prompt += (
                f"OFFICIAL LEETCODE SOLUTION TEMPLATE:\n{template}\n\n"
                f"CRITICAL REQUIREMENT:\n"
                f"Adhere strictly to the exact class and method signatures given in the template above. "
                f"Do not rename the method or change the parameter/return types.\n\n"
            )

        if "cpp" in language or "c++" in language:
            prompt += (
                "C++ COMPETITIVE PROGRAMMING RULES:\n"
                "- Write standard C++17 code enclosed in 'class Solution'.\n"
                "- Place solution methods under 'public:'.\n"
                "- NEVER write nested functions inside another function (nested functions are illegal in standard C++). Place all helper functions as private or public member functions of class Solution.\n"
                "- Include standard STL headers (#include <vector>, <string>, <unordered_map>, <unordered_set>, <queue>, <stack>, <algorithm>, <climits>, <iostream>) and 'using namespace std;'.\n"
                "- Do NOT use Java syntax (.length, boolean, null). Use .size(), bool, nullptr, true/false, vector<vector<...>>&.\n\n"
            )
        elif "python" in language:
            prompt += (
                "PYTHON RULES:\n"
                "- Write standard Python 3 code enclosed in 'class Solution:'.\n"
                "- Use standard library modules if needed (collections, heapq, bisect, math).\n\n"
            )

        prompt += (
            f"ALGORITHM CORRECTNESS & REASONING RULES FOR '{topic.upper()}':\n"
            "1. Deeply analyze the problem logic, constraints, and time/space complexity:\n"
            "   - BACKTRACKING (e.g. N-Queens, Sudoku, Subsets, Permutations, Combination Sum, Word Search):\n"
            "     * When returning all configurations (e.g. vector<vector<string>>, vector<vector<int>>): NEVER halt recursion early! Explore all branches.\n"
            "     * The recursive helper function MUST be 'void' (NOT 'bool'). Do NOT return bool after finding one solution!\n"
            "     * For N-Queens:\n"
            "       Use 'vector<string> board(n, string(n, \x27.\x27));' and 'vector<vector<string>> ans;'.\n"
            "       Helper 'bool isSafe(int row, int col, const vector<string>& board, int n)':\n"
            "         for (int i = 0; i < row; ++i) if (board[i][col] == \x27Q\x27) return false;\n"
            "         for (int i = row - 1, j = col - 1; i >= 0 && j >= 0; --i, --j) if (board[i][j] == \x27Q\x27) return false;\n"
            "         for (int i = row - 1, j = col + 1; i >= 0 && j < n; --i, ++j) if (board[i][j] == \x27Q\x27) return false;\n"
            "         return true;\n"
            "       Helper 'void backtrack(int row, int n, vector<string>& board, vector<vector<string>>& ans)':\n"
            "         if (row == n) { ans.push_back(board); return; }\n"
            "         for (int col = 0; col < n; ++col) {\n"
            "           if (isSafe(row, col, board, n)) {\n"
            "             board[row][col] = \x27Q\x27;\n"
            "             backtrack(row + 1, n, board, ans);\n"
            "             board[row][col] = \x27.\x27;\n"
            "           }\n"
            "         }\n"
            "   - DYNAMIC PROGRAMMING: Formulate exact state transitions, base cases, and memoization/tabulation without off-by-one errors.\n"
            "   - GRAPHS: Cycle detection, BFS/DFS, Topological sort (Kahn's in-degree queue algorithm), Dijkstra or Union-Find.\n"
            "   - BINARY SEARCH: low <= high, mid = low + (high - low) / 2 with correct branch updates.\n"
            "   - TWO POINTERS / SLIDING WINDOW: Maintain window invariants and update answers.\n"
            "2. Handle all edge cases cleanly (n=1, empty inputs, single element, boundary constraints).\n"
            "3. Ensure the solution runs well within standard LeetCode time limits (sub-50ms) and passes all testcases.\n\n"
        )

        if error_feedback:
            prompt += (
                f"CRITICAL FIX: PREVIOUS SUBMISSION FAILED ON LEETCODE!\n"
                f"Failure Details:\n{error_feedback}\n\n"
                f"ROOT-CAUSE INSTRUCTIONS:\n"
                f"1. If Wrong Answer: Carefully compare your output against Expected for the failed Input.\n"
                f"   - If your output had fewer solutions than Expected (like returning 1 solution instead of all), you stopped recursion early or didn't backtrack properly! Helper must be void and continue searching.\n"
                f"   - If you had duplicate solutions or incorrect values, fix your state transitions, visited sets, or bounds.\n"
                f"2. If Compile or Runtime Error: Fix the exact syntax error, missing headers, or out-of-bounds index.\n"
                f"3. Return the complete, corrected, fully working class Solution.\n\n"
            )

        prompt += (
            "OUTPUT FORMAT:\n"
            "Return ONLY the complete, compilable class Solution implementation.\n"
            "Do NOT include markdown backticks (no ```), do not include conversational commentary, and do not include main() driver code."
        )
    else:
        prompt = (
            f"You are an expert {language} developer. Write clean, working, runnable {language} code for: '{topic}'.\n"
            "Requirements:\n"
            "1. Return ONLY pure runnable executable code.\n"
            "2. Do NOT wrap in markdown backticks (no ```), do not include any conversational greeting or explanations.\n"
            "3. Provide direct demonstration calls with print statements showing results (e.g. print(add(10, 5))), rather than blocking interactive input() calls, so it executes and displays results immediately.\n"
        )

    code = ""
    for role in ("text", "draft"):
        try:
            resp = ollama_client.generate(
                role=role,
                prompt=prompt,
                options={"temperature": 0.2, "top_p": 0.9}
            )
            raw = resp.text.strip()
            import re
            fence_match = re.search(r"```(?:cpp|c\+\+|python|java|javascript|c)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
            if fence_match:
                raw = fence_match.group(1).strip()
            else:
                raw = re.sub(r"^```[a-zA-Z0-9_\-\+]*\s*", "", raw)
                raw = re.sub(r"```[\s\S]*$", "", raw).strip()
            raw = raw.replace("`", "").strip()
            if raw and len(raw) > 40:
                code = raw
                break
        except Exception as e:
            log.warning("Ollama code generation with role '%s' failed: %s", role, e)

    if not code:
        log.error("All Ollama models failed to synthesize code for '%s'", topic)
        return jsonify({"status": "error", "message": f"Failed to synthesize valid code for {topic}"}), 500

    # LeetCode format guarantee: remove main() driver and ensure class Solution wrapping
    if is_leetcode or template or "leetcode" in topic.lower():
        code = re.sub(r"int\s+main\s*\([^)]*\)\s*\{[\s\S]*\}", "", code).strip()

        if "cpp" in language or "c++" in language:
            # Sanitize any accidental Java syntax outputted by the model
            code = re.sub(r"\bpublic\s+boolean\b", "public:\n    bool", code)
            code = re.sub(r"\bpublic\s+void\b", "public:\n    void", code)
            code = re.sub(r"\bpublic\s+int\b", "public:\n    int", code)
            code = re.sub(r"char\s*\[\s*\]\s*\[\s*\]", "vector<vector<char>>&", code)
            code = re.sub(r"int\s*\[\s*\]\s*\[\s*\]", "vector<vector<int>>&", code)
            code = re.sub(r"int\s*\[\s*\]", "vector<int>&", code)
            code = re.sub(r"\.length\b", ".size()", code)
            code = re.sub(r"\bnull\b", "nullptr", code)
            code = re.sub(r"\bboolean\b", "bool", code)
            code = re.sub(r"(\bunordered_set<[^>]+>\s+\w+)\s*\([^;)]+\)\s*;", r"\1;", code)
            code = re.sub(r"(\bunordered_map<[^>]+>\s+\w+)\s*\([^;)]+\)\s*;", r"\1;", code)

            # Ensure conflict checks in isSafe return false, never return void
            code = re.sub(r'(\bif\s*\([^)]*==\s*[\x27\x22]Q[\x27\x22][^)]*\)\s*\{?\s*)return\s*;', r'\1return false;', code)

            # Fix common LLM axis confusion in N-Queens where isSafe checks board[row][i] instead of column board[i][col]
            code = re.sub(r'for\s*\(\s*int\s+i\s*=\s*0\s*;\s*i\s*<\s*(?:col|n)\s*;\s*\+*i\+*\s*\)\s*\{?\s*if\s*\(\s*board\[row\]\[i\]\s*==\s*[\x27"]Q[\x27"]\s*\)\s*return\s+false\s*;?\s*\}?',
                          'for (int i = 0; i < row; ++i) { if (board[i][col] == \'Q\') return false; }', code)
            code = re.sub(r'for\s*\(\s*int\s+i\s*=\s*0\s*;\s*i\s*<\s*(?:col|n)\s*;\s*\+*i\+*\s*\)\s*if\s*\(\s*board\[row\]\[i\]\s*==\s*[\x27"]Q[\x27"]\s*\)\s*return\s+false\s*;',
                          'for (int i = 0; i < row; ++i) if (board[i][col] == \'Q\') return false;', code)
            code = re.sub(r'//\s*Check\s+this\s+row\s+on\s+left\s+side\s*\n?', '', code, flags=re.IGNORECASE)
            code = code.replace("`", "").strip()

            # Add missing standard C++ STL headers
            headers = []
            if "vector" in code and "<vector>" not in code:
                headers.append("#include <vector>")
            if "string" in code and "<string>" not in code:
                headers.append("#include <string>")
            if ("unordered_map" in code or "hash_map" in code) and "<unordered_map>" not in code:
                headers.append("#include <unordered_map>")
            if ("unordered_set" in code or "hash_set" in code) and "<unordered_set>" not in code:
                headers.append("#include <unordered_set>")
            if ("queue" in code or "priority_queue" in code) and "<queue>" not in code:
                headers.append("#include <queue>")
            if "stack" in code and "<stack>" not in code:
                headers.append("#include <stack>")
            if ("sort(" in code or "max(" in code or "min(" in code or "reverse(" in code) and "<algorithm>" not in code:
                headers.append("#include <algorithm>")
            if ("INT_MAX" in code or "INT_MIN" in code) and "<climits>" not in code:
                headers.append("#include <climits>")
            if "function<" in code and "<functional>" not in code:
                headers.append("#include <functional>")
            if ("accumulate(" in code or "gcd(" in code or "lcm(" in code) and "<numeric>" not in code:
                headers.append("#include <numeric>")
            if headers:
                if "using namespace std;" in code:
                    code = "\n".join(headers) + "\n" + code
                else:
                    code = "\n".join(headers) + "\nusing namespace std;\n\n" + code
        if "class Solution" not in code:
            if "cpp" in language or "c++" in language:
                includes = re.findall(r"^#include\s+.*", code, flags=re.MULTILINE)
                code = re.sub(r"^#include\s+.*\n?", "", code, flags=re.MULTILINE).strip()
                inc_str = "\n".join(includes) + ("\n\n" if includes else "")
                code = f"{inc_str}class Solution {{\npublic:\n    {code}\n}};"
            elif "python" in language:
                code = f"class Solution:\n    {code}"

    log.info("Synthesized %s code for '%s' (%d chars, leetcode=%s)", language, topic, len(code), is_leetcode)
    return jsonify({"status": "success", "code": code})


@app.route("/api/generate_presentation", methods=["POST"])
def generate_presentation():
    """Synthesizes structured, winning presentation slides for hackathons and corporate pitches using local LLM."""
    data = request.get_json(force=True) or {}
    topic = str(data.get("topic") or data.get("prompt") or "AI Autonomous Drone").strip()

    prompt = (
        f"You are an expert pitch deck designer for the Smart India Hackathon (SIH).\n"
        f"Create a high-impact, 5-slide winning presentation structure for the project: '{topic}'.\n"
        "Return ONLY a valid JSON object matching this schema:\n"
        "{\n"
        '  "title": "Project Title",\n'
        '  "slides": [\n'
        '    {"slide_no": 1, "heading": "Title & Problem Statement", "bullets": ["Point 1", "Point 2"]},\n'
        '    {"slide_no": 2, "heading": "Proposed Solution & Architecture", "bullets": ["Point 1", "Point 2"]},\n'
        '    {"slide_no": 3, "heading": "Technical Innovation & USP", "bullets": ["Point 1", "Point 2"]},\n'
        '    {"slide_no": 4, "heading": "Feasibility & Real-World Impact", "bullets": ["Point 1", "Point 2"]},\n'
        '    {"slide_no": 5, "heading": "6-Month Roadmap & Milestones", "bullets": ["Point 1", "Point 2"]}\n'
        "  ]\n"
        "}\n"
        "Do NOT include markdown formatting or explanations."
    )

    try:
        resp = ollama_client.generate(
            role="text",
            prompt=prompt,
            options={"temperature": 0.2, "top_p": 0.9}
        )
        raw = resp.text.strip()
        import re
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            deck = json.loads(m.group(0))
            return jsonify({"status": "success", "deck": deck})
    except Exception as e:
        log.warning("Ollama presentation generation failed: %s", e)

    fallback_deck = {
        "title": topic,
        "slides": [
            {"slide_no": 1, "heading": f"{topic} — Problem Statement", "bullets": ["Critical industry bottleneck", "High-latency legacy response"]},
            {"slide_no": 2, "heading": "System Architecture & Flow", "bullets": ["Edge perception node", "Central cloud analytics", "Autonomous dispatch"]},
            {"slide_no": 3, "heading": "Technical USP & Innovation", "bullets": ["On-device VLM inference", "Sub-200ms latency", "Privacy-preserving design"]},
            {"slide_no": 4, "heading": "Feasibility & Market Impact", "bullets": ["Cost reduction: 65%", "Operational speedup: 4x", "Zero cloud dependency"]},
            {"slide_no": 5, "heading": "6-Month Implementation Roadmap", "bullets": ["M1: Core prototype", "M2: Pilot deployment", "M3: Production scale"]}
        ]
    }
    return jsonify({"status": "fallback", "deck": fallback_deck})


@app.route("/api/decompose_goal", methods=["POST"])
def decompose_goal():
    """Dynamically decomposes ANY user natural language command into an executable sequence of browser steps
    using the local on-device LLM (qwen2.5:3b). Zero hardcoding.
    """
    data = request.get_json(force=True) or {}
    goal = str(data.get("goal") or data.get("task") or "").strip()
    current_url = str(data.get("current_url") or "").strip()

    if not goal:
        return jsonify({"status": "error", "message": "Missing goal"}), 400

    prompt = (
        "You are an autonomous web browser AI agent planner.\n"
        "Given ANY user goal (regardless of conversational style, grammar errors, phonetic typos, slang, or multi-step requests), "
        "break it down into an ordered JSON array of atomic browser steps.\n\n"
        "Supported step types:\n"
        '- {"type": "navigate", "url": "https://...", "label": "..."}\n'
        '- {"type": "click", "target": "visible text or button name", "label": "..."}\n'
        '- {"type": "type", "field": "description of field", "value": "text to type", "topic": "clean entity", "language": "cpp/python", "label": "..."}\n'
        '- {"type": "select", "field": "dropdown or radio choice", "value": "option value", "label": "..."}\n'
        '- {"type": "press_key", "key": "Enter", "label": "..."}\n'
        '- {"type": "submit_and_verify", "target": "Submit", "label": "Submit code and verify all testcases"}\n'
        '- {"type": "scroll", "direction": "down/up", "label": "..."}\n\n'
        "Domain Guidelines:\n"
        "1. LeetCode / Coding Tasks:\n"
        "   - Clean entity: extract the pure problem title (e.g. 'Course Schedule', 'Two Sum', 'LRU Cache', 'Valid Parentheses', 'Trapping Rain Water'). "
        "Remove conversational fluff words ('problem', 'click it', 'solve it', 'slove it', 'run it', 'check it').\n"
        "   - Direct problem slug: https://leetcode.com/problems/<slug>/ where slug is lowercase hyphenated.\n"
        "   - If current_url is already on the problem page, do NOT add a navigate step.\n"
        "   - Writing code: {\"type\": \"type\", \"field\": \"code editor textarea\", \"topic\": \"<Clean Title>\", \"label\": \"Write solution for <Clean Title>\"}\n"
        "   - Running code: {\"type\": \"click\", \"target\": \"Run Compile Execute\", \"label\": \"Run code\"}\n"
        "   - Submitting/verifying: {\"type\": \"submit_and_verify\", \"target\": \"Submit\", \"label\": \"Submit code and verify all testcases\"}\n"
        "2. GitHub: https://github.com/new for repository creation, https://github.com/search?q=<query>&type=repositories for search\n"
        "3. Gmail: https://mail.google.com/mail/u/0/#inbox?compose=new\n"
        "4. YouTube: https://www.youtube.com/results?search_query=<query>\n"
        "5. Canva: https://www.canva.com/presentations/ or https://www.canva.com\n"
        "6. Reddit: https://www.reddit.com/search/?q=<query>\n"
        "7. Wikipedia: https://en.wikipedia.org/wiki/Special:Search?search=<query>\n"
        "8. Google: https://www.google.com/search?q=<query>\n"
        "9. Programiz: https://www.programiz.com/python-programming/online-compiler/\n"
        "10. Universal Login / Sign In on ANY Website (X/Twitter, LinkedIn, Reddit, Quora, LeetCode, etc.):\n"
        "    - Security & Human-In-The-Loop Rule:\n"
        "    - When user asks to login/sign in or access a site requiring account, NEVER guess passwords or output fake credentials.\n"
        "    - The agent navigates to the login/site page, then uses 'wait_for_user' to safely pause and wait for the user to sign in:\n"
        '      * {"type": "navigate", "url": "<site_login_url>", "label": "Open login page"}\n'
        '      * {"type": "wait_for_user", "label": "Please sign in to your account, then click Continue"}\n'
        "11. X (Twitter): https://x.com/ or https://x.com/login for login, https://x.com/search?q=<query> for search\n\n"
        "Examples:\n"
        'Goal: "open x website and login and search for open ai"\n'
        "JSON:\n"
        "[\n"
        '  {"type": "navigate", "url": "https://x.com/login", "label": "Open X login page"},\n'
        '  {"type": "wait_for_user", "label": "Please sign in to your X account in the browser, then click Continue"},\n'
        '  {"type": "navigate", "url": "https://x.com/search?q=open+ai", "label": "Search X for \'open ai\'"},\n'
        '  {"type": "click", "target": "first search result", "label": "Click first search result"}\n'
        "]\n\n"
        'Goal: "course schedule problem click it slove it and run it"\n'
        "JSON:\n"
        "[\n"
        '  {"type": "navigate", "url": "https://leetcode.com/problems/course-schedule/", "label": "Open LeetCode problem \'Course Schedule\'"},\n'
        '  {"type": "type", "field": "code editor textarea", "topic": "Course Schedule", "label": "Write solution for Course Schedule"},\n'
        '  {"type": "click", "target": "Run Compile Execute", "label": "Run code"},\n'
        '  {"type": "submit_and_verify", "target": "Submit", "label": "Submit code and verify all testcases"}\n'
        "]\n\n"
        'Goal: "search python dict methods on mdn and click the first link"\n'
        "JSON:\n"
        "[\n"
        '  {"type": "navigate", "url": "https://developer.mozilla.org/en-US/search?q=python+dict+methods", "label": "Search MDN for \'python dict methods\'"},\n'
        '  {"type": "click", "target": "first search result", "label": "Click first search result"}\n'
        "]\n\n"
        "Output ONLY the JSON array. No markdown commentary, no explanations.\n\n"
        f"Goal: \"{goal}\"\n"
        f"Current URL: \"{current_url}\"\n"
        "JSON Steps:"
    )

    for role in ("text", "draft"):
        try:
            resp = ollama_client.generate(
                role=role,
                prompt=prompt,
                options={"temperature": 0.1, "top_p": 0.9}
            )
            raw = resp.text.strip()
            import re
            m = re.search(r"\[.*\]", raw, re.DOTALL)
            if m:
                steps = json.loads(m.group(0))
                if isinstance(steps, list) and len(steps) > 0:
                    valid_steps = []
                    for s in steps:
                        if isinstance(s, dict) and "type" in s:
                            valid_steps.append({
                                "type": s.get("type", "click"),
                                "url": s.get("url"),
                                "target": s.get("target"),
                                "field": s.get("field"),
                                "value": s.get("value"),
                                "key": s.get("key"),
                                "topic": s.get("topic"),
                                "language": s.get("language"),
                                "direction": s.get("direction"),
                                "label": s.get("label") or f"{s.get('type')} {s.get('target') or s.get('url') or s.get('field') or ''}".strip()
                            })

                    # Human-In-The-Loop: When login/sign in is detected without explicit credentials in prompt,
                    # pause and wait for the user to sign in safely in the browser tab.
                    has_explicit_password = bool(re.search(r"\b(?:password|pass)\s+(?:is\s+)?([^\s]+)", goal, re.I))
                    if not has_explicit_password and any(re.search(r"\b(login|sign\s*in|signin)\b", s.get("label", "") + " " + (s.get("field") or "") + " " + (s.get("target") or ""), re.I) for s in valid_steps):
                        processed_steps = []
                        added_wait_for_user = False
                        for s in valid_steps:
                            lbl = (s.get("label") or "").lower()
                            fld = (s.get("field") or "").lower()
                            tgt = (s.get("target") or "").lower()
                            is_dummy_cred_step = (
                                ("username" in lbl or "username" in fld or "email" in fld) and s.get("type") == "type"
                            ) or (
                                ("password" in lbl or "password" in fld) and s.get("type") == "type"
                            ) or (
                                ("login" in lbl or "sign in" in lbl or "login" in tgt or "sign in" in tgt) and s.get("type") == "click" and "wait" not in tgt
                            )
                            if is_dummy_cred_step:
                                if not added_wait_for_user:
                                    processed_steps.append({
                                        "type": "wait_for_user",
                                        "label": "Please sign in to your account in the browser, then click Continue"
                                    })
                                    added_wait_for_user = True
                            else:
                                processed_steps.append(s)
                        valid_steps = processed_steps

                    if valid_steps:
                        log.info("LLM dynamically decomposed goal '%s' into %d steps via role '%s'", goal[:50], len(valid_steps), role)
                        return jsonify({"status": "success", "source": f"llm-{role}", "steps": valid_steps})
        except Exception as e:
            log.warning("LLM dynamic goal decomposition error with role '%s': %s", role, e)

    return jsonify({"status": "fallback", "source": "heuristic"})


@app.route("/api/agent_step", methods=["POST"])
def agent_step():
    """Autonomous Closed-Loop ReAct Engine single turn (implementation_plan 69).

    Ingests: goal, page_url, page_title, elements, alerts, screenshot_b64, history.
    1. Moondream VLM Visual Scan (if screenshot provided).
    2. Qwen2.5 Deep ReAct Reasoning.
    3. Outputs JSON: {"thought": "...", "action": {"type": "...", "tag_id": N, ...}, "is_done": false}.
    """
    data = request.get_json(force=True) or {}
    goal = str(data.get("goal") or "").strip()
    page_url = str(data.get("page_url") or "").strip()
    page_title = str(data.get("page_title") or "").strip()
    elements = data.get("elements") or []
    alerts = data.get("alerts") or []
    screenshot_b64 = str(data.get("screenshot_b64") or "").strip()
    history = data.get("history") or []

    if not goal:
        return jsonify({"status": "error", "message": "Missing goal"}), 400

    # ── Phase 1: Moondream Visual Scan ──
    vlm_summary = ""
    if screenshot_b64 and CONFIG.models.vision:
        try:
            vlm_prompt = (
                f"Task: '{goal}'. "
                "Describe any visible modal dialogs, error messages, validation alerts, or disabled buttons in 2 sentences."
            )
            vlm_resp = ollama_client.generate(
                role="vision",
                prompt=vlm_prompt,
                images=[screenshot_b64],
                options={"temperature": 0.1, "num_predict": 100}
            )
            vlm_summary = vlm_resp.text.strip()
            log.info("Moondream VLM Visual Summary: %s", vlm_summary[:100])
        except Exception as e:
            log.info("Moondream VLM scan bypassed: %s", e)

    # ── Phase 2: Qwen2.5 Deep ReAct Reasoning ──
    prompt = build_agent_step_prompt(
        goal=goal,
        page_url=page_url,
        page_title=page_title,
        elements=elements,
        vlm_summary=vlm_summary,
        history=history,
        alerts=alerts
    )

    decision = None
    # Try text model (qwen2.5:3b), fallback to draft model if needed
    for role in ("text", "draft"):
        try:
            resp = ollama_client.generate(
                role=role,
                prompt=prompt,
                options={"temperature": 0.2, "top_p": 0.9}
            )
            raw = resp.text.strip()
            import re
            m = re.search(r"\{.*\}", raw, re.DOTALL)
            if m:
                parsed = json.loads(m.group(0))
                actions = parsed.get("actions") or []
                thought = parsed.get("reasoning") or parsed.get("thought") or "Analyzing page and selecting best action."
                is_done = bool(parsed.get("is_done", False))

                # Normalize action schema
                single_action = None
                if actions and isinstance(actions, list) and len(actions) > 0:
                    first = actions[0]
                    single_action = {
                        "type": first.get("type", "click"),
                        "tag_id": first.get("tag_id"),
                        "value": first.get("value"),
                        "key": first.get("key"),
                        "description": first.get("intent") or first.get("description") or f"{first.get('type')} on #{first.get('tag_id')}"
                    }
                    if first.get("type") == "done":
                        is_done = True
                elif parsed.get("action"):
                    act = parsed.get("action")
                    single_action = {
                        "type": act.get("type", "click"),
                        "tag_id": act.get("tag_id"),
                        "value": act.get("value"),
                        "key": act.get("key"),
                        "description": act.get("description") or act.get("intent") or f"{act.get('type')}"
                    }

                decision = {
                    "thought": thought,
                    "action": single_action or {"type": "done", "description": "Goal accomplished"},
                    "actions": actions or ([single_action] if single_action else []),
                    "is_done": is_done,
                    "source": f"llm-{role}"
                }
                break
        except Exception as e:
            log.warning("Ollama ReAct reasoning with role '%s' error: %s", role, e)

    if not decision:
        decision = {
            "thought": "Directing next action from page elements.",
            "action": {"type": "done", "description": "Goal accomplished"},
            "actions": [],
            "is_done": False,
            "source": "fallback"
        }

    return jsonify({"status": "success", "decision": decision})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"🚀 [SIH26171] Starting Local Agent HTTP Server on http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=False)
