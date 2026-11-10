// Cadre PDF isolé (UI §13, Task 22, retours CLEAN5). Chargé par /pdf-frame.html dans un
// <iframe sandbox="allow-scripts"> SANS allow-same-origin : origine opaque, aucun accès aux
// clés, au stockage ni aux cookies de l'application. pdf.js tourne ici, sur le fil principal
// (pas de Worker : `globalThis.pdfjsWorker`), sans WebAssembly, sans XFA, sans scripts du PDF,
// sans calque d'annotations ni de texte : seulement des <canvas>, page par page, à la demande.
// Messages : → parent { type: "ready" } ; ← parent { type: "pdf", bytes, labels } (une fois) ;
// → parent { type: "rendered", pages } | { type: "error" }. Seule la source window.parent est
// écoutée (origine opaque : la cible « * » est imposée, la vérification porte sur la source).
import * as worker from "pdfjs-dist/build/pdf.worker.mjs";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import "./frame.css";

(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = worker;

type Labels = { zoomIn: string; zoomOut: string; fit: string; page: string };
type Msg = { type: "pdf"; bytes: ArrayBuffer; labels: Labels };

const MAX_PAGES = 500;
let started = false;
let doc: PDFDocumentProxy | null = null;
let zoom = 1; // relatif à « ajusté à la largeur »

const send = (m: { type: "ready" } | { type: "rendered"; pages: number } | { type: "error" }) => window.parent.postMessage(m, "*");

function isMsg(d: unknown): d is Msg {
  if (typeof d !== "object" || d === null) return false;
  const o = d as Record<string, unknown>;
  const l = o.labels as Record<string, unknown> | undefined;
  return o.type === "pdf" && o.bytes instanceof ArrayBuffer && !!l && ["zoomIn", "zoomOut", "fit", "page"].every((k) => typeof l[k] === "string");
}

addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window.parent || started || !isMsg(e.data)) return;
  started = true;
  void open(e.data).catch(() => send({ type: "error" }));
});

function button(label: string, text: string, onclick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.setAttribute("aria-label", label);
  b.title = label;
  b.addEventListener("click", onclick);
  return b;
}

async function open(m: Msg): Promise<void> {
  doc = await getDocument({
    data: new Uint8Array(m.bytes),
    useWasm: false,
    enableXfa: false,
    isOffscreenCanvasSupported: false,
    stopAtErrors: false,
  }).promise;
  const n = Math.min(doc.numPages, MAX_PAGES);
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.append(
    button(m.labels.zoomOut, "−", () => setZoom(zoom / 1.25)),
    button(m.labels.fit, "↔", () => setZoom(1)),
    button(m.labels.zoomIn, "+", () => setZoom(zoom * 1.25)),
  );
  const pages = document.createElement("div");
  pages.className = "pages";
  document.body.append(bar, pages);
  for (let i = 1; i <= n; i++) {
    const c = document.createElement("canvas");
    c.dataset.page = String(i);
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", m.labels.page.replace("{k}", String(i)).replace("{n}", String(n)));
    pages.append(c);
  }
  layout();
  send({ type: "rendered", pages: doc.numPages });
}

let io: IntersectionObserver | null = null;
const drawn = new Map<HTMLCanvasElement, number>();

function setZoom(z: number) {
  zoom = Math.max(0.5, Math.min(4, z));
  layout();
}

/** Dimensions de chaque page à la largeur courante ; rendu des pages visibles seulement. */
function layout() {
  if (!doc) return;
  io?.disconnect();
  drawn.clear();
  io = new IntersectionObserver((es) => es.forEach((x) => x.isIntersecting && void draw(x.target as HTMLCanvasElement)), { rootMargin: "400px" });
  for (const c of document.querySelectorAll<HTMLCanvasElement>("canvas[data-page]")) {
    c.style.width = `${Math.round(widthCss() * zoom)}px`;
    io.observe(c);
  }
}
const widthCss = () => Math.max(200, document.documentElement.clientWidth - 24);

async function draw(c: HTMLCanvasElement) {
  if (!doc || drawn.get(c) === zoom) return;
  drawn.set(c, zoom);
  const page = await doc.getPage(Number(c.dataset.page));
  const base = page.getViewport({ scale: 1 });
  const cssW = widthCss() * zoom;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const vp = page.getViewport({ scale: (cssW / base.width) * dpr });
  c.width = Math.floor(vp.width);
  c.height = Math.floor(vp.height);
  c.style.width = `${Math.round(cssW)}px`;
  c.style.height = `${Math.round(vp.height / dpr)}px`;
  await page.render({ canvas: c, viewport: vp, annotationMode: 0 }).promise;
  page.cleanup();
}

addEventListener("resize", () => layout());
send({ type: "ready" });
