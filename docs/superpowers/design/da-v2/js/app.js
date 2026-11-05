// Prototype DA v2 : aucune dépendance. Styles posés par CSSOM et Web Animations (compatibles avec style-src 'self').
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const params = new URLSearchParams(location.search);
  const html = document.documentElement;
  if (params.has("shot")) html.classList.add("shot");
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const live = (m) => { const el = $("#live"); el.textContent = ""; requestAnimationFrame(() => (el.textContent = m)); };
  const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
  const EASE_IN = "cubic-bezier(0.7, 0, 0.84, 0)";
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const fr = (n, d = 1) => n.toFixed(d).replace(".", ",");
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  document.addEventListener("visibilitychange", () => html.classList.toggle("is-hidden", document.hidden));

  /* ---------- Capsule : contour qui part du milieu du bord haut, sens horaire ---------- */
  function capPath(w, h, r, i = 0.75) {
    const x0 = i, y0 = i, x1 = w - i, y1 = h - i, cx = w / 2;
    r = Math.max(0, Math.min(r - i, (y1 - y0) / 2, (x1 - x0) / 2));
    return `M${cx} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}` +
      `H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}H${cx}`;
  }
  function fit(svg) {
    const host = svg.parentElement;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const r = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 24;
    const d = capPath(w, h, r);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    $$("path", svg).forEach((p) => p.setAttribute("d", d));
    const notch = $(".cl-notch", svg);
    if (notch) { notch.setAttribute("x1", w / 2); notch.setAttribute("x2", w / 2); notch.setAttribute("y1", -4); notch.setAttribute("y2", 5); }
  }
  const ro = new ResizeObserver((es) => es.forEach((e) => { const s = $(":scope > svg.vline, :scope > svg.cline, :scope > svg.mline, :scope > svg.gline", e.target); if (s) { fit(s); if (s.classList.contains("cline")) placeTip(); } }));
  $$(".vline, .cline, .mline, .gline").forEach((s) => ro.observe(s.parentElement));
  const fitAll = () => $$(".vline, .cline, .mline, .gline").forEach(fit);

  /* ---------- Photos peintes (contenu d'exemple, pas de vraies photos) ---------- */
  const painters = {
    shore(c) {
      const g = c.createLinearGradient(0, 0, 0, 300);
      g.addColorStop(0, "#070b16"); g.addColorStop(0.55, "#11243b"); g.addColorStop(1, "#28506a");
      c.fillStyle = g; c.fillRect(0, 0, 720, 300);
      const r = rng(11);
      for (let k = 0; k < 140; k++) { c.globalAlpha = 0.2 + r() * 0.7; c.fillStyle = "#e8eef8"; const s = r() < 0.9 ? 1 : 2; c.fillRect(r() * 720, r() * 230, s, s); }
      c.globalAlpha = 1;
      const mg = c.createRadialGradient(520, 110, 0, 520, 110, 120);
      mg.addColorStop(0, "rgba(240,236,220,0.35)"); mg.addColorStop(1, "rgba(240,236,220,0)");
      c.fillStyle = mg; c.fillRect(380, 0, 300, 260);
      c.fillStyle = "#f1ecdc"; c.beginPath(); c.arc(520, 110, 26, 0, 7); c.fill();
      const sg = c.createLinearGradient(0, 300, 0, 430);
      sg.addColorStop(0, "#173247"); sg.addColorStop(1, "#08131f");
      c.fillStyle = sg; c.fillRect(0, 300, 720, 140);
      for (let k = 0; k < 26; k++) { const y = 304 + k * 5 + r() * 3; const w = 60 - k * 1.6 + r() * 30; c.globalAlpha = 0.5 - k * 0.016; c.fillStyle = "#f1ecdc"; c.fillRect(520 - w / 2 + (r() - 0.5) * 20, y, w, 1.5); }
      c.globalAlpha = 1;
      c.fillStyle = "#e0b45e"; c.fillRect(96, 290, 3, 10); c.globalAlpha = 0.5; c.fillRect(92, 287, 11, 2); c.globalAlpha = 1;
      const bg = c.createLinearGradient(0, 420, 0, 540);
      bg.addColorStop(0, "#1d1a1c"); bg.addColorStop(1, "#0c0b0d");
      c.fillStyle = bg; c.beginPath(); c.moveTo(0, 440); c.bezierCurveTo(200, 400, 460, 470, 720, 420); c.lineTo(720, 540); c.lineTo(0, 540); c.fill();
      c.strokeStyle = "rgba(220,235,240,0.35)"; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 438); c.bezierCurveTo(200, 398, 460, 468, 720, 418); c.stroke();
    },
    roofs(c) {
      const g = c.createLinearGradient(0, 0, 0, 380);
      g.addColorStop(0, "#141b33"); g.addColorStop(0.6, "#3a3f63"); g.addColorStop(0.85, "#a8686a"); g.addColorStop(1, "#e3a073");
      c.fillStyle = g; c.fillRect(0, 0, 720, 540);
      const r = rng(5);
      let x = -20;
      c.fillStyle = "#151925";
      const wins = [];
      while (x < 740) {
        const w = 70 + r() * 90, h = 160 + r() * 140, top = 540 - h;
        c.beginPath(); c.moveTo(x, 540); c.lineTo(x, top + 30); c.lineTo(x + w * 0.2, top); c.lineTo(x + w * 0.8, top); c.lineTo(x + w, top + 30); c.lineTo(x + w, 540); c.fill();
        for (let k = 0; k < 2 + r() * 3; k++) { const cx = x + 10 + r() * (w - 24); c.fillRect(cx, top - 18 - r() * 14, 9, 34); c.fillRect(cx - 2, top - 22 - r() * 4, 13, 4); }
        for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) if (r() < 0.32) wins.push([x + 12 + col * (w - 24) / 3, top + 50 + row * 42]);
        x += w - 6;
      }
      for (const [wx, wy] of wins) { c.fillStyle = r() < 0.7 ? "#f2c46d" : "#f6dfa4"; c.globalAlpha = 0.85; c.fillRect(wx, wy, 12, 18); }
      c.globalAlpha = 1;
    },
    candles(c) {
      c.fillStyle = "#0d0907"; c.fillRect(0, 0, 720, 540);
      const r = rng(9);
      for (let k = 0; k < 22; k++) {
        const x = r() * 720, y = r() * 320, rad = 18 + r() * 46;
        const b = c.createRadialGradient(x, y, 0, x, y, rad);
        b.addColorStop(0, `rgba(242,${150 + r() * 60 | 0},90,${0.18 + r() * 0.2})`); b.addColorStop(1, "rgba(242,170,90,0)");
        c.fillStyle = b; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      c.fillStyle = "#3a2622"; c.fillRect(200, 330, 320, 150);
      c.fillStyle = "#e9d8c8"; c.fillRect(200, 322, 320, 22);
      for (const cx of [290, 360, 430]) {
        c.fillStyle = "#c9b6ff"; c.fillStyle = "#e6e0d4"; c.fillRect(cx - 4, 268, 8, 56);
        const f = c.createRadialGradient(cx, 252, 0, cx, 252, 46);
        f.addColorStop(0, "rgba(255,214,140,0.9)"); f.addColorStop(0.25, "rgba(255,180,90,0.45)"); f.addColorStop(1, "rgba(255,160,80,0)");
        c.fillStyle = f; c.fillRect(cx - 46, 206, 92, 92);
        c.fillStyle = "#fff4d6"; c.beginPath(); c.ellipse(cx, 254, 5, 11, 0, 0, 7); c.fill();
      }
    },
  };
  function paint(cv) {
    if (cv.dataset.painted) return;
    const fn = painters[cv.dataset.paint]; if (!fn) return;
    const c = cv.getContext("2d");
    const s = Math.max(cv.width / 720, cv.height / 540);
    c.save(); c.translate((cv.width - 720 * s) / 2, (cv.height - 540 * s) / 2); c.scale(s, s); fn(c); c.restore();
    cv.dataset.painted = "1";
  }
  const paintAll = () => $$("canvas[data-paint]").forEach(paint);

  /* ---------- Navigation entre écrans (View Transitions) ---------- */
  const compose = $(".s-compose");
  function show(name) {
    const screen = name === "home" || name === "compose" ? "compose" : name;
    $$(".screen").forEach((s) => (s.hidden = s.dataset.screen !== screen));
    document.body.dataset.screen = screen;
    if (screen === "compose") compose.classList.toggle("has-items", name === "compose");
    const el = $(`.screen[data-screen="${screen}"]`);
    el.classList.remove("is-entering"); void el.offsetWidth; el.classList.add("is-entering");
    window.scrollTo(0, 0);
    fitAll(); paintAll();
    const h = $("h1", el); if (h && name !== "home") h.focus({ preventScroll: true });
  }
  function go(name, { instant = false } = {}) {
    if (!instant && document.startViewTransition) return document.startViewTransition(() => show(name)).finished;
    show(name); return Promise.resolve();
  }

  /* ---------- Accueil ---------- */
  const vessel = $("#vessel");
  const spot = $(".spot");
  let spotRaf = 0, spotXY = [0, 0];
  vessel.addEventListener("pointerenter", () => vessel.classList.add("is-lit"));
  vessel.addEventListener("pointerleave", () => vessel.classList.remove("is-lit"));
  vessel.addEventListener("pointermove", (e) => {
    const r = vessel.getBoundingClientRect(); spotXY = [e.clientX - r.left, e.clientY - r.top];
    if (!spotRaf) spotRaf = requestAnimationFrame(() => { spot.style.transform = `translate(${spotXY[0]}px, ${spotXY[1]}px)`; spotRaf = 0; });
  });
  let dragDepth = 0;
  document.addEventListener("dragenter", (e) => { e.preventDefault(); if (++dragDepth === 1) vessel.classList.add("is-drop"); });
  document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; vessel.classList.remove("is-drop"); } });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => { e.preventDefault(); dragDepth = 0; vessel.classList.remove("is-drop"); fill(); });
  function fill() {
    if (compose.classList.contains("has-items")) return;
    compose.classList.add("is-filling");
    go("compose").then(() => setTimeout(() => compose.classList.remove("is-filling"), 900));
    live("6 éléments ajoutés.");
  }
  $$("[data-add]").forEach((b) => b.addEventListener("click", fill));
  const seg = $(".seg"); seg.dataset.i = "2";
  $$(".seg button").forEach((b, i) => b.addEventListener("click", () => {
    $$(".seg button").forEach((x) => x.setAttribute("aria-checked", String(x === b))); seg.dataset.i = String(i);
  }));
  const WORDS = ["brume", "lanterne", "quartz", "ravin", "falaise", "sorbet", "orage", "cobalt", "marelle", "tilleul", "ancre", "givre", "hibou", "prisme", "velours", "zinc"];
  const GLYPHS = "abcdefghijkmnopqrstuvwxyz0123456789+/=";
  $("[data-regen]").addEventListener("click", () => {
    const spans = $$("[data-pass] span"); const r = rng(Date.now());
    const next = spans.map(() => WORDS[(r() * WORDS.length) | 0]);
    if (reduced()) { spans.forEach((s, i) => (s.textContent = next[i])); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = clamp((t - t0) / 520);
      spans.forEach((s, i) => { const w = next[i]; const n = Math.floor(clamp(k * 1.6 - i * 0.15) * w.length); s.textContent = w.slice(0, n) + Array.from(w.slice(n), () => GLYPHS[(r() * GLYPHS.length) | 0]).join(""); });
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  /* ---------- Scellement ---------- */
  const cap = $("#capsule");
  const prog = $(".cl-prog", cap), tip = $(".cl-tip", cap), halo = $(".cl-tip-halo", cap);
  const names = $$("[data-scr]", cap).map((el) => ({ el, text: el.textContent }));
  let P = 0;
  const ccW = $(".cc-w", cap), ccI = $(".cc-i", cap);
  (function () {
    const r = rng(77); const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    $("[data-capcipher]").textContent = Array.from({ length: 22 }, () => Array.from({ length: 96 }, () => B[(r() * 64) | 0]).join("")).join("\n");
  })();
  function placeTip() {
    if (!prog.getAttribute("d")) return;
    const L = prog.getTotalLength(); const pt = prog.getPointAtLength(Math.max(0.01, P) * L);
    [tip, halo].forEach((c) => { c.setAttribute("cx", pt.x); c.setAttribute("cy", pt.y); });
  }
  function setProgress(p) {
    P = clamp(p);
    prog.style.strokeDasharray = `${P * 100} 100`;
    // Volet composité : le texte chiffré recouvre la capsule au rythme des octets envoyés.
    ccW.style.transform = `translateX(${(P - 1) * 100}%)`;
    ccI.style.transform = `translateX(${(1 - P) * 100}%)`;
    placeTip();
    $("[data-pct]").textContent = String(Math.floor(P * 100));
    $("[data-sent]").textContent = `${Math.round(P * 200)} Mo`;
    $("[data-block]").textContent = `Bloc ${Math.floor(P * 50)} / 50`;
    const salt = Math.floor(P * 60);
    names.forEach(({ el, text }, i) => {
      const k = clamp(P * 1.35 - i * 0.08);
      const n = Math.floor(k * text.length); const r = rng(salt * 31 + i * 7 + 1);
      el.textContent = Array.from(text.slice(0, n), (ch) => (ch === " " ? " " : GLYPHS[(r() * GLYPHS.length) | 0])).join("") + text.slice(n);
      el.style.filter = reduced() ? "" : `blur(${(k * 1.6).toFixed(2)}px)`;
      el.style.opacity = String(1 - k * 0.45);
    });
    document.title = `${Math.floor(P * 100)} % · Shhdrop`;
  }
  function setPhase(key) {
    const L = {
      keys: ["Préparation des clés", "Argon2id, environ 1 s"],
      captcha: ["Vérification anti-robot", "calcul sur votre appareil"],
      upload: ["Chiffrement et envoi", "chaque bloc est chiffré juste avant d'être envoyé"],
      final: ["Finalisation", "le serveur confirme la réception"],
      paused: ["En pause", "reprise automatique dans 9:12"],
      sealed: ["Scellé", "le serveur a confirmé\u202f: le lien est prêt"],
    }[key];
    $("[data-phase]").textContent = L[0]; $("[data-phasesub]").textContent = L[1];
    cap.classList.toggle("is-indet", key === "keys" || key === "captcha");
    $(".phase-now").classList.toggle("is-indet", key === "keys" || key === "captcha");
    cap.classList.toggle("is-final", key === "final");
    cap.classList.toggle("is-paused", key === "paused");
    $(".stats").classList.toggle("is-paused", key === "paused");
    $("[data-capstate]").textContent = { keys: "Clés", captcha: "Vérification", upload: "Chiffrement", final: "Finalisation", paused: "En pause", sealed: "Scellé" }[key];
    const idx = { keys: 0, captcha: 1, upload: 2, paused: 2, final: 3, sealed: 4 }[key];
    $$(".ph").forEach((li, i) => { li.classList.toggle("done", i < idx); li.classList.toggle("now", i === idx); });
    const stats = $(".stats"); stats.hidden = idx < 2; $("[data-block]").hidden = idx < 2;
    $("[data-speed]").parentElement && ($("[data-speed]").hidden = key === "paused");
  }
  let sim = null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function runSeal() {
    const id = {}; sim = id; paused = false;
    cap.classList.remove("is-sealed"); resetSealAnims(); setProgress(0); setPhase("keys");
    await wait(1000); if (sim !== id) return; setPhase("captcha");
    await wait(1300); if (sim !== id) return; setPhase("upload");
    let p = 0, last = performance.now();
    await new Promise((res) => {
      const tick = (t) => {
        if (sim !== id) return res();
        const dt = t - last; last = t;
        if (!paused) {
          const speed = 0.16 + 0.05 * Math.sin(t / 420);
          p = Math.min(1, p + (dt / 1000) * speed);
          setProgress(p);
          $("[data-speed]").textContent = `${fr(8.4 + 1.2 * Math.sin(t / 700))} Mo/s`;
        }
        if (p >= 1) return res();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (sim !== id) return; setPhase("final");
    await wait(700); if (sim !== id) return;
    await sealClose().finished; if (sim !== id) return;
    live("Partage créé.");
    document.title = "Shhdrop";
    go("ready");
  }
  let paused = false;
  $("[data-pause]").addEventListener("click", (e) => {
    paused = !paused; const b = e.currentTarget;
    setPhase(paused ? "paused" : "upload");
    b.classList.toggle("btn-primary", paused); b.classList.toggle("btn-secondary", !paused); b.classList.toggle("is-resume", paused);
    $("span", b).textContent = paused ? "Reprendre" : "Pause";
  });

  // Fermeture du sceau : une seule chorégraphie WAAPI, pilotable image par image (seek).
  let sealAnims = [];
  function resetSealAnims() { sealAnims.forEach((a) => a.cancel()); sealAnims = []; }
  function sealClose({ paused: hold = false } = {}) {
    resetSealAnims();
    const A = (el, kf, o) => { const a = el.animate(kf, { fill: "both", ...o }); sealAnims.push(a); return a; };
    const rm = reduced();
    cap.classList.add("is-final"); setPhase("sealed"); cap.classList.add("is-final");
    if (!rm) {
      A($(".cl-flash", cap), [
        { strokeDasharray: "0 100", strokeDashoffset: 0, opacity: 1 },
        { strokeDasharray: "18 100", strokeDashoffset: -30, opacity: 1, offset: 0.4 },
        { strokeDasharray: "0 100", strokeDashoffset: -100, opacity: 0.6 },
      ], { duration: 640, easing: EASE_IN_OUT });
      A(prog, [{ strokeWidth: 2 }, { strokeWidth: 3 }], { duration: 640, easing: EASE_OUT });
      A($(".lk-open", cap), [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-2px)" }], { duration: 160, delay: 140, easing: EASE_IN });
      A($(".lk-closed", cap), [{ opacity: 0, transform: "translateY(-3px)" }, { opacity: 1, transform: "none" }], { duration: 220, delay: 180, easing: EASE_OUT });
      A(cap, [{ transform: "scale(1)" }, { transform: "scale(0.985)", offset: 0.45 }, { transform: "scale(1)" }], { duration: 300, delay: 600, easing: EASE_IN_OUT });
      A($(".cap-fig", cap), [{ opacity: 1 }, { opacity: 0, transform: "translateY(-6px)" }], { duration: 200, delay: 420, easing: EASE_IN });
      A($(".cap-sealed", cap), [{ opacity: 0, transform: "translateY(10px)", filter: "blur(4px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }], { duration: 460, delay: 560, easing: EASE_OUT });
      A($(".cap-state", cap), [{ opacity: 1 }, { opacity: 0 }], { duration: 180, delay: 380 });
      A($(".cap-names", cap), [{ opacity: 1 }, { opacity: 0.5 }], { duration: 400, delay: 400, easing: EASE_OUT });
      A($(".cl-notch", cap), [{ stroke: "#68728A" }, { stroke: "#5FE3B5" }], { duration: 200, delay: 600 });
      A($(".aur-bloom"), [{ opacity: 0, transform: "scale(0.7)" }, { opacity: 0.55, transform: "scale(1)", offset: 0.35 }, { opacity: 0, transform: "scale(1.15)" }], { duration: 1600, delay: 560, easing: EASE_OUT, fill: "none" });
      A(cap, [{ opacity: 1 }, { opacity: 1 }], { duration: 1300 }); // durée totale du moment
    } else {
      A($(".lk-open", cap), [{ opacity: 1 }, { opacity: 0 }], { duration: 1 });
      A($(".lk-closed", cap), [{ opacity: 0 }, { opacity: 1 }], { duration: 1 });
      A($(".cap-fig", cap), [{ opacity: 1 }, { opacity: 0 }], { duration: 1 });
      A($(".cap-sealed", cap), [{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      A(cap, [{ opacity: 1 }, { opacity: 1 }], { duration: 400 });
    }
    if (hold) sealAnims.forEach((a) => { a.pause(); a.currentTime = 0; });
    const last = sealAnims[sealAnims.length - 1];
    return last;
  }

  /* ---------- Lien prêt ---------- */
  $$(".btn-copy").forEach((b) => b.addEventListener("click", () => {
    const f = b.closest(".copyfield"); f.classList.remove("is-copied"); void f.offsetWidth;
    f.classList.add("is-copied"); b.classList.add("is-copied");
    live("Copié"); setTimeout(() => { f.classList.remove("is-copied"); b.classList.remove("is-copied"); }, 2000);
  }));
  const sheetEls = $$("[data-sheet]");
  function sheet(open) {
    sheetEls.forEach((el) => { el.hidden = !open; el.classList.toggle("is-open", open); });
    if (open) $("[data-qr-close]").focus();
  }
  $$("[data-qr]").forEach((b) => b.addEventListener("click", () => sheet(true)));
  $("[data-qr-close]").addEventListener("click", () => sheet(false));
  $(".sheet-scrim").addEventListener("click", () => sheet(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") sheet(false); });

  /* ---------- Destinataire ---------- */
  const rcap = $("#capsule-r");
  (function cipherField() {
    const r = rng(42); const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const rows = Array.from({ length: 40 }, () => Array.from({ length: 72 }, () => B[(r() * 64) | 0]).join(""));
    $("[data-cipherfield]").textContent = rows.concat(rows).join("\n");
  })();
  $(".lockicon", rcap).classList.add("is-locked");
  $("[data-eye]").addEventListener("click", (e) => {
    const i = $("#pw"); const show = i.type === "password"; i.type = show ? "text" : "password";
    e.currentTarget.setAttribute("aria-label", show ? "Masquer le mot de passe" : "Afficher le mot de passe");
  });
  $("[data-unlock]").addEventListener("click", async (e) => {
    const b = e.currentTarget; if (b.disabled) return; b.disabled = true; b.classList.add("is-busy");
    $("[data-unlock-l]").textContent = "Déchiffrement de la clé…";
    await wait(1000);
    const rp = $(".cl-full", rcap);
    if (!reduced()) {
      $(".lockicon", rcap).classList.remove("is-locked");
      await rp.animate([{ strokeDasharray: "100 0", strokeDashoffset: 0 }, { strokeDasharray: "0 100", strokeDashoffset: -50 }], { duration: 520, easing: EASE_IN, fill: "forwards" }).finished;
    }
    live("Partage déverrouillé.");
    await go("content");
    b.disabled = false; b.classList.remove("is-busy"); $("[data-unlock-l]").textContent = "Déverrouiller";
    rp.getAnimations().forEach((a) => a.cancel()); $(".lockicon", rcap).classList.add("is-locked");
  });

  /* ---------- Destruction : dissolution + poussière ---------- */
  const dz = $("#dz"), diss = $("#dissolvable"), dust = $("#dust"), gone = $("#gone");
  $("[data-destroy]").addEventListener("click", () => { const c = $("[data-confirm]"); c.hidden = false; $("[data-destroy-go]").focus(); });
  $("[data-confirm-no]").addEventListener("click", () => { $("[data-confirm]").hidden = true; $("[data-destroy]").focus(); });
  $("[data-destroy-go]").addEventListener("click", async () => {
    $("[data-confirm]").hidden = true;
    await wait(250); // ici : réponse du serveur. La dissolution ne commence jamais avant.
    const a = dissolve(); await a.finished; finishGone();
  });
  let dAnims = [], particles = [];
  const DUR = 1100;
  function seedParticles() {
    const r = rng(1234); particles = [];
    for (let k = 0; k < 1400; k++) {
      particles.push({ x: r(), ts: r() * DUR, life: 380 + r() * 520, vy: 14 + r() * 46, vx: (r() - 0.5) * 22, s: 0.8 + r() * 1.7, a: 0.35 + r() * 0.6, mint: r() < 0.22, ph: r() * 6.28 });
    }
  }
  function drawDust(t) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = dust.clientWidth, H = dust.clientHeight;
    if (dust.width !== Math.round(W * dpr)) { dust.width = Math.round(W * dpr); dust.height = Math.round(H * dpr); }
    const c = dust.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const eh = diss.offsetHeight, ew = diss.offsetWidth, ox = 24, oy = 80;
    const A = parseFloat(diss.style.getPropertyValue("--a")) || 0, S = parseFloat(diss.style.getPropertyValue("--span")) || eh;
    for (const p of particles) {
      const dt = t - p.ts; if (dt < 0 || dt > p.life) continue;
      const d = easeInOut(p.ts / DUR); const lo = A + (d * 1.5 - 0.3) * S;
      if (lo < A || lo > A + S * 1.02) continue;
      const k = dt / p.life;
      const x = ox + p.x * ew + p.vx * dt / 1000 + Math.sin(p.ph + dt * 0.006) * 3;
      const y = oy + eh - lo - p.vy * dt / 1000 - 10 * k * k;
      c.globalAlpha = p.a * Math.pow(1 - k, 1.6);
      c.fillStyle = p.mint ? "#5FE3B5" : "#E9ECF2";
      c.fillRect(x, y, p.s, p.s);
    }
    c.globalAlpha = 1;
  }
  function dissolve({ hold = false } = {}) {
    dAnims.forEach((a) => a.cancel()); dAnims = [];
    seedParticles();
    document.body.classList.add("is-gone");
    if (reduced()) {
      const a = diss.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: "forwards" });
      dAnims.push(a); return a;
    }
    // Le front balaie la partie visible seulement : sur téléphone, la liste dépasse l'écran.
    const r = diss.getBoundingClientRect(); const topBar = 112;
    const visBottom = Math.min(r.bottom, innerHeight), visTop = Math.max(r.top, topBar);
    diss.style.setProperty("--a", `${Math.max(0, r.bottom - visBottom)}px`);
    diss.style.setProperty("--span", `${Math.max(120, visBottom - visTop)}px`);
    diss.classList.add("is-dissolving");
    const a = diss.animate([{ "--d": 0 }, { "--d": 1 }], { duration: DUR, easing: EASE_IN_OUT, fill: "forwards" });
    const b = diss.animate([{ transform: "none", filter: "blur(0)" }, { transform: "translateY(-2px)", filter: "blur(0)", offset: 0.66 }, { transform: "translateY(-4px)", filter: "blur(1px)" }], { duration: DUR, easing: EASE_IN_OUT, fill: "forwards" });
    dAnims.push(a, b);
    if (hold) { dAnims.forEach((x) => { x.pause(); x.currentTime = 0; }); drawDust(0); return a; }
    const loop = () => { const t = a.currentTime ?? DUR; drawDust(t + 0); if (a.playState === "running") requestAnimationFrame(loop); else drawDust(DUR + 900); };
    requestAnimationFrame(loop);
    // la poussière finit de retomber après le masque
    a.finished.then(() => { const t0 = performance.now(); const tail = (t) => { const e = t - t0; drawDust(DUR + e); if (e < 700) requestAnimationFrame(tail); }; requestAnimationFrame(tail); });
    return a;
  }
  function finishGone() {
    dz.hidden = true; gone.hidden = false; gone.classList.add("is-in"); fitAll();
    $("h1", gone).focus({ preventScroll: true }); live("Ce partage a été détruit.");
  }

  /* ---------- En-tête au défilement ---------- */
  const top = $("#top");
  addEventListener("scroll", () => top.classList.toggle("scrolled", scrollY > 8), { passive: true });

  /* ---------- Liens « data-go » ---------- */
  $$("[data-go]").forEach((b) => b.addEventListener("click", (e) => {
    e.preventDefault(); const to = b.dataset.go;
    if (to === "seal") { sim = null; go("seal").then(runSeal); return; }
    if (to === "content") { resetContent(); }
    sim = null; go(to);
  }));
  function resetContent() {
    dz.hidden = false; gone.hidden = true; gone.classList.remove("is-in"); diss.classList.remove("is-dissolving");
    dAnims.forEach((a) => a.cancel()); dAnims = []; document.body.classList.remove("is-gone");
    const c = dust.getContext("2d"); c.clearRect(0, 0, dust.width, dust.height);
  }

  /* ---------- État initial (captures : ?s=…) ---------- */
  const s = params.get("s") || "home";
  const p = parseFloat(params.get("p") || "0.42");
  const st = params.get("state");
  if (s === "seal") {
    show("seal"); setPhase(st || "upload"); setProgress(st === "keys" || st === "captcha" ? 0 : p);
    if (st === "paused") { paused = true; const b = $("[data-pause]"); b.classList.replace("btn-secondary", "btn-primary"); b.classList.add("is-resume"); $("span", b).textContent = "Reprendre"; }
    $("[data-speed]").textContent = "8,4 Mo/s";
  } else if (s === "ready-qr") { show("ready"); sheet(true); }
  else if (s === "confirm") { show("content"); $("[data-confirm]").hidden = false; }
  else if (s === "gone") { show("content"); document.body.classList.add("is-gone"); finishGone(); }
  else if (s === "drop") { show("home"); vessel.classList.add("is-drop"); }
  else { show(s); }
  paintAll();

  window.proto = {
    go, show, setProgress, setPhase, runSeal,
    sealClose: () => sealClose({ paused: true }),
    seekSeal: (t) => sealAnims.forEach((a) => (a.currentTime = t)),
    dissolve: () => dissolve({ hold: true }),
    seekDissolve: (t) => { dAnims.forEach((a) => (a.currentTime = Math.min(t, DUR))); drawDust(t); },
    finishGone,
  };
})();
