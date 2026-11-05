// Durée d'un audio ou d'une vidéo de l'expéditeur (sa propre donnée), lue sur les seules
// métadonnées (preload="metadata") : aucun décodage complet, URL blob révoquée aussitôt.
export function mediaDuration(blob: Blob, kind: "audio" | "video", timeoutMs = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.muted = true;
    const url = URL.createObjectURL(blob);
    let done = false;
    const finish = (v: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => finish(null);
    el.src = url;
  });
}

/** « 1:12 », « 1:02:05 » (chiffres tabulaires à l'affichage). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}
