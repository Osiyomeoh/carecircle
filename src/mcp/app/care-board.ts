/**
 * The Care Board - CareCircle's MCP App view.
 *
 * This is the answer to the loudest entry in our own friction log: a voice turn
 * can carry about three items before a person stops holding the list, but the
 * real answer is a *ranked list with state* - severity, owner, due time, the
 * reason it was flagged, and how sure we are. Spoken, all of that structure gets
 * flattened into a sentence and thrown away. Here it survives.
 *
 * Two things this view does that a card normally does not:
 *
 * 1. **It shows its provenance.** Every row says how we came to believe it -
 *    a person told us, we inferred it by a named rule, or we simply have no
 *    record. "No record" is drawn as an absence of information, never as an
 *    accusation, because the difference between "Mom didn't take her pill" and
 *    "we have no record of the pill" is the difference between a useful system
 *    and a family argument.
 *
 * 2. **The ranking explains itself.** The score is not an opaque verdict from a
 *    model; it is cost x P(dropped) x confidence, and the row will show you the
 *    three numbers. A care ranking that cannot be audited should not be trusted.
 *
 * Claiming from here closes the multi-modal loop the log asked for: voice is the
 * right input for *capture* and the wrong one for *disambiguating similar items*.
 * A tap is unambiguous. The claim goes back through the host as a real
 * `tools/call`, hits the same authorisation path as speech, and then tells the
 * model what changed so the conversation stays in sync.
 *
 * The document is deliberately self-contained - no CDN, no fonts, no network
 * beyond the host bridge - so it needs no CSP allowlist and nothing can be
 * injected into a view that renders someone's medical coordination.
 */

export const CARE_BOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Care board</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: var(--color-background-primary, transparent);
    --fg: var(--color-text-primary, #12151c);
    --muted: var(--color-text-secondary, #5b6472);
    --faint: var(--color-text-tertiary, #8b94a3);
    --line: var(--color-border-primary, rgba(128, 140, 160, 0.22));
    --card: var(--color-background-secondary, rgba(128, 140, 160, 0.07));
    --radius: var(--border-radius-lg, 14px);
    --font: var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
    --high: #d6455b;
    --medium: #b8791b;
    --low: #2f8f6f;
  }
  [data-theme="dark"] {
    --fg: var(--color-text-primary, #eef1f6);
    --muted: var(--color-text-secondary, #a8b1c0);
    --faint: var(--color-text-tertiary, #78818f);
    --line: var(--color-border-primary, rgba(255, 255, 255, 0.14));
    --card: var(--color-background-secondary, rgba(255, 255, 255, 0.05));
    --high: #ff7a8a;
    --medium: #ffc45c;
    --low: #6fe0b4;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2px; background: var(--bg); color: var(--fg);
    font-family: var(--font); font-size: 14px; line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }
  .head { display: flex; align-items: baseline; gap: 8px; margin: 2px 2px 12px; }
  .title { font-weight: 600; font-size: 15px; letter-spacing: -0.01em; }
  .count { color: var(--faint); font-size: 12.5px; }
  .spacer { flex: 1; }
  .refresh {
    border: 0; background: none; color: var(--faint); font: inherit; font-size: 12.5px;
    cursor: pointer; padding: 2px 6px; border-radius: 6px;
  }
  .refresh:hover { color: var(--fg); background: var(--card); }

  .row {
    display: grid; grid-template-columns: 3px 1fr auto; gap: 14px;
    align-items: start; padding: 12px 14px 12px 0;
    background: var(--card); border: 1px solid var(--line);
    border-radius: var(--radius); margin-bottom: 8px; overflow: hidden;
  }
  .rail { align-self: stretch; border-radius: 3px; min-height: 100%; }
  .body { min-width: 0; padding: 1px 0; }
  .what { font-weight: 550; letter-spacing: -0.005em; overflow-wrap: anywhere; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 7px; }

  .chip {
    font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    padding: 2.5px 7px; border-radius: 999px; border: 1px solid currentColor;
    opacity: 0.95; white-space: nowrap;
  }
  .chip.sev-HIGH { color: var(--high); }
  .chip.sev-MEDIUM { color: var(--medium); }
  .chip.sev-LOW { color: var(--low); }
  /* Provenance is drawn quietly on purpose: it is context for a human judgement,
     not an alarm. An absent record must never look like a verdict. */
  .chip.prov { color: var(--faint); border-color: var(--line); font-weight: 500; }

  .because { color: var(--muted); font-size: 12.5px; margin-top: 6px; overflow-wrap: anywhere; }

  .score {
    border: 0; background: none; padding: 0; margin: 0; font: inherit;
    color: var(--faint); font-size: 12px; cursor: pointer; text-align: left;
    text-decoration: underline; text-decoration-style: dotted;
    text-underline-offset: 3px; text-decoration-color: var(--line);
  }
  .score:hover { color: var(--fg); }
  .maths {
    margin-top: 6px; font-size: 12px; color: var(--muted);
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    border-left: 2px solid var(--line); padding: 2px 0 2px 9px;
  }
  .maths .k { color: var(--faint); }

  .act { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; padding-top: 1px; }
  .claim {
    font: inherit; font-size: 12.5px; font-weight: 550;
    padding: 6px 13px; border-radius: 999px; cursor: pointer; white-space: nowrap;
    border: 1px solid var(--line); background: transparent; color: var(--fg);
    transition: background 120ms ease, border-color 120ms ease;
  }
  .claim:hover:not(:disabled) { background: var(--fg); color: var(--bg, #fff); border-color: var(--fg); }
  .claim:disabled { opacity: 0.5; cursor: default; }
  .owned { color: var(--muted); font-size: 12.5px; white-space: nowrap; }

  .note { color: var(--faint); font-size: 12.5px; padding: 10px 2px; }
  .err {
    color: var(--high); font-size: 12.5px; padding: 10px 12px;
    border: 1px solid currentColor; border-radius: var(--radius); margin-bottom: 8px;
  }
  .foot { color: var(--faint); font-size: 11.5px; margin: 10px 2px 2px; }
</style>
</head>
<body>
<div id="root"><div class="note">Loading the care board…</div></div>
<script>
(function () {
  "use strict";

  // ---- Host bridge: MCP JSON-RPC over postMessage -------------------------
  // The extension deliberately reuses MCP's own envelope rather than inventing a
  // widget protocol, so everything below is ordinary JSON-RPC that happens to
  // travel through window.parent.

  var PROTOCOL_VERSION = "2026-01-26";
  var nextId = 1;
  var pending = new Map();
  var host = { capabilities: {}, context: {} };
  /** Set once the host pushes the result that opened this view. */
  var painted = false;

  function post(msg) {
    try { window.parent.postMessage(msg, "*"); } catch (e) { /* no host */ }
  }

  function request(method, params) {
    var id = nextId++;
    post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        pending.delete(id);
        reject(new Error("The host did not answer " + method + "."));
      }, 30000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
    });
  }

  function notify(method, params) {
    post({ jsonrpc: "2.0", method: method, params: params || {} });
  }

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;

    if (msg.id !== undefined && msg.method === undefined) {
      var waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.error) waiter.reject(new Error(msg.error.message || "Request failed."));
      else waiter.resolve(msg.result);
      return;
    }

    // The host pushes the originating tool's result in, so the first paint needs
    // no round trip - the data that produced this view arrives with it.
    if (msg.method === "ui/notifications/tool-result") {
      painted = true;
      render(gapsFrom(msg.params));
      return;
    }
    if (msg.method === "ui/notifications/host-context-changed") {
      applyHostContext(msg.params && msg.params.hostContext);
      return;
    }
  });

  // ---- Theming: inherit the host's own design tokens -----------------------
  // A view that ignores these looks like an embedded website. Adopting them lets
  // the board read as part of whatever surface is drawing it.
  function applyHostContext(ctx) {
    if (!ctx) return;
    host.context = ctx;
    if (ctx.theme) {
      document.documentElement.setAttribute("data-theme", ctx.theme);
      // The host's theme has to win over the browser's own preference. Without
      // this, a light-themed host inside a dark-mode browser keeps the user
      // agent's dark canvas while we paint the host's dark text onto it, and
      // the board is unreadable - which is worse than not rendering at all.
      document.documentElement.style.colorScheme = ctx.theme;
    }
    var styles = ctx.styles && (ctx.styles.variables || ctx.styles);
    if (styles && typeof styles === "object") {
      Object.keys(styles).forEach(function (k) {
        if (k.indexOf("--") === 0 && typeof styles[k] === "string") {
          document.documentElement.style.setProperty(k, styles[k]);
        }
      });
    }
  }

  // ---- Size: tell the host how tall we actually are ------------------------
  var lastHeight = 0;
  function reportSize() {
    var h = Math.ceil(document.body.scrollHeight);
    if (h && h !== lastHeight) {
      lastHeight = h;
      notify("ui/notifications/size-changed", { height: h });
    }
  }

  // ---- Data ----------------------------------------------------------------

  function gapsFrom(result) {
    if (!result) return null;
    var sc = result.structuredContent;
    if (sc && Array.isArray(sc.gaps)) return sc.gaps;
    return null;
  }

  function canCallTools() {
    return !!(host.capabilities && host.capabilities.serverTools);
  }

  function callTool(name, args) {
    return request("tools/call", { name: name, arguments: args || {} });
  }

  function refresh() {
    if (!canCallTools()) return Promise.resolve();
    return callTool("get_care_gaps", {}).then(function (result) {
      var gaps = gapsFrom(result);
      if (gaps) render(gaps);
    }).catch(function (err) { renderError(err.message); });
  }

  // ---- Rendering -----------------------------------------------------------

  var root = document.getElementById("root");

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  /** The spoken line already ends with its own clause for the ear
   *  ("- nobody has taken this yet"); on screen the chip says that. */
  function headline(spoken) {
    return String(spoken || "").replace(/\s[-–]\s[^-–]*$/, "").trim() || String(spoken || "");
  }

  /** How we came to believe this - the sentence a family can check us on. */
  var PROVENANCE = {
    UNCLAIMED: { label: "Needs an owner", title: "Confirmed work that nobody has taken on." },
    UNCONFIRMED: {
      label: "No record",
      title: "Nothing has been logged for this. That is an absence of information, "
        + "not evidence that it did not happen."
    },
    NEEDS_FOLLOW_UP: { label: "Follow up", title: "Started or handled long enough ago to be worth checking." }
  };

  function renderError(message) {
    root.replaceChildren(el("div", "err", message));
    reportSize();
  }

  function render(gaps) {
    if (!Array.isArray(gaps)) return;
    root.replaceChildren();

    var head = el("div", "head");
    head.append(el("span", "title", "Care board"));
    head.append(el("span", "count", gaps.length === 1 ? "1 open" : gaps.length + " open"));
    head.append(el("span", "spacer"));
    if (canCallTools()) {
      var r = el("button", "refresh", "Refresh");
      r.addEventListener("click", function () { refresh(); });
      head.append(r);
    }
    root.append(head);

    if (!gaps.length) {
      root.append(el("div", "note", "Nothing is unowned right now."));
      reportSize();
      return;
    }

    gaps.forEach(function (gap) { root.append(renderRow(gap)); });

    root.append(el(
      "div", "foot",
      "Ranked by expected harm: cost × likelihood it is dropped × our confidence. "
        + "Tap a score to see the arithmetic."
    ));
    reportSize();
  }

  function renderRow(gap) {
    var row = el("div", "row");
    var sev = gap.severity || "LOW";

    var rail = el("div", "rail");
    rail.style.background = "var(--" + sev.toLowerCase() + ")";
    row.append(rail);

    var body = el("div", "body");
    body.append(el("div", "what", headline(gap.spoken)));

    var meta = el("div", "meta");
    meta.append(el("span", "chip sev-" + sev, sev));

    var prov = PROVENANCE[gap.kind];
    if (prov) {
      var chip = el("span", "chip prov", prov.label);
      chip.title = prov.title;
      meta.append(chip);
    }

    if (typeof gap.score === "number") {
      var score = el("button", "score", "score " + gap.score);
      var maths = null;
      score.addEventListener("click", function () {
        if (maths) { maths.remove(); maths = null; reportSize(); return; }
        maths = renderMaths(gap);
        body.append(maths);
        reportSize();
      });
      meta.append(score);
    }
    body.append(meta);

    if (gap.because) body.append(el("div", "because", gap.because));
    row.append(body);

    // ---- The action -------------------------------------------------------
    var act = el("div", "act");
    if (gap.obligationId && canCallTools()) {
      var btn = el("button", "claim", "I'll take it");
      btn.addEventListener("click", function () {
        btn.disabled = true;
        btn.textContent = "Claiming…";
        claim(gap, btn);
      });
      act.append(btn);
    } else if (!gap.obligationId) {
      // An unconfirmed record has nothing to assign yet - it needs a person to
      // say what actually happened, which is a conversation, not a button.
      act.append(el("div", "owned", "Ask, don't assign"));
    }
    row.append(act);

    return row;
  }

  function renderMaths(gap) {
    var f = gap.factors || {};
    var maths = el("div", "maths");
    function line(key, value) {
      var d = el("div");
      d.append(el("span", "k", key + " "));
      d.append(document.createTextNode(value));
      return d;
    }
    maths.append(line("cost", fmt(f.cost) + "  — how much harm if it is dropped"));
    maths.append(line("p(dropped)", fmt(f.pDrop) + "  — from its deadline and how long it has sat"));
    maths.append(line("confidence", fmt(f.confidence) + "  — how sure we are the gap is real"));
    maths.append(line("= score", typeof gap.score === "number" ? gap.score : "—"));
    return maths;
  }

  function fmt(n) { return typeof n === "number" ? n.toFixed(2) : "—"; }

  function claim(gap, btn) {
    callTool("claim_obligation", { obligationId: gap.obligationId })
      .then(function (result) {
        // The server speaks for itself, including when it refuses - someone else
        // may already own this, and the view must not pretend otherwise.
        var text = firstText(result);
        if (result && result.isError) {
          btn.disabled = false;
          btn.textContent = "I'll take it";
          renderNotice(btn, text || "That could not be claimed.");
          return;
        }
        tellModel(text || "I claimed this from the care board.", gap);
        return refresh();
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "I'll take it";
        renderNotice(btn, err.message);
      });
  }

  function renderNotice(btn, message) {
    var note = el("div", "owned", message);
    note.style.maxWidth = "220px";
    note.style.whiteSpace = "normal";
    note.style.textAlign = "right";
    btn.parentNode.append(note);
    reportSize();
  }

  function firstText(result) {
    if (!result || !Array.isArray(result.content)) return "";
    for (var i = 0; i < result.content.length; i++) {
      if (result.content[i] && result.content[i].type === "text") return result.content[i].text;
    }
    return "";
  }

  /**
   * Keep the conversation honest about what the hands just did.
   *
   * Without this the model would go on believing the board it was told about at
   * the start of the turn, and would offer work that is already taken. A tap is
   * a real change to the shared record, so the model is told about it the same
   * way it would be told about anything else.
   */
  function tellModel(text, gap) {
    if (!host.capabilities || !host.capabilities.updateModelContext) return;
    notify("ui/update-model-context", {
      content: [{ type: "text", text: text }],
      structuredContent: { claimed: { obligationId: gap.obligationId, was: gap.spoken } }
    });
  }

  // ---- Start ---------------------------------------------------------------

  request("ui/initialize", {
    appInfo: { name: "carecircle-care-board", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    protocolVersion: PROTOCOL_VERSION
  }).then(function (result) {
    host.capabilities = (result && result.hostCapabilities) || {};
    applyHostContext(result && result.hostContext);
    notify("ui/notifications/initialized", {});

    // The host normally pushes the result that opened this view, so asking for
    // it immediately would fetch the same data twice. Give that push a moment,
    // then fall back for hosts that only answer when asked.
    setTimeout(function () { if (!painted) refresh(); }, 400);
  }).catch(function (err) {
    renderError("This view could not reach its host. " + err.message);
  });

  window.addEventListener("resize", reportSize);
})();
</script>
</body>
</html>
`;
