// Generated from index.html (i18n-runtime block + boot observer) by scripts/i18n.mjs. Do not edit.
function tx(s, vars) {
  var d = window.WR_I18N && window.WR_I18N.dict;
  var out = (d && Object.prototype.hasOwnProperty.call(d, s)) ? d[s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? vars[k] : m; });
  return out;
}
// Translates the static markup in place. lookup(english) returns the translation or
// nothing. Skipped: the sign-in screen (not to be modified), the admin portal, and
// the older release notes (data-i18n-skip). A run of text with bare inline tags ("Tap <b>Add</b>")
// is one entry keyed by its innerHTML, so the sentence is translated whole.
// Text a member wrote (a watch, strap or club name, a caption, a message) is theirs and is
// never translated, even when it spells one of our labels ("Steel", "Date"). escUser() writes
// it between <!--u--> and <!--/u-->, which the walker steps over; i18nMine() remembers it for
// the places a marker cannot go (attributes, a name inside a sentence).
function i18nMine(s) {
  if (window.WR_I18N && typeof s === 'string' && s.length < 80) {
    var k = s.replace(/\s+/g, ' ').trim();
    if (k) (i18nMine.set || (i18nMine.set = new Set())).add(k);
  }
  return s;
}
function i18nIsMine(k) { return !!(i18nMine.set && i18nMine.set.has(k)); }
function i18nWalk(root, lookup) {
  var SKIP = '#auth-screen,#page-admin,#admin-user-modal,#adm-exp-info-modal,[data-i18n-skip]';
  var SKIP_TAG = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|svg|CANVAS)$/;
  var INLINE = /^(B|STRONG|EM|I|U|BR|CODE|KBD)$/;
  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  function norm(v) { return v.replace(/\s+/g, ' ').trim(); }
  // What we wrote, per node: a translation that happens to spell another English label
  // (Italian "Post" for "Posts") must not be translated a second time when it comes back.
  var done = i18nWalk.done || (i18nWalk.done = new WeakMap());
  function isPhrase(el) {
    var text = false, tag = false;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { if (c.nodeValue.trim()) text = true; }
      else if (c.nodeType === 1) {
        if (!INLINE.test(c.tagName) || c.attributes.length || c.firstElementChild) return false;
        tag = true;
      } else return false;
    }
    return text && tag;
  }
  (function walk(el) {
    if (SKIP_TAG.test(el.tagName) || el.matches(SKIP)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = el.getAttribute(ATTRS[i]);
      if (a && (done.get(el) || {})[ATTRS[i]] !== a && !i18nIsMine(norm(a))) {
        var ra = lookup(norm(a));
        if (ra) { var rec = done.get(el) || {}; rec[ATTRS[i]] = ra; done.set(el, rec); el.setAttribute(ATTRS[i], ra); }
      }
    }
    // A sentence with bare inline tags is tried whole first; if there is no entry for it,
    // its pieces are still translated one by one below.
    if (isPhrase(el)) { var rp = lookup(norm(el.innerHTML)); if (rp) { el.innerHTML = rp; return; } if (lookup.wholeOnly) return; }
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) walk(c);
      else if (c.nodeType === 3) {
        var k = norm(c.nodeValue); if (!k || done.get(c) === c.nodeValue) continue;
        var pv = c.previousSibling; if (pv && pv.nodeType === 8 && pv.nodeValue === 'u') continue;
        var r = lookup(k); if (!r) continue;
        // An <option> without value="" submits its text: pin the English before changing it.
        if (el.tagName === 'OPTION' && !el.hasAttribute('value')) el.setAttribute('value', k);
        var out = c.nodeValue.replace(c.nodeValue.trim(), r);
        done.set(c, out); c.nodeValue = out;
      }
    }
  })(root);
}
// A string with numbers in it ("3 wears", "2h ago") is looked up as written first, then
// as a pattern with the numbers lifted out: "{0} wears" -> "{0} usos". English already
// picked singular or plural, and the pattern keeps that choice.
function i18nLookup(k) {
  var d = window.WR_I18N && window.WR_I18N.dict;
  if (!d) return;
  if (Object.prototype.hasOwnProperty.call(d, k)) return d[k];
  var nums = [], pat = k.replace(/\d+(?:[.,]\d+)*/g, function (m) { nums.push(m); return '{' + (nums.length - 1) + '}'; });
  if (nums.length && Object.prototype.hasOwnProperty.call(d, pat)) return d[pat].replace(/\{(\d+)\}/g, function (m, i) { return i in nums ? nums[i] : m; });
  // Sort headers carry an arrow: "Paid ↕".
  var arrow = /^(.*\S)\s*([↕↓↑▾▴→])$/.exec(k);
  if (arrow) { var ra = i18nLookup(arrow[1]); if (ra) return ra + ' ' + arrow[2]; }
  // "2h ago · work": the pieces around a middle dot are labels in their own right.
  if (k.indexOf('·') >= 0) {
    var hit = false, joined = k.replace(/[^·]+/g, function (seg) {
      var p = seg.trim(), r = p && !i18nIsMine(p) && i18nLookup(p);
      if (!r) return seg;
      hit = true; return seg.replace(p, r);
    });
    if (hit) return joined;
  }
  // A sentence built around a name or a watch: "{0} has never been logged" matches
  // "Submariner Date has never been logged". What a hole caught is itself looked up, so a
  // weekday or an occasion inside the sentence is translated too; a name comes back as is.
  var pats = i18nPatterns(d);
  for (var i = 0; i < pats.length; i++) {
    if (k.indexOf(pats[i].chunk) < 0) continue;
    var m = pats[i].re.exec(k);
    if (m) return pats[i].out.replace(/\{(\d+)\}/g, function (x, n, off) {
      var at = pats[i].order.indexOf(+n);
      if (at < 0) return x;
      var c = m[at + 1].trim();
      var r = /[A-Za-z]{2}/.test(c) && c.length < 40 && !i18nIsMine(c) ? (i18nLookup(c) || c) : c;
      // Spanish, French, Italian and Portuguese write a weekday in lower case inside a
      // sentence ("los viernes"); the dictionary entry is capitalised for use on its own.
      if (off > 0 && r !== c && /^(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day$/.test(c) &&
          /^(es|fr|it|pt)$/.test(window.WR_I18N.lang || '')) r = r.charAt(0).toLowerCase() + r.slice(1);
      return r;
    });
  }
  // Several sentences in one line ("… its first wear. One of your top-ranked watches."):
  // each is looked up on its own, with and without its full stop.
  var sents = k.split(/(?<=[.!?])\s+(?=\S)/);
  if (sents.length > 1) {
    var any = false, outS = sents.map(function (sn) {
      var r = i18nLookup(sn);
      if (!r && /\.$/.test(sn)) { r = i18nLookup(sn.slice(0, -1)); if (r) r += '.'; }
      if (r) any = true;
      return r || sn;
    });
    if (any) return outS.join(' ');
  }
  if (window.__i18nMiss && /[A-Za-z]{2}/.test(k)) window.__i18nMiss.add(k);
}
// Entries with {0}-style holes, as regular expressions, most specific first. Built once.
// An entry needs real words around its holes (8+ letters), or it would match anything.
function i18nPatterns(d) {
  if (i18nPatterns.list) return i18nPatterns.list;
  var list = [];
  for (var key in d) {
    if (key.indexOf('{') < 0 || !Object.prototype.hasOwnProperty.call(d, key) || d[key] === key) continue;
    var parts = key.split(/\{\d+\}/), letters = parts.join('').replace(/[^A-Za-z]/g, '').length;
    if (parts.length < 2 || letters < 8) continue;
    var order = (key.match(/\{\d+\}/g) || []).map(function (h) { return +h.slice(1, -1); });
    var chunk = parts.slice().sort(function (a, b) { return b.length - a.length; })[0];
    var re = new RegExp('^' + parts.map(function (p) { return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('(.+?)') + '$');
    list.push({ re: re, chunk: chunk, out: d[key], order: order, weight: letters });
  }
  list.sort(function (a, b) { return b.weight - a.weight; });
  return (i18nPatterns.list = list);
}
(function () {
  if (!window.WR_I18N) return;
  i18nWalk.done = i18nWalk.done || new WeakMap();
  // Everything the script draws later (cards, lists, modals) is translated as it lands.
  // Whole-string matches only, so a caption or a watch name is left alone unless it is
  // letter-for-letter a label of ours. Our own writes come back through here and are
  // recognised by the walker's memory, which ends the loop.
  var _i18nSkip = '#auth-screen,#page-admin,#admin-user-modal,#adm-exp-info-modal,[data-i18n-skip]';
  var _i18nSeen = function (k) { return i18nLookup(k); };
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i], host = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!host || host.closest(_i18nSkip)) continue;
      if (m.type === 'attributes') {
        var v = host.getAttribute(m.attributeName), rec = i18nWalk.done.get(host) || {};
        if (!v || rec[m.attributeName] === v || i18nIsMine(v.replace(/\s+/g, ' ').trim())) continue;
        var r = i18nLookup(v.replace(/\s+/g, ' ').trim());
        if (r) { rec[m.attributeName] = r; i18nWalk.done.set(host, rec); host.setAttribute(m.attributeName, r); }
      } else if (m.type === 'characterData') {
        i18nWalk(host, _i18nSeen);
      } else {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 1) i18nWalk(n, _i18nSeen);
          else if (n.nodeType === 3 && n.nodeValue.trim()) i18nWalk(host, _i18nSeen);
        }
      }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title', 'alt'] });
  var all = function () { if (document.body) i18nWalk(document.body, i18nLookup); };
  all();
  document.addEventListener('DOMContentLoaded', all);
})();
