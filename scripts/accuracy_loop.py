"""Self-healing accuracy loop — pure logic shared by the Sunday review.

Imported by scripts/weekly-measurement-review.py (deployed copy sits beside it in
~/.local/bin). No network here: everything is a function of session dicts and
experiment rows, so scripts/test-accuracy-loop.py can exercise every rule.

A knob trial is an `experiments` row keyed `tgknob_<knob>_<value>` (owner
'weekly_review'); the treatment arm runs the knob at <value>, control at the
fleet default. The arm a session ran under is read from its [TGTUNE] echo line —
log truth — never from the assignment table.
"""
import math
import re
from collections import defaultdict
from datetime import datetime, timedelta

# Fleet defaults (mirror index.html: PROV2_DEFAULTS + the _tgKnob literals). A won
# trial replaces its knob's default here via effective_defaults().
FLEET_DEFAULTS = {
    "tg_sigma": 0.0003, "tg_stabwin": 6, "tg_wallmin": 15, "tg_stabth": 3, "tg_maxwin": 16,
    "tg_agreeband": 12, "tg_lift": 52, "tg_ampmin": 90, "tg_confirmband": 999,
    "tg_guardmode": 1, "tg_gatemaxrej": 1, "tg_acquiremax": 15, "tg_periodfit": 2,
}
# Knobs that belong to the precision preset: the client applies a trial on these only
# to users on the default ('balanced') preset, so the analysis must use the same
# population or a strict user's stabWin=8 would be read as treatment.
PRESET_KNOBS = {"tg_stabwin", "tg_wallmin", "tg_stabth", "tg_maxwin"}

# How each knob shows up in the [TGTUNE] echo. tgKnobs=σ/stabwin/wallmin/stabth.
_TUNE_FIELD = {
    "tg_sigma": ("tgKnobs", 0), "tg_stabwin": ("tgKnobs", 1), "tg_wallmin": ("tgKnobs", 2), "tg_stabth": ("tgKnobs", 3),
    "tg_maxwin": ("maxWin", None), "tg_agreeband": ("agreeBand", None), "tg_lift": ("lift", None),
    "tg_ampmin": ("ampMin", None), "tg_confirmband": ("confirmBand", None), "tg_guardmode": ("guardMode", None),
    "tg_gatemaxrej": ("gateMaxRej", None), "tg_acquiremax": ("acquireMax", None), "tg_periodfit": ("periodFit", None),
}

# Decision rules (spec §3A)
MIN_CONV_PER_ARM = 60
MIN_USERS_PER_ARM = 15
PROMOTE_P = 0.05          # one-sided: treatment wrong-of-converged < control
REVERT_P = 0.20           # one-sided: treatment worse
GUARD_PP = 5.0            # guardrail: converged% or no-reading% worse by more than this
GUARD_P = 0.10
MAX_WEEKS = 3
START_ROLLOUT = 50


# ── keys ─────────────────────────────────────────────────────────────────
def parse_trial_key(key):
    """'tgknob_stabwin_8' → ('tg_stabwin', 8.0); 'tgknob_sigma_0p0005' → ('tg_sigma', 0.0005). None if not a trial key."""
    m = re.fullmatch(r"tgknob_([a-z]+)_(\d+(?:p\d+)?)", key or "")
    if not m:
        return None
    return "tg_" + m.group(1), float(m.group(2).replace("p", "."))


def trial_key(knob, value):
    v = float(value)
    s = str(int(v)) if v == int(v) else repr(v).replace(".", "p")
    return f"tgknob_{knob[3:] if knob.startswith('tg_') else knob}_{s}"


def parse_gate_label(label):
    """Gate-table knob label 'tg_stabwin=8' → ('tg_stabwin', 8.0); None for '(no knob)' rows."""
    m = re.fullmatch(r"(tg_[a-z]+)=([\d.]+)", (label or "").strip())
    return (m.group(1), float(m.group(2))) if m else None


# ── arms from the log ────────────────────────────────────────────────────
def tune_value(tune_line, knob):
    """The knob's effective value echoed in a [TGTUNE] line, or None when the build lacks it."""
    if not tune_line or knob not in _TUNE_FIELD:
        return None
    field, idx = _TUNE_FIELD[knob]
    m = re.search(rf"\b{field}=([^\s]+)", tune_line)
    if not m:
        return None
    raw = m.group(1)
    if idx is not None:
        parts = raw.split("/")
        if len(parts) <= idx:
            return None
        raw = parts[idx]
    try:
        return float(raw)
    except ValueError:
        return None


def _close(a, b):
    return a is not None and b is not None and abs(a - b) <= 1e-6 * max(1.0, abs(b))


def session_arm(tune_line, knob, treat_value, control_value):
    """'treatment' | 'control' | None (build lacks the knob, or a third value — personal override)."""
    v = tune_value(tune_line, knob)
    if v is None:
        return None
    if _close(v, treat_value):
        return "treatment"
    if _close(v, control_value):
        return "control"
    return None


def effective_defaults(experiments):
    """Fleet defaults with every won tgknob_* trial folded in (a won trial serves
    treatment to 100%, so its value IS the control baseline for the next trial)."""
    d = dict(FLEET_DEFAULTS)
    for e in experiments or []:
        p = parse_trial_key(e.get("key"))
        if p and e.get("status") == "won":
            d[p[0]] = p[1]
    return d


# ── stats ────────────────────────────────────────────────────────────────
def _norm_sf(z):
    """P(Z > z)."""
    return 0.5 * math.erfc(z / math.sqrt(2))


def two_prop_p_less(x_t, n_t, x_c, n_c):
    """One-sided p-value that the treatment proportion is LOWER than control. None if either arm is empty."""
    if not n_t or not n_c:
        return None
    pt, pc = x_t / n_t, x_c / n_c
    pool = (x_t + x_c) / (n_t + n_c)
    se = math.sqrt(pool * (1 - pool) * (1 / n_t + 1 / n_c))
    if se == 0:
        return 0.5
    return _norm_sf((pc - pt) / se)


def arm_table(sessions, knob, treat_value, control_value, since=None):
    """Bucket sessions into arms by their [TGTUNE] echo and count the outcomes.

    sessions: dicts with keys tune (str), uid, t (iso str), outcome ('sane'|'wrong'|'none'),
    conv (bool), precision (str|None). For a preset knob only 'balanced' sessions count.
    """
    arms = {a: dict(n=0, users=set(), conv=0, wrong_conv=0, none=0, sane=0) for a in ("control", "treatment")}
    for s in sessions:
        if since and (s.get("t") or "") < since:
            continue
        if knob in PRESET_KNOBS and (s.get("precision") or "balanced") != "balanced":
            continue
        arm = session_arm(s.get("tune"), knob, treat_value, control_value)
        if not arm:
            continue
        a = arms[arm]
        a["n"] += 1
        if s.get("uid"):
            a["users"].add(s["uid"])
        if s.get("conv"):
            a["conv"] += 1
            if s.get("outcome") == "wrong":
                a["wrong_conv"] += 1
        if s.get("outcome") == "none":
            a["none"] += 1
        if s.get("outcome") == "sane":
            a["sane"] += 1
    for a in arms.values():
        a["users"] = len(a["users"])
    return arms


def judge(arms, weeks_running):
    """Apply the decision rules to an arm table.

    Returns dict(verdict, action, reason, stats). verdict ∈ too_early | promote | revert |
    extend | inconclusive; action ∈ none | won | killed.
    """
    c, t = arms["control"], arms["treatment"]
    st = dict(
        p_primary=two_prop_p_less(t["wrong_conv"], t["conv"], c["wrong_conv"], c["conv"]),
        p_primary_worse=two_prop_p_less(c["wrong_conv"], c["conv"], t["wrong_conv"], t["conv"]),
        # guardrails: converged share (treatment lower = worse), no-reading share (treatment higher = worse)
        p_conv_worse=two_prop_p_less(t["conv"], t["n"], c["conv"], c["n"]),
        p_none_worse=two_prop_p_less(c["none"], c["n"], t["none"], t["n"]),
    )
    def pct(x, n): return 100.0 * x / n if n else None
    st.update(
        wrong_c=pct(c["wrong_conv"], c["conv"]), wrong_t=pct(t["wrong_conv"], t["conv"]),
        conv_c=pct(c["conv"], c["n"]), conv_t=pct(t["conv"], t["n"]),
        none_c=pct(c["none"], c["n"]), none_t=pct(t["none"], t["n"]),
    )
    thin = (min(c["conv"], t["conv"]) < MIN_CONV_PER_ARM or min(c["users"], t["users"]) < MIN_USERS_PER_ARM)
    if thin:
        if weeks_running >= MAX_WEEKS:
            return dict(verdict="inconclusive", action="killed", stats=st,
                        reason=f"still under {MIN_CONV_PER_ARM} converged sessions / {MIN_USERS_PER_ARM} users per arm after {weeks_running} weeks")
        return dict(verdict="too_early", action="none", stats=st,
                    reason=f"needs ≥{MIN_CONV_PER_ARM} converged sessions and ≥{MIN_USERS_PER_ARM} users per arm "
                           f"(control {c['conv']}/{c['users']}, treatment {t['conv']}/{t['users']})")
    guard = []
    if st["conv_t"] is not None and st["conv_c"] - st["conv_t"] > GUARD_PP and (st["p_conv_worse"] or 1) < GUARD_P:
        guard.append(f"converged {st['conv_t']:.0f}% vs {st['conv_c']:.0f}%")
    if st["none_t"] is not None and st["none_t"] - st["none_c"] > GUARD_PP and (st["p_none_worse"] or 1) < GUARD_P:
        guard.append(f"no-reading {st['none_t']:.0f}% vs {st['none_c']:.0f}%")
    if guard:
        return dict(verdict="revert", action="killed", stats=st, reason="guardrail: " + ", ".join(guard))
    if st["wrong_t"] > st["wrong_c"] and (st["p_primary_worse"] or 1) < REVERT_P:
        return dict(verdict="revert", action="killed", stats=st,
                    reason=f"wrong-of-converged {st['wrong_t']:.0f}% vs {st['wrong_c']:.0f}% (p={st['p_primary_worse']:.2f})")
    if st["wrong_t"] < st["wrong_c"] and (st["p_primary"] or 1) < PROMOTE_P:
        return dict(verdict="promote", action="won", stats=st,
                    reason=f"wrong-of-converged {st['wrong_t']:.0f}% vs {st['wrong_c']:.0f}% (p={st['p_primary']:.3f}), guardrails held")
    if weeks_running >= MAX_WEEKS:
        return dict(verdict="inconclusive", action="killed", stats=st,
                    reason=f"no significant difference after {weeks_running} weeks "
                           f"({st['wrong_t']:.0f}% vs {st['wrong_c']:.0f}%, p={st['p_primary']:.2f}); a change that cannot show a win does not stay")
    return dict(verdict="extend", action="none", stats=st,
                reason=f"not decisive yet ({st['wrong_t']:.0f}% vs {st['wrong_c']:.0f}%, p={st['p_primary']:.2f}); week {weeks_running} of {MAX_WEEKS}")


def weeks_since(started_at, now):
    """Review weeks a trial has been running, counting the starting week as 1."""
    s = _parse(started_at)
    if not s:
        return 1
    return max(1, math.ceil(((now - s).total_seconds() / 86400) / 7))


def _parse(s):
    s = (s or "").replace("Z", "").replace("+00:00", "")
    if "." in s:
        head, frac = s.split(".", 1)
        s = f"{head}.{(frac + '000000')[:6]}"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


# ── candidate selection ──────────────────────────────────────────────────
def pick_candidate(gate_rows, experiments, defaults, min_pb=15, max_pg=10, min_bb=10):
    """The next trial from the whole-era gate table. gate_rows: dicts with knob (label), desc,
    bb, gb, nb, ng, pb, pg, ratio. Skips rows without a real knob, rows whose value is already
    the fleet default (live), and any key that has ever been a trial (won/killed/archived/
    running/draft) — a reverted or refuted change is never retried."""
    tried = {e.get("key") for e in experiments or []}
    ok = []
    for r in gate_rows:
        kv = parse_gate_label(r.get("knob"))
        if not kv:
            continue
        knob, val = kv
        if _close(val, defaults.get(knob)):
            continue
        key = trial_key(knob, val)
        if key in tried:
            continue
        if r.get("pb") is None or r.get("pg") is None:
            continue
        if r["bb"] >= min_bb and r["pb"] >= min_pb and r["pg"] <= max_pg:
            ok.append((key, knob, val, r))
    ok.sort(key=lambda x: -(x[3].get("ratio") or 0))
    return ok[0] if ok else None


def running_trial(experiments):
    for e in experiments or []:
        if parse_trial_key(e.get("key")) and e.get("status") == "running":
            return e
    return None


def trial_name(knob, val, r=None):
    return f"{knob} = {val:g}" + (f" ({r['desc']})" if r else "")


# ── report text ──────────────────────────────────────────────────────────
def fmt_arm_table(arms):
    c, t = arms["control"], arms["treatment"]
    def pc(x, n): return "%.0f%%" % (100.0 * x / n) if n else "—"
    def row(label, cv, tv): return "%-26s%12s%12s" % (label, cv, tv)
    return [
        row("", "control", "treatment"),
        row("sessions / users", "%d / %d" % (c["n"], c["users"]), "%d / %d" % (t["n"], t["users"])),
        row("converged", pc(c["conv"], c["n"]), pc(t["conv"], t["n"])),
        row("wrong-of-converged ★", pc(c["wrong_conv"], c["conv"]), pc(t["wrong_conv"], t["conv"])),
        row("no reading", pc(c["none"], c["n"]), pc(t["none"], t["n"])),
        row("sane number", pc(c["sane"], c["n"]), pc(t["sane"], t["n"])),
    ]


def fmt_ledger(experiments):
    rows = [e for e in experiments or [] if parse_trial_key(e.get("key"))]
    rows.sort(key=lambda e: (e.get("started_at") or e.get("created_at") or ""))
    if not rows:
        return ["  (no trials yet)"]
    out = []
    for e in rows:
        knob, val = parse_trial_key(e["key"])
        d = (e.get("decided_at") or "")[:10]
        s = (e.get("started_at") or "")[:10]
        verdict = ""
        ev = e.get("last_eval") or {}
        if isinstance(ev, dict) and ev.get("verdict"):
            verdict = f" — {ev['verdict']}"
        when = ("decided " + d) if d else "running"
        out.append("  %-11s%s=%g  %-9s%s%s" % (s or "—", knob, val, e.get("status"), when, verdict))
    return out
