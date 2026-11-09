<script module lang="ts">
  // UI §20.4 : le titre entre mot par mot une seule fois par chargement de page.
  let revealed = false;

  /** D'où viennent les fichiers remis à `onfiles` (composer.add, Task 10). */
  export type Source = "fichiers" | "photo" | "video" | "depot";
  /** Actions qui ouvrent une interface dans la page (Tasks 10 à 12). */
  export type Action = "media" | "vocal" | "texte";
</script>

<script lang="ts">
  // Accueil v3 (UI §9.1) : titre, phrase et sceaux de confiance ; fenêtre de dépôt (le coffre)
  // avec le volet de scellement, le bouton principal « Commencer » (ouvre la feuille d'ajout du
  // composeur, retours HOME5) et les actions de création ; voile de dépôt pleine page (un dépôt
  // ouvre le composeur avec ses fichiers) ; sous le pli, « Comment ça marche », « Pourquoi c'est
  // sûr », questions et appel final (même « Commencer »). Un clic sur le verre n'ouvre rien.
  import { untrack, type Snippet } from "svelte";
  import { dragDepth, dragHasFiles, filesFromDrop } from "../flows/intake";
  import { t, getLang } from "../i18n/i18n.svelte";
  import { limitParams } from "../i18n/limit-params";
  import { magnet, tilt } from "../ui/attach";
  import DropOverlay from "../ui/DropOverlay.svelte";
  import Guilloche from "../ui/Guilloche.svelte";
  import { ArrowRight, Camera, ChevronDown, Lock, Mic, Plus, Timer, Type, UserX } from "../ui/Icon";
  import { reducedMotion } from "../ui/motion";
  import SealBand from "../ui/SealBand.svelte";
  import SectionBg from "../ui/SectionBg.svelte";
  import Vessel from "../ui/Vessel.svelte";
  import Closing from "./home/Closing.svelte";
  import Faq from "./home/Faq.svelte";
  import HowItWorks from "./home/HowItWorks.svelte";
  import WhySafe from "./home/WhySafe.svelte";

  type Props = {
    /** Vrai dès qu'un élément est ajouté : le titre se replie (UI §9.1), le reste du Persuade part. */
    compact?: boolean;
    /** Le composeur (Task 10), posé dans le réceptacle. Sans lui, le réceptacle vide. */
    children?: Snippet;
    /** Fichiers choisis ou déposés (composer.add) ; `folders` : dossiers déposés, refusés. */
    onfiles?: (files: File[], source: Source, folders: string[]) => void;
    /** Vocal, Texte : ouvrent leur interface dans la page (le collage passe par Ctrl/Cmd + V). */
    onaction?: (action: Action) => void;
    /** Faux pendant un envoi : le glisser-déposer n'ouvre pas le voile et n'ajoute rien (S9). */
    active?: boolean;
    /** « Commencer » (et « Ajouter » sur téléphone) : ouvre la feuille d'ajout du composeur (Compose). */
    onadd?: () => void;
  };
  let { compact = false, children, onfiles, onaction, active = true, onadd }: Props = $props();

  // Décidé au montage seulement : un repli ultérieur ne rejoue pas l'entrée.
  let reveal = $state(!revealed && !untrack(() => compact));
  revealed = true;
  // Retirée une fois l'entrée finie (870 ms, K1) : un changement de langue ou un compact qui
  // repasse à faux ne rejoue pas l'entrée sur les nœuds recréés (§20.4 : une seule fois).
  $effect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => (reveal = false), 900);
    return () => clearTimeout(timer);
  });

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

  // UI §9.2.1 : Vocal masqué sans MediaRecorder. Pas de bouton Coller (décision du propriétaire) : Ctrl/Cmd + V suffit.
  const canVoice = typeof MediaRecorder !== "undefined";


  function give(list: File[], source: Source, folders: string[] = []) {
    if (list.length > 0 || folders.length > 0) onfiles?.(list, source, folders);
  }
  function act(a: Action) {
    onaction?.(a);
  }

  // UI §9.2.2 : glisser de fichiers sur toute la page ; compteur contre le clignotement ;
  // fermeture au dépôt, à Échap, à la fin du glisser. Les dossiers sont refusés, pas aplatis.
  const depth = dragDepth();
  let over = $state(false);
  function close() {
    depth.reset();
    over = false;
  }
  function dragenter(e: DragEvent) {
    if (!active || !dragHasFiles(e)) return;
    e.preventDefault();
    over = depth.enter(e);
  }
  function dragover(e: DragEvent) {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }
  function dragleave(e: DragEvent) {
    if (!dragHasFiles(e)) return;
    over = depth.leave(e);
  }
  function drop(e: DragEvent) {
    if (!active || !dragHasFiles(e)) return;
    e.preventDefault();
    close();
    void filesFromDrop(e.dataTransfer!).then(({ files, folders }) => give(files, "depot", folders));
  }

  /** « Comment ça marche » : défilement vers la section, sans « # » dans l'adresse. */
  function scrollToEl(el: Element | null | undefined, block: ScrollLogicalPosition) {
    el?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block });
  }
</script>

<svelte:window
  ondragenter={dragenter}
  ondragover={dragover}
  ondragleave={dragleave}
  ondrop={drop}
  ondragend={close}
  onkeydown={(e) => e.key === "Escape" && over && close()}
/>

{#snippet tile(label: string, Icon: typeof Lock, onclick: () => void, extra: "flash" | "rec" | "bars" | "caret" | "")}
  <button type="button" class="tile" {onclick} {@attach magnet}>
    <span class="ic">
      <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
      {#if extra === "bars"}<span class="bars" aria-hidden="true"><b></b><b></b><b></b></span>
      {:else if extra}<span class={extra} aria-hidden="true"></span>{/if}
    </span>
    <span class="lb">{label}</span>
  </button>
{/snippet}

{#snippet cert(Icon: typeof Lock, title: string)}
  <li class="cert" {@attach magnet}>
    <span class="cm" aria-hidden="true"><Icon size={18} strokeWidth={1.9} /></span>
    <span class="cert-t">{title}</span>
  </li>
{/snippet}

<div class={["home", { compact, reveal }]}>
  <section class="hero" aria-labelledby="hero-title">
    {#if !compact}<SectionBg kind="night" />{/if}
    <div class="pitch">
      <h1 id="hero-title" tabindex="-1" class:compact>
        <!-- K8 : phrase entière pour les lecteurs d'écran, copie animée cachée. -->
        <span class="sr-only">{t("hero.title")}</span>
        <span class="words" aria-hidden="true">
          {#each words as { w, delay }, i (i)}<span class="w" style:--d="{delay}ms">{w}</span>{" "}{/each}
        </span>
      </h1>

      {#if !compact}
        <p class="lede">{t("hero.lede")}</p>
        <ul class="certs" aria-label={t("home.facts.label")}>
          {@render cert(Lock, t("home.fact.e2e"))}
          {@render cert(Timer, t("home.fact.erase"))}
          {@render cert(UserX, t("home.fact.account"))}
        </ul>
      {/if}
    </div>

    <div class="compose" data-slot="compose" {@attach !children && tilt}>
      {#if !children}
        <span class="sheet-back b2" aria-hidden="true"></span>
        <span class="sheet-back b1" aria-hidden="true"></span>
      {/if}
      <Vessel empty={!children} drop={over} >
        {#if children}
          {@render children()}
        {:else}
          <div class="empty">
            <span class="guil-clip" aria-hidden="true"><Guilloche lines={22} /></span>
            <div class="band-wrap">
              <SealBand />
              <p class="band-cap"><Lock size={13} strokeWidth={2.2} aria-hidden="true" />{t("home.band.caption")}</p>
            </div>
            <div class="drop-say">
              <h2 class="drop-title">
                <span class="t-fine">{t("compose.drop.title")}</span><span class="t-touch">{t("compose.drop.titleTouch")}</span>
              </h2>
            </div>
            <button type="button" class="browse" aria-haspopup="dialog" onclick={() => onadd?.()}>
              <span>{t("home.end.cta")}</span>
              <ArrowRight size={20} strokeWidth={1.9} aria-hidden="true" />
            </button>
            <div class="make" role="group" aria-labelledby="make-title">
              <p class="make-t" id="make-title">{t("compose.add.make")}</p>
              <div class="tiles">
                {@render tile(t("compose.add.media"), Camera, () => act("media"), "flash")}
                {#if canVoice}{@render tile(t("compose.add.voice"), Mic, () => act("vocal"), "bars")}{/if}
                {@render tile(t("compose.add.text"), Type, () => act("texte"), "caret")}
              </div>
            </div>
            <p class="proof num">{t("home.proof", limitParams(getLang()))}</p>
            <!-- Téléphone : une seule action, « Ajouter », qui ouvre la feuille (Compose). -->
            <button type="button" class="add-big" aria-haspopup="dialog" onclick={() => onadd?.()}>
              <span class="ab-ic" aria-hidden="true"><Plus size={26} strokeWidth={2.2} /></span>
              <span class="ab-tx"><span class="ab-t">{t("add.open")}</span><span class="ab-s">{t("add.big.sub")}</span></span>
            </button>
          </div>
        {/if}
      </Vessel>
    </div>

    {#if !compact}
      <button type="button" class="next" onclick={() => scrollToEl(document.getElementById("comment"), "start")}>
        {t("hero.how")}<ChevronDown size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    {/if}
  </section>

  {#if !compact}
    <HowItWorks />
    <WhySafe />
    <Faq />
    <Closing onstart={() => onadd?.()} />
  {/if}
</div>

<DropOverlay open={over} />

<style>
  .home {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  /* ---------- Héros ---------- */
  .hero {
    position: relative;
    isolation: isolate;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-4);
    padding-block: var(--sp-2) var(--sp-6);
  }
  .pitch {
    display: contents;
  }
  h1 {
    order: 1;
    font-size: clamp(2.5rem, 1.2rem + 3.9vw, 4.5rem);
    line-height: var(--lh-display);
    font-weight: var(--fw-display);
    font-stretch: var(--wd-display);
    letter-spacing: var(--ls-display);
    max-width: 12ch;
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
  /* Composeur ouvert : l'app prend l'écran ; le titre reste pour les lecteurs d'écran. */
  @media all {
    h1.compact {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .home.compact .hero {
      padding-top: 0;
    }
  }
  .w {
    display: inline-block;
  }
  .lede {
    order: 2;
    margin: 0;
    max-width: 42ch;
    overflow-wrap: break-word;
    color: var(--text-2);
    font-size: 1rem;
    line-height: 1.55;
  }

  /* Arguments (retours HOME5) : pastilles de verre, contour lumineux par masque qui s'éclaire
     sous le pointeur (magnet : --lx, --ly), médaillon d'icône qui se soulève au survol. */
  .certs {
    order: 4;
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .cert {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: inline-flex;
    gap: 10px;
    align-items: center;
    min-width: 0;
    padding: 6px 16px 6px 6px;
    border-radius: 999px;
    background: rgb(20 25 33 / 0.5);
    -webkit-backdrop-filter: blur(12px) saturate(150%);
    backdrop-filter: blur(12px) saturate(150%);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.07),
      0 18px 36px -26px rgb(0 0 0 / 0.95);
    transition:
      translate 520ms var(--ease-settle),
      background-color var(--dur-base) var(--ease-out);
  }
  /* Contour : un filet de verre, plus clair en haut, et un reflet menthe qui suit le pointeur. */
  .cert::after {
    content: "";
    position: absolute;
    inset: 0;
    padding: 1px;
    border-radius: inherit;
    background:
      radial-gradient(120px 120px at var(--lx, 30%) var(--ly, 0%), rgb(95 227 181 / 0.55), transparent 70%),
      linear-gradient(170deg, rgb(233 236 242 / 0.22), rgb(233 236 242 / 0.05) 45%, rgb(95 227 181 / 0.14));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
    opacity: 0.75;
    pointer-events: none;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .cert::before {
    content: "";
    position: absolute;
    z-index: -1;
    left: 0;
    top: 0;
    width: 240px;
    height: 240px;
    margin: -120px 0 0 -120px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(95 227 181 / 0.12), transparent);
    opacity: 0;
    transform: translate(var(--lx, 50%), var(--ly, 50%));
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .cm {
    flex: none;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    color: var(--accent);
    background: radial-gradient(closest-side, rgb(95 227 181 / 0.18), rgb(95 227 181 / 0.05));
    box-shadow:
      inset 0 0 0 1px rgb(95 227 181 / 0.32),
      inset 0 1px 0 rgb(255 255 255 / 0.08),
      0 0 22px -6px var(--seal-halo);
    transition:
      transform 520ms var(--ease-settle),
      box-shadow var(--dur-base) var(--ease-out);
  }
  @media (hover: hover) {
    .cert:hover {
      background-color: rgb(24 30 40 / 0.62);
    }
    .cert:hover::after {
      opacity: 1;
    }
    .cert:hover .cm {
      box-shadow:
        inset 0 0 0 1px rgb(95 227 181 / 0.5),
        inset 0 1px 0 rgb(255 255 255 / 0.1),
        0 0 30px -4px var(--seal-halo);
    }
  }
  @media (hover: hover) and (prefers-reduced-motion: no-preference) {
    .cert:hover {
      translate: 0 -2px;
    }
    .cert:hover::before {
      opacity: 1;
    }
    .cert:hover .cm {
      transform: translateY(-2px) rotate(-6deg) scale(1.06);
    }
  }
  .cert-t {
    min-width: 0;
    font-size: 0.9375rem;
    line-height: 1.3;
    font-weight: 640;
    letter-spacing: -0.005em;
  }

  /* ---------- Le coffre : fenêtre de dépôt ---------- */
  .compose {
    order: 3;
    position: relative;
    isolation: isolate;
    min-width: 0;
    perspective: 1400px;
  }
  .compose :global(.vessel) {
    transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
    transition:
      transform 700ms var(--ease-settle),
      background-color var(--dur-base) var(--ease-out);
  }
  .home:not(.compact) .compose {
    padding-top: 14px;
  }
  /* Feuillets empilés derrière la fenêtre : la profondeur d'un coffre, d'une enveloppe. */
  /* Au défilement, quand le héros sort : les feuillets rentrent dans le coffre, qui recule. */
  @media (prefers-reduced-motion: no-preference) {
    @supports (animation-timeline: view()) {
      .hero {
        view-timeline: --hero;
      }
      .sheet-back {
        animation: lid linear both;
        animation-timeline: --hero;
        animation-range: exit 0% exit 70%;
      }
      .home:not(.reveal):not(.compact) .compose {
        animation: recede linear both;
        animation-timeline: --hero;
        animation-range: exit 0% exit 100%;
      }
    }
  }
  @keyframes lid {
    to {
      translate: 0 34px;
    }
  }
  @keyframes recede {
    to {
      scale: 0.94;
      translate: 0 40px;
      opacity: 0.7;
    }
  }
  .sheet-back {
    position: absolute;
    z-index: -1;
    left: 50%;
    height: 56px;
    border-radius: 22px 22px 0 0;
    box-shadow:
      inset 0 0 0 1px var(--hair),
      var(--edge-hi);
  }
  .b1 {
    top: 7px;
    width: 92%;
    margin-left: -46%;
    background: #141821;
  }
  .b2 {
    top: 0;
    width: 84%;
    margin-left: -42%;
    background: #0f1218;
  }

  .empty {
    position: relative;
    display: grid;
    gap: var(--sp-4);
    padding: var(--sp-4) var(--sp-4) var(--sp-5);
  }
  .guil-clip {
    position: absolute;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    border-radius: var(--r-2xl);
    -webkit-mask-image: radial-gradient(120% 70% at 50% 100%, #000 25%, transparent 80%);
    mask-image: radial-gradient(120% 70% at 50% 100%, #000 25%, transparent 80%);
  }
  .band-wrap {
    display: grid;
    gap: var(--sp-2);
  }
  .band-cap {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding-inline: 4px;
    color: var(--text-2);
    font-size: 0.8125rem;
  }
  .band-cap :global(svg) {
    flex: none;
    color: var(--accent);
  }
  .drop-say {
    display: grid;
    gap: var(--sp-1);
    padding-inline: 4px;
  }
  .drop-title {
    font-size: 1.375rem;
    line-height: 1.2;
    font-weight: 640;
    font-stretch: 108%;
    letter-spacing: -0.015em;
  }
  .t-touch {
    display: none;
  }
  @media (hover: none) and (pointer: coarse) {
    .t-fine {
      display: none;
    }
    .t-touch {
      display: inline;
    }
  }

  /* Action principale : papier sur encre, la menthe reste le signe « scellé ». */
  .browse {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 56px;
    padding: 0 var(--sp-5);
    border: 0;
    border-radius: 14px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 1.0625rem;
    font-weight: 620;
    cursor: pointer;
    box-shadow:
      0 10px 24px -14px rgb(0 0 0 / 0.9),
      inset 0 -2px 0 rgb(11 13 18 / 0.12);
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      transform var(--dur-press) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  .browse :global(svg) {
    transition: transform 500ms var(--ease-settle);
  }
  @media (hover: hover) {
    .browse:hover {
      background: #fff;
    }
    .browse:hover :global(svg) {
      transform: translateX(4px);
    }
  }
  .browse:active {
    transform: scale(0.97);
  }

  .make {
    display: grid;
    gap: 10px;
  }

  /* Téléphone : « Ajouter » remplace « Commencer » et la rangée de tuiles (aucun doublon). */
  .add-big {
    display: none;
  }
  @media (max-width: 759px) {
    .browse,
    .make,
    .band-wrap,
    .guil-clip {
      display: none;
    }
    .add-big {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr);
      align-items: center;
      gap: var(--sp-4);
      width: 100%;
      min-height: 80px;
      padding: var(--sp-3) var(--sp-4) var(--sp-3) var(--sp-3);
      border: 0;
      border-radius: var(--r-xl);
      background: var(--paper);
      color: var(--ink);
      font: inherit;
      text-align: start;
      cursor: pointer;
      box-shadow:
        0 14px 30px -18px rgb(0 0 0 / 0.9),
        inset 0 -2px 0 rgb(11 13 18 / 0.12);
      transition: transform var(--dur-press) var(--ease-out);
    }
    .add-big:active {
      transform: scale(0.98);
    }
    .ab-ic {
      display: grid;
      place-items: center;
      width: 56px;
      height: 56px;
      border-radius: 18px;
      background: var(--ink);
      color: var(--accent);
    }
    .ab-tx {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .ab-t {
      font-size: 1.25rem;
      font-weight: 650;
      font-stretch: 108%;
    }
    .ab-s {
      color: rgb(11 13 18 / 0.68);
      font-size: var(--fs-small);
      line-height: var(--lh-small);
    }
    .empty {
      gap: var(--sp-5);
    }
    /* Composeur : un écran d'app, pas une carte dans la page (ni cadre, ni liseré). */
    .home.compact .compose :global(.vessel) {
      background: transparent;
      box-shadow: none;
    }
    .home.compact .compose :global(.vessel > .line),
    .home.compact .compose :global(.vessel > .spot-clip) {
      display: none;
    }
  }
  .make-t {
    margin: 0;
    padding-inline: 4px;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 3.5rem), 1fr));
    gap: var(--sp-2);
  }
  .tile {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: var(--sp-2);
    min-height: 84px;
    min-width: 0;
    padding: var(--sp-3) var(--sp-1);
    border: 0;
    border-radius: 18px;
    background: rgb(255 255 255 / 0.045);
    box-shadow:
      inset 0 0 0 1px var(--hair),
      inset 0 1px 0 rgb(255 255 255 / 0.05);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-small);
    font-weight: 560;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transform: translate(var(--tx, 0px), var(--ty, 0px)) scale(var(--s, 1));
    transition:
      transform 520ms var(--ease-settle),
      background-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }
  /* Reflet sous le pointeur (magnet). */
  .tile::before {
    content: "";
    position: absolute;
    z-index: -1;
    left: 0;
    top: 0;
    width: 160px;
    height: 160px;
    margin: -80px 0 0 -80px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(95 227 181 / 0.16), transparent);
    opacity: 0;
    transform: translate(var(--lx, 50%), var(--ly, 50%));
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .ic {
    position: relative;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    color: var(--text-2);
    transition:
      color var(--dur-fast) var(--ease-out),
      transform 520ms var(--ease-settle);
  }
  .lb {
    max-width: 100%;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  @media (hover: hover) {
    .tile:hover {
      background: rgb(255 255 255 / 0.075);
      box-shadow:
        inset 0 0 0 1px var(--hair-2),
        inset 0 1px 0 rgb(255 255 255 / 0.08);
    }
    .tile:hover::before {
      opacity: 1;
    }
    .tile:hover .ic {
      color: var(--accent);
      transform: translateY(-3px) scale(1.08);
    }
  }
  .tile:active {
    --s: 0.95;
    transition-duration: var(--dur-press);
  }
  /* Petits gestes propres à chaque tuile, au survol seulement : déclencheur, voyant, niveaux, curseur. */
  .flash,
  .rec,
  .bars,
  .caret {
    position: absolute;
    opacity: 0;
  }
  .flash {
    inset: -6px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(201 251 232 / 0.85), transparent);
  }
  .rec {
    right: -3px;
    top: -1px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }
  .bars {
    left: 100%;
    margin-left: 3px;
    display: flex;
    gap: 2px;
    align-items: center;
    height: 18px;
  }
  .bars b {
    width: 2px;
    height: 14px;
    border-radius: 2px;
    background: currentColor;
    transform: scaleY(0.3);
  }
  .caret {
    left: 100%;
    margin-left: 2px;
    top: 4px;
    width: 2px;
    height: 20px;
    background: currentColor;
  }
  @media (hover: hover) and (prefers-reduced-motion: no-preference) {
    .tile:hover .flash {
      animation: flash 520ms var(--ease-out) 1;
    }
    .tile:hover .rec {
      animation: rec 1s var(--ease-in-out) 2 both;
    }
    .tile:hover .bars {
      opacity: 1;
    }
    .tile:hover .bars b {
      animation: level 900ms var(--ease-in-out) 4 alternate;
    }
    .tile:hover .bars b:nth-child(2) {
      animation-delay: -300ms;
    }
    .tile:hover .bars b:nth-child(3) {
      animation-delay: -600ms;
    }
    .tile:hover .caret {
      animation: caret 1s steps(1) 2;
    }
  }
  @keyframes flash {
    30% {
      opacity: 0.9;
    }
    100% {
      opacity: 0;
    }
  }
  @keyframes rec {
    50% {
      opacity: 1;
    }
  }
  @keyframes level {
    to {
      transform: scaleY(1);
    }
  }
  @keyframes caret {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }

  .proof {
    max-width: none;
    margin: 0;
    padding: var(--sp-3) 4px 0;
    border-top: 1px solid var(--hair);
    color: var(--text-2);
    font-size: 0.8125rem;
  }

  .next {
    display: none;
  }

  /* ---------- Entrée (K1 : tout fini à 900 ms au plus, tout cliquable dès l'affichage) ---------- */
  @media (prefers-reduced-motion: no-preference) {
    /* Audit performance (5 novembre) : le texte au-dessus de la ligne de flottaison ne part
       jamais d'une opacité nulle (le LCP attendait la fin de l'entrée) ; montée et flou seulement. */
    .reveal .w {
      animation: word-in var(--dur-reveal) var(--ease-out) var(--d) both;
    }
    .reveal .lede {
      animation: rise-only 600ms var(--ease-out) 120ms both;
    }
    .reveal .cert {
      animation: rise-only 560ms var(--ease-out) both;
    }
    .reveal .cert:nth-child(1) {
      animation-delay: 240ms;
    }
    .reveal .cert:nth-child(2) {
      animation-delay: 285ms;
    }
    .reveal .cert:nth-child(3) {
      animation-delay: 330ms;
    }
    .reveal .compose {
      animation: vault-in var(--dur-moment) var(--ease-settle) both;
    }
    .reveal .band-wrap,
    .reveal .drop-say,
    .reveal .browse,
    .reveal .make-t,
    .reveal .tile,
    .reveal .proof {
      animation: rise-in 480ms var(--ease-settle) var(--i, 0ms) both;
    }
    .reveal .band-wrap {
      --i: 100ms;
    }
    .reveal .drop-say {
      --i: 150ms;
    }
    .reveal .browse {
      --i: 200ms;
    }
    .reveal .make-t {
      --i: 240ms;
    }
    .reveal .tile:nth-child(1) {
      --i: 270ms;
    }
    .reveal .tile:nth-child(2) {
      --i: 310ms;
    }
    .reveal .tile:nth-child(3) {
      --i: 350ms;
    }
    .reveal .tile:nth-child(4) {
      --i: 390ms;
    }
    .reveal .tile:nth-child(5) {
      --i: 420ms;
    }
    .reveal .proof {
      --i: 400ms;
    }
  }
  @keyframes word-in {
    from {
      transform: translateY(0.32em);
      filter: blur(var(--blur-in));
    }
  }
  @keyframes rise-only {
    from {
      transform: translateY(var(--rise));
    }
  }
  @keyframes rise-in {
    from {
      opacity: 0;
      transform: translateY(var(--rise));
    }
  }
  @keyframes vault-in {
    from {
      opacity: 0;
      transform: translateY(24px) scale(0.985);
    }
  }

  @media (min-width: 600px) {
    .empty {
      padding: var(--sp-5) var(--sp-5) var(--sp-5);
    }
  }

  /* Ordinateur : texte et sceaux à gauche, coffre à droite, sur le premier écran. */
  @media (min-width: 1024px) {
    .hero {
      grid-template-columns: minmax(0, 0.95fr) minmax(480px, 620px);
      align-items: center;
      column-gap: 88px;
      min-height: min(calc(100svh - 64px), 860px);
      padding-block: var(--sp-5) 88px;
    }
    .pitch {
      display: grid;
      gap: var(--sp-5);
      align-content: center;
    }
    .lede {
      font-size: 1.125rem;
    }
    .certs {
      margin-top: var(--sp-2);
    }
    .compose {
      order: 0;
    }
    .drop-title {
      font-size: 1.625rem;
    }
    .tile {
      min-height: 92px;
    }
    .next {
      position: absolute;
      left: 0;
      bottom: var(--sp-5);
      display: inline-flex;
      align-items: center;
      gap: var(--sp-2);
      min-height: 44px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--text-2);
      font: inherit;
      font-size: var(--fs-small);
      cursor: pointer;
    }
    .next :global(svg) {
      color: var(--accent);
      transition: transform 500ms var(--ease-settle);
    }
    .next:hover {
      color: var(--text);
    }
    .next:hover :global(svg) {
      transform: translateY(3px);
    }
    .home.compact .hero {
      grid-template-columns: minmax(0, 1fr);
      min-height: 0;
      padding-block: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .compose :global(.vessel),
    .tile,
    .ic,
    .cm,
    .browse,
    .browse :global(svg) {
      transition: none;
    }
    .tile:active,
    .browse:active {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    /* Le navigateur pose un fond plein derrière chaque ligne : avec un interligne < 1, celui de la
       ligne suivante masquait les jambages (« passe », « lien, »). */
    h1 {
      line-height: 1.15;
    }
    .sheet-back,
    .guil-clip,
    .tile::before,
    .flash {
      display: none;
    }
    .tile,
    .cert,
    .browse {
      border: 1px solid ButtonText;
      box-shadow: none;
    }
    .cert::after,
    .cert::before {
      display: none;
    }
    .cm {
      box-shadow: none;
      background: Canvas;
    }
  }
  @media (forced-colors: active) {
    .add-big {
      border: 1px solid ButtonText;
    }
  }
</style>
