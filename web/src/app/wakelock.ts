// Verrou d'écran pendant l'envoi (UI §9.4.3) : demandé de la phase `keys` jusqu'à la fin,
// relâché en pause, à la fin et à l'annulation, redemandé au retour en `visible` (le
// navigateur le relâche de lui-même quand la page est masquée). Sans l'API : rien.

type Sentinel = { release(): Promise<void>; released?: boolean };
type Nav = { wakeLock?: { request(type: "screen"): Promise<Sentinel> } };

export type WakeLock = { acquire(): void; release(): void; dispose(): void };

export function createWakeLock(nav: Nav = navigator as Nav, doc: Document = document): WakeLock {
  let wanted = false;
  let held: Sentinel | undefined;

  async function request() {
    if (!wanted || held || doc.visibilityState !== "visible" || !nav.wakeLock) return;
    try {
      const s = await nav.wakeLock.request("screen");
      if (wanted && !held) held = s;
      else await s.release();
    } catch {
      /* refusé (économie d'énergie, page masquée) : sans verrou */
    }
  }
  function onVisible() {
    if (doc.visibilityState !== "visible") {
      held = undefined; // relâché par le navigateur
      return;
    }
    void request();
  }
  doc.addEventListener("visibilitychange", onVisible);

  return {
    acquire() {
      wanted = true;
      void request();
    },
    release() {
      wanted = false;
      const s = held;
      held = undefined;
      void s?.release().catch(() => undefined);
    },
    dispose() {
      this.release();
      doc.removeEventListener("visibilitychange", onVisible);
    },
  };
}
