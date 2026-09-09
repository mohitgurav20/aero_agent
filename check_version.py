import re, sys

with open('server/app.py', encoding='utf-8') as f:
    app_src = f.read()

found_bad = bool(re.search(r'\bmInstead\b|\bm_instead\b', app_src))
print('BAD mInstead regex in app.py:', found_bad)

with open('extension/background.js', encoding='utf-8') as f:
    bg_src = f.read()

found_bad_bg = bool(re.search(r'\bmInstead\b|\bm_instead\b', bg_src))
print('BAD mInstead regex in background.js:', found_bad_bg)

react_present = 'runAutonomousReActLoop' in bg_src
print('runAutonomousReActLoop present:', react_present)

vlm_present = 'vlm' in app_src.lower() or 'VLM' in app_src
print('VLM code present in app.py:', vlm_present)

decompose_idx = [i+1 for i,l in enumerate(app_src.splitlines()) if 'def decompose_goal' in l]
print('decompose_goal at lines:', decompose_idx)

# Check for site-specific hardcoding inside decompose_goal
app_lines = app_src.splitlines()
if decompose_idx:
    start = decompose_idx[0] - 1
    # Find next function def after decompose_goal
    next_def = next((i for i,l in enumerate(app_lines[start+1:], start+1) if l.startswith('def ') or (l.startswith('    def ') and i > start+5)), len(app_lines))
    decompose_body = '\n'.join(app_lines[start:next_def])
    for site in ['leetcode', 'programiz', 'gmail']:
        count = len(re.findall(site, decompose_body, re.IGNORECASE))
        print(f'  "{site}" hardcoded in decompose_goal body: {count}')

# Check VLM summary log line exists properly
vlm_log = 'VLM summary' in app_src
print('VLM summary logging present:', vlm_log)

# Check that agent_step uses screenshot/DOM
uses_screenshot = 'screenshot' in app_src.lower()
uses_dom = 'dom' in app_src.lower()
print('Uses screenshot:', uses_screenshot, '| Uses DOM:', uses_dom)

print()
ok = react_present and not found_bad and not found_bad_bg and vlm_present
print('=== VERSION CHECK PASSED ===' if ok else '=== ISSUES DETECTED ===')
