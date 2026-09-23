"""Which lines of index.html belong to a screen. Used by snap.py."""
import re

def _functions(lines, names):
    out = set()
    tops = [i for i, l in enumerate(lines) if re.match(r'^(async )?function \w+\(|^(const|let|var) \w+ = ', l)]
    for k, i in enumerate(tops):
        m = re.match(r'^(?:async )?function (\w+)\(', lines[i])
        if m and m.group(1) in names:
            out.update(range(i, tops[k + 1] if k + 1 < len(tops) else len(lines)))
    return out

def _css(lines, sel_rx):
    """Lines of every innermost CSS rule whose selectors ALL start with a matching class/id."""
    text = '\n'.join(lines)
    a = text.index('<style>'); b = text.index('</style>')
    css = text[a:b]
    css = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), css, flags=re.S)
    out = set()
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
        sel = m.group(1).strip()
        if sel.startswith('@'): continue
        sels = [s.strip() for s in sel.split(',') if s.strip()]
        if sels and all(sel_rx.match(re.sub(r'^\[data-theme="\w+"\]\s+', '', s)) for s in sels):
            l0 = text.count('\n', 0, a + m.start(2)); l1 = text.count('\n', 0, a + m.end(2))
            out.update(range(l0, l1 + 1))
    return out

def _html(lines, start_rx, end_rx):
    s = next(i for i, l in enumerate(lines) if re.search(start_rx, l))
    e = next(i for i in range(s, len(lines)) if re.search(end_rx, lines[i]))
    return set(range(s, e + 1))

def feed(lines):
    fns = ['renderFeed', 'renderFeedCard', 'feedStaleHtml', 'feedCaughtUpHtml', 'renderCommentBody', 'fetchComments',
           'toggleComments', 'showFeedLoadMoreButton', 'mountFeedLoadMoreSentinel',
           'refreshFeedCard', 'toggleFeedMenu']
    return _functions(lines, fns) | _css(lines, re.compile(r'[.#](?:feed|comment|comments)[\w-]*'))

def collection(lines):
    fns = ['renderCollSortBar', 'renderCollection', 'renderCollectionList', 'setCollSort', 'enterCollectionSelect',
           'exitCollectionSelect', 'renderWatchCard', 'watchCardHTML', 'renderCollTagFilterBar']
    return (_functions(lines, fns) | _css(lines, re.compile(r'[.#](?:watch|watches|coll|col|card-tag|meta|market-price|wc)-[\w-]*|[.#](?:watches-grid|card-tags|card-tag|meta-box|meta-lbl|meta-val)\b'))
            | _html(lines, r'id="page-collection"', r'<!-- ════ FEED PAGE'))

def track(lines):
    fns = ['renderTrack', 'renderWatchSelector', 'renderTrackHistory', 'renderNeglectedStrip', 'renderWatchRecommendation',
           'updateStreakChip', 'syncTrackDateChips', 'resetSnapStatus', 'showSnapMatchPicker']
    return (_functions(lines, fns) | _css(lines, re.compile(r'[.#](?:rec|neglected|snap|sel|track|streak|watch-selector|log-date)-[\w-]*|[.#](?:snap-btn|table-wrap|watch-selector|neglected-strip)\b'))
            | _html(lines, r'id="page-track"', r'<!-- ════ COLLECTION PAGE'))

def wishlist(lines):
    fns = ['wlCardHtml', 'renderWishlist', 'toggleWishlistFolder']
    return (_functions(lines, fns) | _css(lines, re.compile(r'[.#](?:wl|wishlist)-[\w-]*'))
            | _html(lines, r'id="page-wishlist"', r'<!-- ════ STATS PAGE'))

def stats(lines):
    fns = ['renderValueSection', 'renderStats', 'renderStatsRow', 'renderChUsecase', 'renderChCollectionValue', 'renderCollectionReport']
    end = next(l for l in lines if '<!-- ════' in l and lines.index(l) > next(i for i, x in enumerate(lines) if 'id="page-stats"' in x))
    return (_functions(lines, fns) | _css(lines, re.compile(r'[.#](?:stats|stat|chart|rank|filter|report|value)-[\w-]*|[.#](?:chart-wrap|stats-row|stats-top|section-title)\b'))
            | _html(lines, r'id="page-stats"', re.escape(end.strip())))

def profile(lines):
    fns = ['profilePostCellHTML', 'renderPrivateProfileHTML', 'renderProfilePageHTML', 'loadMoreProfilePosts']
    return (_functions(lines, fns) | _css(lines, re.compile(r'[.#](?:profile|prof|showcase|pp|follow)-[\w-]*|[.#](?:follow-btn)\b'))
            | _html(lines, r'id="page-profile"', r'<!-- ════ CLUBS PAGE'))

def _overlay(lines, idn):
    i = next(k for k, l in enumerate(lines) if re.search(r'<div[^>]*id="%s"' % re.escape(idn), l))
    depth = 0; j = i
    while j < len(lines):
        depth += len(re.findall(r'<div\b', lines[j])) - len(re.findall(r'</div>', lines[j]))
        if depth <= 0: break
        j += 1
    return set(range(i, j + 1))

MODALS_A = ['watch-modal', 'track-log-modal', 'new-post-modal', 'edit-post-modal', 'wishlist-modal']
def modals_a(lines):
    out = _css(lines, re.compile(r'[.#](?:modal|overlay)[\w-]*|#(?:%s)\b' % '|'.join(MODALS_A)))
    for m in MODALS_A: out |= _overlay(lines, m)
    return out

def modals_b(lines):
    ids = [re.search(r'id="([\w-]+)"', l).group(1) for l in lines if re.search(r'<div[^>]*class="[^"]*\boverlay\b', l) and re.search(r'id="([\w-]+)"', l)]
    out = set()
    for m in ids:
        if m not in MODALS_A: out |= _overlay(lines, m)
    return out

def measure(lines):
    names = [re.match(r'^(?:async )?function (\w+)\(', l).group(1) for l in lines if re.match(r'^(async )?function \w+\(', l)]
    fns = [n for n in names if re.search(r'^(_?msr|render(Msr|Measure|Acc|Adv)|showMsr|updateMsr|_deepRender)', n)]
    return (_functions(lines, fns) | _css(lines, re.compile(r'[.#](?:msr|acc|adv|tg)-[\w-]*'))
            | _html(lines, r'<!-- ════ MEASURE PAGE', r'<!-- ════ WISHLIST PAGE'))

def help_(lines):
    return (_css(lines, re.compile(r'[.#](?:help|guide|faq|wn|whats-new)-[\w-]*'))
            | _html(lines, r'<!-- ════ HELP PAGE', r'<!-- ════ MEASURE PAGE'))

EMAIL_RANGES = [('const FUNFACT_CARD_HTML', 'function renderDevFlags'), ('function imgSnippet', 'function updateBroadcastPreview'),
                ('function buildFinalBroadcastHtml', 'const BROADCAST_DRAFTS_KEY'), ('function buildCampaignEmailHtml', 'async function createCampaign')]
def email_lines(lines):
    out = set()
    for a, b in EMAIL_RANGES:
        i = next(k for k, l in enumerate(lines) if l.startswith(a)); j = next(k for k, l in enumerate(lines) if l.startswith(b) and k > i)
        out |= set(range(i, j))
    return out

ADMIN_FN = re.compile(r'[Aa]dmin|Broadcast|Campaign|Promo(Admin|Slot|Preview)|DevFlags|DevExperiments|Experiment|EmailHealth|EmailEngage|EmailClick|Traffic|firstLoadCard|Feedback(Card)?$|renderAdm|adm[A-Z]')
def admin(lines):
    names = [re.match(r'^(?:async )?function (\w+)\(', l).group(1) for l in lines if re.match(r'^(async )?function \w+\(', l)]
    fns = [n for n in names if ADMIN_FN.search(n)]
    out = (_functions(lines, fns) | _css(lines, re.compile(r'[.#](?:admin|adm|broadcast|camp|campaign|exp|dev)-[\w-]*'))
           | _html(lines, r'<!-- ════ ADMIN PAGE', r'<!-- ════ HELP PAGE'))
    return out - email_lines(lines)

LANDING = re.compile(r'#auth-screen|[.#]landing|[.#]auth-|[.#]lp-|[.#]signin|[.#]hero')
def css_rest(lines):
    """Every innermost rule in the stylesheet EXCEPT any whose selector mentions the landing screen."""
    text = '\n'.join(lines); a = text.index('<style>'); b = text.index('</style>')
    css = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), text[a:b], flags=re.S)
    out = set(); skipped = 0
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css):
        sel = m.group(1).strip()
        if sel.startswith('@'): continue
        if LANDING.search(sel): skipped += 1; continue
        l0 = text.count('\n', 0, a + m.start(2)); l1 = text.count('\n', 0, a + m.end(2))
        # a one-line rule shares its line with nothing else; a multi-line body is lines l0..l1
        out.update(range(l0, l1 + 1))
    # never touch a line that ALSO holds a landing selector (several rules on one line)
    out = {i for i in out if not LANDING.search(lines[i])}
    print('css_rest: skipped %d landing rules' % skipped)
    return out

def rest(lines):
    """Everything outside the stylesheet, minus email HTML and the landing markup."""
    a = next(i for i, l in enumerate(lines) if '<style>' in l); b = next(i for i, l in enumerate(lines) if '</style>' in l)
    la = next(i for i, l in enumerate(lines) if '<!-- ════ AUTH / LANDING SCREEN' in l); lb = next(i for i, l in enumerate(lines) if '<!-- ════ UPDATE PRICES MODAL' in l)
    out = set(range(len(lines))) - set(range(a, b + 1)) - set(range(la, lb)) - email_lines(lines)
    return {i for i in out if not LANDING.search(lines[i])}

SCOPES = {'feed': feed, 'collection': collection, 'track': track, 'wishlist': wishlist, 'stats': stats, 'profile': profile,
          'measure': measure, 'rest': rest, 'css_rest': css_rest, 'admin': admin, 'help': help_, 'modals_a': modals_a, 'modals_b': modals_b}
