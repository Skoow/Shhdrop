<script lang="ts">
  // PDF reçu (UI §13, Task 22, retours CLEAN5) : affiché dans un cadre isolé, jamais par la page
  // de l'application. <iframe sandbox="allow-scripts"> sans allow-same-origin (origine opaque :
  // le cadre ne voit ni les clés, ni le stockage, ni la page) ; pdf.js y dessine des <canvas>
  // sans exécuter le code du PDF. Les octets sont TRANSFÉRÉS au cadre (plus de copie ici) après
  // son « ready », vérifié par event.source. Échec, PDF chiffré ou 20 s sans réponse : onerror.
  import { href } from "../app/router.svelte";
  import { t } from "../i18n/i18n.svelte";

  type Props = { blob: Blob; label: string; onerror: () => void };
  let { blob, label, onerror }: Props = $props();

  let frame: HTMLIFrameElement | undefined = $state();
  let ok = $state(false);

  $effect(() => {
    const f = frame;
    if (!f) return;
    let sent = false;
    let done = false;
    const fail = () => {
      if (done) return;
      done = true;
      onerror();
    };
    const timer = setTimeout(fail, 20_000);
    async function onMsg(e: MessageEvent) {
      if (e.source !== f!.contentWindow || typeof e.data !== "object" || e.data === null) return;
      const type = (e.data as { type?: unknown }).type;
      if (type === "ready" && !sent) {
        sent = true;
        const bytes = await blob.arrayBuffer();
        const labels = { zoomIn: t("viewer.pdf.zoomIn"), zoomOut: t("viewer.pdf.zoomOut"), fit: t("viewer.pdf.fit"), page: t("viewer.pdf.page") };
        f!.contentWindow?.postMessage({ type: "pdf", bytes, labels }, "*", [bytes]);
      } else if (type === "rendered") {
        done = true;
        ok = true;
        clearTimeout(timer);
      } else if (type === "error") {
        clearTimeout(timer);
        fail();
      }
    }
    addEventListener("message", onMsg);
    return () => {
      clearTimeout(timer);
      removeEventListener("message", onMsg);
    };
  });
</script>

<iframe
  bind:this={frame}
  src={href("/pdf-frame.html")}
  sandbox="allow-scripts"
  referrerpolicy="no-referrer"
  title={label}
  class={[ok && "ok"]}
  data-pdf-frame
></iframe>

<style>
  iframe {
    display: block;
    width: 100%;
    height: min(78dvh, 100%);
    min-height: 60dvh;
    border: 0;
    border-radius: var(--r-lg);
    background: var(--bg-deep);
  }
</style>
