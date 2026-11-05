// Annonces pour lecteurs d'écran : une par seconde au plus (UI §8, LiveRegion), dans l'ordre.
// File bornée : une annonce de progression trop vieille n'a plus d'intérêt, on abandonne les plus anciennes.
const MIN_GAP_MS = 1000;
const MAX_QUEUE = 3;

type Listener = (text: string) => void;
const listeners = new Set<Listener>();
let queue: string[] = [];
let lastAt = -Infinity;
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  timer = undefined;
  const text = queue.shift();
  if (text === undefined) return;
  lastAt = Date.now();
  for (const l of listeners) l(text);
  if (queue.length > 0) timer = setTimeout(flush, MIN_GAP_MS);
}

export function announce(text: string): void {
  if (!text) return;
  queue.push(text);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (timer !== undefined) return;
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  timer = setTimeout(flush, wait);
}

export function onAnnounce(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Pour les tests. */
export function resetAnnounce(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  queue = [];
  lastAt = -Infinity;
}
