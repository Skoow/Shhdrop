<script lang="ts">
  // Poignée de réordonnancement (UI §9.2.4) : Pointer Events + setPointerCapture (pas l'API HTML
  // Drag and Drop, qui ne marche pas au doigt). Souris : le glisser part après 4 px ; doigt et
  // stylet : après 150 ms d'appui. Un appui sans glisser (clic, Entrée, Espace) ouvre le mode
  // déplacement (lecteurs d'écran au toucher). Alt + ↑/↓ est géré par la ligne.
  import { t } from "../i18n/i18n.svelte";
  import { GripVertical } from "./Icon";

  type Props = {
    name: string;
    describedby: string;
    onactivate: () => void;
    onstart: (y: number) => void;
    onmove: (y: number) => void;
    onend: (commit: boolean) => void;
  };
  let { name, describedby, onactivate, onstart, onmove, onend }: Props = $props();

  let el: HTMLButtonElement | undefined = $state();
  let pid: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  let dragged = false;
  let sx = 0;
  let sy = 0;
  let lastY = 0;

  function down(e: PointerEvent) {
    if (e.button !== 0 || pid !== null) return;
    pid = e.pointerId;
    sx = e.clientX;
    sy = lastY = e.clientY;
    started = false;
    dragged = false;
    el?.setPointerCapture?.(pid);
    if (e.pointerType !== "mouse")
      timer = setTimeout(() => {
        started = dragged = true;
        onstart(sy);
        onmove(lastY);
      }, 150);
  }
  function move(e: PointerEvent) {
    if (e.pointerId !== pid) return;
    lastY = e.clientY;
    if (!started) {
      const d = Math.hypot(e.clientX - sx, e.clientY - sy);
      if (e.pointerType === "mouse" && d > 4) {
        started = dragged = true;
        onstart(sy);
      } else return;
    }
    e.preventDefault();
    onmove(e.clientY);
  }
  function stop(e: PointerEvent, commit: boolean) {
    if (e.pointerId !== pid) return;
    clearTimeout(timer);
    pid = null;
    if (started) onend(commit);
    started = false;
  }
  function click() {
    // Le clic qui suit un glisser ne compte pas.
    if (dragged) {
      dragged = false;
      return;
    }
    onactivate();
  }
  $effect(() => () => clearTimeout(timer));
</script>

<button
  bind:this={el}
  type="button"
  class="grip"
  aria-label={t("compose.move", { name })}
  aria-describedby={describedby}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={(e) => stop(e, true)}
  onpointercancel={(e) => stop(e, false)}
  onlostpointercapture={(e) => stop(e, true)}
  onclick={click}
  oncontextmenu={(e) => e.preventDefault()}
>
  <GripVertical size={18} strokeWidth={1.75} aria-hidden="true" />
</button>

<style>
  .grip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    flex: none;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-3);
    cursor: grab;
    /* Seule la poignée capte le doigt : le reste de la ligne fait défiler la page. */
    touch-action: none;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  .grip:active {
    cursor: grabbing;
  }
  @media (hover: hover) {
    .grip:hover {
      color: var(--text);
      background: rgb(255 255 255 / 0.05);
    }
  }
  @media (forced-colors: active) {
    .grip {
      color: ButtonText;
    }
  }
</style>
