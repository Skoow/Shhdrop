<script module lang="ts">
  // UI §20.4 : le titre entre mot par mot une seule fois par chargement de page.
  let revealed = false;
</script>

<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import { followLink, href } from "../app/router.svelte";
  import { t } from "../i18n/i18n.svelte";
  import { Camera, Paperclip } from "../ui/Icon";
  import Schema from "../ui/Schema.svelte";
  import Vessel from "../ui/Vessel.svelte";

  type Props = {
    /** Vrai dès qu'un élément est ajouté : le titre se replie (UI §9.1), le reste du Persuade part. */
    compact?: boolean;
    /** Le composeur (Task 10), posé dans le réceptacle. Sans lui, le réceptacle vide. */
    children?: Snippet;
    /** Fichiers choisis dans le réceptacle vide (branché sur le composeur en Task 10). */
    onfiles?: (files: File[], source: "fichiers" | "photo") => void;
  };
  let { compact = false, children, onfiles }: Props = $props();

  // Décidé au montage seulement : un repli ultérieur ne rejoue pas l'entrée.
  const reveal = !revealed && !untrack(() => compact);
  revealed = true;

  /**
   * K1 : 560 ms par mot, 35 ms de décalage, respiration de 30 ms après la dernière virgule
   * (« puis », « then ») : le dernier mot part à 310 ms et finit à 870 ms en français.
   */
  const words = $derived.by(() => {
    const list = t("hero.title").split(/ +/);
    let breath = -1;
    list.forEach((w, i) => {
      if (w.endsWith(",") && i < list.length - 1) breath = i;
    });
    return list.map((w, i) => ({ w, delay: i * 35 + (breath >= 0 && i > breath ? 30 : 0) }));
  });

  let files: HTMLInputElement | undefined = $state();
  let photo: HTMLInputElement | undefined = $state();
  function picked(input: HTMLInputElement, source: "fichiers" | "photo") {
    const list = [...(input.files ?? [])];
    input.value = "";
    if (list.length > 0) onfiles?.(list, source);
  }
  // Un clic sur le verre du réceptacle ouvre le sélecteur (le clavier passe par les boutons).
  function vesselClick(e: MouseEvent) {
    if (children || (e.target as Element).closest("button, a, input")) return;
    files?.click();
  }
</script>

<div class={["home", { compact, reveal }]}>
  <h1 tabindex="-1" class:compact>
    <!-- K8 : phrase entière pour les lecteurs d'écran, copie animée cachée. -->
    <span class="sr-only">{t("hero.title")}</span>
    <span class="words" aria-hidden="true">
      {#each words as { w, delay }, i (i)}<span class="w" style:--d="{delay}ms">{w}</span>{" "}{/each}
    </span>
  </h1>

  {#if !compact}
    <div class="say">
      <p class="lede">{t("hero.lede")}</p>
      <a class="how" href={href("/securite")} onclick={(e) => followLink(e, "/securite")}>
        {t("hero.how")}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
      </a>
    </div>
  {/if}

  <div class="compose" data-slot="compose">
    <Vessel empty={!children} onclick={vesselClick}>
      {#if children}
        {@render children()}
      {:else}
        <div class="empty">
          <div class="drop-mark" aria-hidden="true">
            <span class="sheet s1"></span><span class="sheet s2"></span>
            <span class="sheet s3"><Paperclip size={22} strokeWidth={1.75} /></span>
          </div>
          <h2 class="drop-title">{t("compose.drop.title")}</h2>
          <p class="drop-sub">{t("compose.drop.or")}</p>
          <div class="add-row" role="group" aria-label={t("compose.add.label")}>
            <button type="button" class="add" onclick={() => files?.click()}>
              <Paperclip size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>{t("compose.add.files")}</span>
            </button>
            <button type="button" class="add" onclick={() => photo?.click()}>
              <Camera size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>{t("compose.add.photo")}</span>
            </button>
          </div>
          <p class="gauge-empty">{t("compose.gauge.empty")}</p>
          <input bind:this={files} type="file" multiple hidden tabindex="-1" onchange={(e) => picked(e.currentTarget, "fichiers")} />
          <input bind:this={photo} type="file" accept="image/*" capture="environment" hidden tabindex="-1" onchange={(e) => picked(e.currentTarget, "photo")} />
        </div>
      {/if}
    </Vessel>
  </div>

  {#if !compact}
    <div class="demo">
      <Schema />
    </div>
  {/if}
</div>

<style>
  /* Téléphone et tablette : titre, phrase, réceptacle, puis schéma (S4). */
  .home {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "title" "say" "compose" "demo";
    gap: var(--sp-4);
    padding-block-start: var(--sp-2);
  }
  .home.compact {
    grid-template-areas: "title" "compose";
  }

  h1 {
    grid-area: title;
    font-size: var(--fs-display);
    line-height: var(--lh-display);
    font-weight: var(--fw-display);
    font-stretch: var(--wd-display);
    letter-spacing: var(--ls-display);
    max-width: 13ch;
    /* Texte agrandi sur téléphone : un mot plus large que l'écran se coupe au lieu de déborder. */
    overflow-wrap: break-word;
    min-width: 0;
    view-transition-name: hero-title;
  }
  h1.compact {
    font-size: var(--fs-h1);
    line-height: var(--lh-h1);
    font-weight: var(--fw-h1);
    font-stretch: var(--wd-h1);
    letter-spacing: -0.015em;
    max-width: none;
  }
  h1:focus {
    outline: none;
  }
  .w {
    display: inline-block;
  }

  .say {
    grid-area: say;
    min-width: 0;
    display: grid;
    gap: var(--sp-3);
    justify-items: start;
  }
  .lede {
    margin: 0;
    overflow-wrap: break-word;
    max-width: 44ch;
    color: var(--text-2);
    font-size: 1rem;
    line-height: 1.55;
  }
  .how {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 44px;
    color: var(--text);
    font-weight: 520;
    text-decoration: none;
  }
  .how svg {
    flex: none;
    color: var(--accent);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .how:hover {
      text-decoration-line: underline;
      text-decoration-thickness: 1px;
      text-decoration-color: var(--accent);
      text-underline-offset: 0.3em;
    }
    .how:hover svg {
      transform: translateX(4px);
    }
  }

  .compose {
    grid-area: compose;
    min-width: 0;
    margin-block-start: var(--sp-2);
  }
  .demo {
    grid-area: demo;
    min-width: 0;
    margin-block-start: var(--sp-5);
  }

  /* Réceptacle vide (contenu provisoire jusqu'au composeur, Task 10). */
  .empty {
    display: grid;
    justify-items: center;
    text-align: center;
    gap: var(--sp-2);
    padding: 24px 12px 20px;
  }
  .drop-mark {
    display: none;
    position: relative;
    width: 76px;
    height: 64px;
    margin-bottom: var(--sp-3);
  }
  .sheet {
    position: absolute;
    left: 16px;
    top: 4px;
    width: 44px;
    height: 56px;
    border-radius: 9px;
    background: var(--surface-1);
    box-shadow: 0 0 0 1px var(--hair-2), var(--e-2);
    transition: transform var(--dur-slow) var(--ease-out);
  }
  .s1 {
    transform: rotate(-12deg) translateX(-10px);
  }
  .s2 {
    transform: rotate(9deg) translateX(10px);
  }
  .s3 {
    display: grid;
    place-items: center;
    color: var(--accent);
    background: var(--surface-3);
  }
  @media (hover: hover) {
    .compose:hover .s1 {
      transform: rotate(-18deg) translate(-16px, 2px);
    }
    .compose:hover .s2 {
      transform: rotate(15deg) translate(16px, 2px);
    }
    .compose:hover .s3 {
      transform: translateY(-4px);
    }
  }
  .drop-title {
    font-size: 1.0625rem;
    line-height: 1.3;
    font-weight: 600;
    font-stretch: 104%;
    letter-spacing: -0.01em;
    max-width: 22ch;
  }
  /* --text-3 jamais sur l'aurore (K5) : le verre laisse passer la lumière, d'où --text-2. */
  .drop-sub {
    margin: 0 0 var(--sp-3);
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .add-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-2);
    width: 100%;
    max-width: 360px;
  }
  .add {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 72px;
    padding: 10px 6px;
    border: 1px solid var(--hair);
    border-radius: var(--r-lg);
    background: rgb(255 255 255 / 0.03);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-small);
    font-weight: 520;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      transform var(--dur-press) var(--ease-out);
  }
  .add :global(svg) {
    color: var(--text-2);
    transition:
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .add:hover {
      background: rgb(255 255 255 / 0.06);
      border-color: var(--hair-2);
    }
    .add:hover :global(svg) {
      color: var(--accent);
      transform: translateY(-2px);
    }
  }
  .add:active {
    transform: scale(0.96);
  }
  .gauge-empty {
    margin: var(--sp-4) 0 0;
    color: var(--text-2);
    font-size: 0.8125rem;
  }

  /* Entrée (K1) : tout est cliquable dès l'affichage ; fin à 870 ms au plus. */
  @media (prefers-reduced-motion: no-preference) {
    .reveal .w {
      animation: word-in var(--dur-reveal) var(--ease-out) var(--d) both;
    }
    .reveal .compose {
      animation: rise-in var(--dur-moment) var(--ease-out) both;
    }
    .reveal .say,
    .reveal .demo {
      animation: rise-in 600ms var(--ease-out) 200ms both;
    }
  }
  @keyframes word-in {
    from {
      opacity: 0;
      transform: translateY(0.32em);
      filter: blur(var(--blur-in));
    }
  }
  @keyframes rise-in {
    from {
      opacity: 0;
      transform: translateY(var(--rise));
    }
  }

  @media (min-width: 600px) {
    .empty {
      padding: 28px 24px 24px;
    }
  }

  /* Ordinateur : texte à gauche, réceptacle à droite sur toute la hauteur. */
  @media (min-width: 1024px) {
    .home {
      grid-template-columns: minmax(0, 1.42fr) minmax(400px, 1fr);
      grid-template-rows: auto auto 1fr;
      grid-template-areas: "title compose" "say compose" "demo compose";
      column-gap: 72px;
      row-gap: 28px;
      padding-block-start: var(--sp-7);
    }
    .home.compact {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto;
      grid-template-areas: "title" "compose";
      padding-block-start: var(--sp-5);
    }
    .compose {
      margin: 0;
    }
    .home:not(.compact) .compose :global(.vessel) {
      height: 100%;
      display: grid;
      align-content: center;
    }
    .demo {
      margin-block-start: var(--sp-5);
    }
    .lede {
      font-size: 1.0625rem;
    }
    .empty {
      padding: 40px 32px 32px;
    }
    .drop-mark {
      display: block;
    }
    .drop-title {
      font-size: 1.1875rem;
    }
    .add {
      min-height: 84px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet,
    .add,
    .add :global(svg),
    .how svg {
      transition: none;
    }
    .add:active {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    /* Le navigateur pose un fond plein derrière chaque ligne : avec un interligne < 1, celui de la
       ligne suivante masquait les jambages (« passe », « lien, »). */
    h1 {
      line-height: 1.15;
    }
    .how {
      text-decoration-line: underline;
    }
    .add {
      border-color: ButtonText;
    }
    .sheet {
      box-shadow: none;
      border: 1px solid CanvasText;
    }
  }
</style>
