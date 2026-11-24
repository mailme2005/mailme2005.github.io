#!/usr/bin/env python3
"""Build every support and privacy page from plain-text content, so all pages share one template.

Usage:  python3 -I _tools/build.py            build every page that is ready to publish
        python3 -I _tools/build.py --all      also build the pages listed in HOLD
Content lives in _content/<app>/<kind>.<lang>.txt, where kind is privacy or support. Pages are
written next to it, into <app>/, which is what GitHub Pages serves. GitHub Pages does not publish
folders whose names start with an underscore, so _content and _tools stay out of the website.

Content format (one item per line):
  @updated 2026-11-19   the page's "last updated" date; change it when the page's content changes
  @lede text        one line under the page title (optional)
  @summary text     the summary box on a privacy page
  @contact text     the contact box on a support page (the email address is added automatically)
  @include name     insert _content/_shared/name.<lang>.txt; {app} and {email} are filled in
  ## Heading        section heading
  ### Heading       question or sub-heading
  - text            list item
  > text            small grey note
  anything else     a paragraph
Inline: **bold** and [text](url).
"""
import html, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, '_content')
EMAIL = 'tripzy053@gmail.com'
MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
          'October', 'November', 'December']

# Pages whose new version must not replace the live one yet. Remove an entry when its time comes.
#   Receipted help pages: describe 1.1.0; publish them when 1.1.0 is released.
# ('tripzy', 'privacy'): names Anthropic for weekend plans; publish just before Tripzy Issue 374's U2.
HOLD = {('huayouju', 'support')}

def format_date(iso, lang):
    y, m, d = (int(x) for x in iso.split('-'))
    return f'{y} 年 {m} 月 {d} 日' if lang == 'zh' else f'{MONTHS[m - 1]} {d}, {y}'

# Apps that ship their own icons in their folder keep them, along with their browser bar colours.
ICONS = ('<meta name="theme-color" content="%s" media="(prefers-color-scheme: light)">\n'
         '<meta name="theme-color" content="%s" media="(prefers-color-scheme: dark)">\n'
         '<link rel="icon" type="image/png" href="favicon.png">\n'
         '<link rel="apple-touch-icon" href="apple-touch-icon.png">\n')

# name: (zh name, en name); accent: (light, dark); files: output file name per (kind, lang); head: extra head tags.
APPS = {
  'night-market-stall': dict(name=('今晚我出摊', 'My Little Night Stall'), accent=('#9a4f1c', '#f0b07a'),
      files={('privacy','zh'):'privacy.html', ('privacy','en'):'privacy-en.html', ('support','zh'):'support.html', ('support','en'):'support-en.html'}),
  'community-delivery': dict(name=('社区配送站', 'Neighborhood Delivery'), accent=('#2c6a8f', '#8cc4e6'),
      files={('privacy','zh'):'privacy.html', ('privacy','en'):'privacy-en.html', ('support','zh'):'support.html', ('support','en'):'support-en.html'}),
  'perfect-packing': dict(name=('行李箱刚刚好', 'Packed Just Right'), accent=('#b0562f', '#f2ab85'),
      files={('privacy','zh'):'privacy.html', ('privacy','en'):'privacy-en.html', ('support','zh'):'support.html', ('support','en'):'support-en.html'}),
  'little-garden': dict(name=('一方小园', 'Little Garden: Mochi Bunny'), accent=('#4d7a3a', '#a9d694'),
      files={('privacy','zh'):'privacy.html', ('privacy','en'):'en/privacy.html', ('support','zh'):'support.html', ('support','en'):'en/support.html'}),
  'mobile-fortress': dict(name=('移动堡垒', 'Mobile Fortress'), accent=('#5b6a2e', '#eac774'),
      files={('privacy','en'):'privacy.html', ('privacy','zh'):'privacy-zh.html', ('support','en'):'support.html', ('support','zh'):'support-zh.html'}),
  'huayouju': dict(name=('花有据', 'Receipted'), accent=('#1f7a6b', '#86d6c5'),
      files={('privacy','zh'):'privacy.html', ('privacy','en'):'en/privacy.html', ('support','zh'):'support.html', ('support','en'):'en/support.html'}),
  'tongzhuo': dict(name=('同桌', 'Tongzhuo'), accent=('#176b4b', '#82d5ad'),
      files={('privacy','en'):'privacy.html', ('privacy','zh'):'privacy-zh.html', ('support','en'):'support.html', ('support','zh'):'support-zh.html'}),
  'tripzy': dict(name=(None, 'Tripzy: AI Trip Planner'), accent=('#2c5e51', '#8fcfba'),
      files={('privacy','en'):'privacy.html', ('support','en'):'support.html'},
      head=ICONS % ('#E3F2EC', '#22342E')),
  'tapzilla': dict(name=(None, 'Tapzilla'), accent=('#5b48c8', '#b7aaf7'),
      files={('privacy','en'):'privacy.html', ('support','en'):'support.html'},
      head=ICONS % ('#EEEAFC', '#2A2160')),
}

T = {
 'zh': dict(htmllang='zh-Hans', skip='跳到正文', nav='页面导航', help='帮助', privacy='隐私', other='English', otherlang='en',
            title={'privacy':'隐私政策', 'support':'帮助'}, updated='更新日期：', summary='一句话总结', contact='联系我们', all='全部应用'),
 'en': dict(htmllang='en', skip='Skip to content', nav='Pages', help='Help', privacy='Privacy', other='简体中文', otherlang='zh-Hans',
            title={'privacy':'Privacy policy', 'support':'Help'}, updated='Updated ', summary='In one sentence', contact='Contact us', all='All apps'),
}

def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    def link(m):
        url = m.group(2)
        return '<a href="%s">%s</a>' % (html.escape(url, quote=True), m.group(1))
    return re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', link, s)

def body(text, lang, kind):
    t = T[lang]; out = []; lede = None; box = None; in_ul = False; in_sec = False; updated = None
    def close_ul():
        nonlocal in_ul
        if in_ul: out.append('    </ul>'); in_ul = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line: close_ul(); continue
        if line.startswith('@updated '): updated = line[9:].strip(); continue
        if line.startswith('@lede '): lede = line[6:]; continue
        if line.startswith('@summary '): box = ('summary', line[9:]); continue
        if line.startswith('@contact '): box = ('contact', line[9:]); continue
        if line.startswith('## '):
            close_ul()
            if in_sec: out.append('  </section>\n')
            out.append('  <section>\n    <h2>%s</h2>' % inline(line[3:])); in_sec = True; continue
        if line.startswith('### '): close_ul(); out.append('    <h3>%s</h3>' % inline(line[4:])); continue
        if line.startswith('- '):
            if not in_ul: out.append('    <ul>'); in_ul = True
            out.append('      <li>%s</li>' % inline(line[2:])); continue
        close_ul()
        if line.startswith('> '): out.append('    <p class="note">%s</p>' % inline(line[2:])); continue
        out.append('    <p>%s</p>' % inline(line))
    close_ul()
    if in_sec: out.append('  </section>')
    head = ['  <div class="hero">', '    <p class="eyebrow">Little Everyday Apps</p>', '    <h1>%s</h1>' % t['title'][kind]]
    if lede: head.append('    <p class="lede">%s</p>' % inline(lede))
    if not updated: raise SystemExit('missing @updated line in a %s page (%s)' % (kind, lang))
    head += ['    <p class="updated">%s%s</p>' % (t['updated'], format_date(updated, lang)), '  </div>\n']
    if box and box[0] == 'summary':
        head += ['  <div class="summary">', '    <p class="label">%s</p>' % t['summary'], '    <p>%s</p>' % inline(box[1]), '  </div>\n']
    if box and box[0] == 'contact':
        head += ['  <div class="contact">', '    <p class="label">%s</p>' % t['contact'],
                 '    <p class="mail"><a href="mailto:%s">%s</a></p>' % (EMAIL, EMAIL), '    <p>%s</p>' % inline(box[1]), '  </div>\n']
    return '\n'.join(head + out)

def rel(frm, to):
    return os.path.relpath(to, os.path.dirname(frm) or '.')

def expand(text, lang, name):
    """@include name pulls in _content/_shared/name.<lang>.txt, so the same thing is said the same way everywhere."""
    def inc(m):
        with open(os.path.join(CONTENT, '_shared', f'{m.group(1)}.{lang}.txt'), encoding='utf-8') as f: return f.read().strip()
    for _ in range(3): text = re.sub(r'^@include (\S+)\s*$', inc, text, flags=re.M)
    return text.replace('{app}', name).replace('{email}', f'[{EMAIL}](mailto:{EMAIL})')

def page(app, cfg, kind, lang, text):
    t = T[lang]; files = cfg['files']; me = files[(kind, lang)]
    name = cfg['name'][0 if lang == 'zh' else 1]
    text = expand(text, lang, name)
    other = 'en' if lang == 'zh' else 'zh'
    depth = me.count('/') + 1
    css = '../' * depth + 'assets/site.css'; home = '../' * depth
    sup, pri = rel(me, files[('support', lang)]), rel(me, files[('privacy', lang)])
    cur = lambda k: ' aria-current="page"' if k == kind else ''
    langlink = ''
    if (kind, other) in files:
        langlink = '\n    <a class="lang" href="%s" lang="%s" hreflang="%s">%s</a>' % (rel(me, files[(kind, other)]), t['otherlang'], t['otherlang'], t['other'])
    desc = re.search(r'^@(?:summary|lede) (.+)$', text, re.M)
    desc = re.sub(r'\*\*|\[([^\]]+)\]\([^)]+\)', r'\1', desc.group(1))[:150] if desc else name
    return f'''<!doctype html>
<html lang="{t['htmllang']}" style="--accent:{cfg['accent'][0]};--accent-dark:{cfg['accent'][1]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{t['title'][kind]} · {html.escape(name)}</title>
<meta name="description" content="{html.escape(desc, quote=True)}">
{cfg.get('head', '')}<link rel="stylesheet" href="{css}">
</head>
<body>
<a class="skip" href="#main">{t['skip']}</a>
<header class="site-header"><div class="wrap">
  <a class="app-name" href="{sup}">{html.escape(name)}</a>
  <nav aria-label="{t['nav']}">
    <a href="{sup}"{cur('support')}>{t['help']}</a>
    <a href="{pri}"{cur('privacy')}>{t['privacy']}</a>{langlink}
  </nav>
</div></header>

<main id="main" class="wrap">
{body(text, lang, kind)}
</main>

<footer class="site-footer"><div class="wrap">
  <span>© 2026 Little Everyday Apps</span>
  <span><a href="{sup}">{t['help']}</a> · <a href="{pri}">{t['privacy']}</a> · <a href="{home}">{t['all']}</a></span>
</div></footer>
</body>
</html>
'''

def main():
    built = 0; missing = []; held = []
    for app, cfg in APPS.items():
        for (kind, lang), out in cfg['files'].items():
            if (app, kind) in HOLD and '--all' not in sys.argv:
                held.append(f'{app}/{out}'); continue
            src = os.path.join(CONTENT, app, f'{kind}.{lang}.txt')
            if not os.path.exists(src): missing.append(os.path.relpath(src, ROOT)); continue
            dst = os.path.join(ROOT, app, out)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(src, encoding='utf-8') as f: text = f.read()
            with open(dst, 'w', encoding='utf-8') as f: f.write(page(app, cfg, kind, lang, text))
            built += 1
    print(f'built {built} pages; missing content: {len(missing)}; held back: {len(held)}')
    for h in held: print('  held', h)
    for m in missing: print('  missing', m)

if __name__ == '__main__':
    main()
