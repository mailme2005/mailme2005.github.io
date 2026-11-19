#!/usr/bin/env python3
"""Check every page: balanced tags, no broken internal links, no leftover template markers.
Only pages in the shared layout (they link assets/site.css) and the home page are checked;
older pages that have not been moved to it yet are left alone.
Usage:  python3 -I _tools/check.py"""
import glob, html.parser, os, re, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOID = ('meta', 'link', 'br', 'img', 'hr', 'input', 'path')
class P(html.parser.HTMLParser):
    def __init__(s): super().__init__(); s.stack = []; s.err = []
    def handle_starttag(s, t, a):
        if t not in VOID: s.stack.append(t)
    def handle_endtag(s, t):
        if t in VOID: return
        if not s.stack or s.stack[-1] != t: s.err.append((t, s.stack[-3:]))
        else: s.stack.pop()
bad = n = 0
for f in sorted(glob.glob(root + '/**/*.html', recursive=True)):
    s = open(f, encoding='utf-8').read()
    if 'assets/site.css' not in s and os.path.relpath(f, root) != 'index.html': continue
    p = P(); p.feed(s); n += 1
    d = os.path.dirname(f)
    links = [h for h in re.findall(r'href="([^"]+)"', s) if not h.startswith(('http', 'mailto', '#', '/'))]
    missing = [h for h in links if not os.path.exists(os.path.normpath(os.path.join(d, h.split('#')[0])))]
    body = re.sub(r'<head>.*?</head>', '', s, flags=re.S)
    left = re.findall(r'\{app\}|\{email\}|@include|@lede|@summary|@contact|\*\*|\]\(', body)
    if p.err or p.stack or missing or left:
        bad += 1; print('PROBLEM', os.path.relpath(f, root), p.err[:2], p.stack[:3], missing, left[:3])
print(n, 'pages checked;', bad, 'with problems')
sys.exit(1 if bad else 0)
