<script lang="ts">
  // Bloc compact des offres de la page d'envoi (retours du propriétaire du 12 novembre, remplace
  // la ligne « Plus de place et de durée avec Plus et Pro, bientôt ») : Gratuit, Plus, Pro, avec
  // trois limites chacun, lues dans les constantes (CONTENT_MAX, PAID…), jamais écrites dans les
  // textes ; « bientôt » et un lien vers /offres. Rien n'est en vente : ni prix, ni bouton
  // d'achat, ni adresse demandée (D41-16). Plus et Pro ouvrent leur feuille d'information sur
  // place (`onpaid`, la liste reste). `newTab` : la liste en cours serait perdue en quittant la
  // page, la page des offres s'ouvre alors dans un nouvel onglet.
  // `cards` (accueil, refonte du 12 novembre) : trois grandes cartes, chacune un lien vers
  // /offres (« → ») ; le titre est celui de la section de l'accueil.
  import { followLink, href } from "../app/router.svelte";
  import { formatBytes, formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { CONTENT_MAX, MAX_OPENS, PAID, TTL_MAX_HOURS, type PaidTier } from "../limits";
  import { reveal } from "./attach";
  import { ArrowRight } from "./Icon";

  let { newTab = false, onpaid, cards = false }: { newTab?: boolean; onpaid?: (tier: PaidTier) => void; cards?: boolean } = $props();
  type Tier = "free" | PaidTier;
  const TIERS: readonly Tier[] = ["free", "plus", "pro"];
  const lang = $derived(getLang());
  const name = (x: Tier) => (x === "free" ? t("offers.free") : t(`paid.badge.${x}`));
  const lines = (x: Tier) => [
    formatBytes(x === "free" ? CONTENT_MAX : PAID[x].bytes, lang),
    x === "free" ? formatDuration(TTL_MAX_HOURS * 3600, lang) : t("paid.days", { n: Math.max(...PAID[x].ttlDays) }),
    t("options.opens.count", { n: x === "free" ? MAX_OPENS : PAID[x].opens }),
  ];
  const uid = $props.id();
</script>

{#if cards}
  <ul class="tiers big" data-offer-cards>
    {#each TIERS as x, i (x)}
      <li data-offer={x} class="rv" style:--i="{i * 70}ms" {@attach reveal}>
        <a class="tier {x}" href={href("/offres")} onclick={(e) => followLink(e, "/offres")}>
          <span class="nm">
            <span class="tn">{name(x)}</span>
            <span class={["tag", { soon: x !== "free" }]}>{x === "free" ? t("offers.strip.now") : t("foot.soon")}</span>
          </span>
          <span class="lim num">
            {#each lines(x) as l, k (k)}<span class="l">{l}</span>{/each}
          </span>
          <span class="go" aria-hidden="true"><ArrowRight size={18} strokeWidth={2} /></span>
        </a>
      </li>
    {/each}
  </ul>
{:else}
<section class="strip" aria-labelledby="{uid}-t" data-offer-strip>
  <div class="hd">
    <h3 class="t" id="{uid}-t">{t("offers.strip.title")}</h3>
    {#if newTab}
      <a class="more" href={href("/offres")} target="_blank" rel="noopener" data-offer-link>{t("offers.strip.more")}<span class="sr-only"> {t("offers.strip.newTab")}</span><ArrowRight size={15} strokeWidth={2} aria-hidden="true" /></a>
    {:else}
      <a class="more" href={href("/offres")} onclick={(e) => followLink(e, "/offres")} data-offer-link>{t("offers.strip.more")}<ArrowRight size={15} strokeWidth={2} aria-hidden="true" /></a>
    {/if}
  </div>
  <ul class="tiers">
    {#each TIERS as x (x)}
      <li data-offer={x}>
        {#snippet body()}
          <span class="nm">
            <span class="tn">{name(x)}</span>
            <span class={["tag", { soon: x !== "free" }]}>{x === "free" ? t("offers.strip.now") : t("foot.soon")}</span>
          </span>
          <span class="lim num">
            {#each lines(x) as l, i (i)}<span class="l">{l}</span>{/each}
          </span>
        {/snippet}
        {#if x === "free" || !onpaid}
          <div class="tier {x}">{@render body()}</div>
        {:else}
          {@const tier = x}
          <button type="button" class="tier {x}" aria-haspopup="dialog" onclick={() => onpaid(tier)}>{@render body()}</button>
        {/if}
      </li>
    {/each}
  </ul>
</section>
{/if}

<style>
  .strip {
    display: grid;
    gap: 8px;
    min-width: 0;
    container-type: inline-size;
  }
  .hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
  }
  .t {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  /* Lien sans soulignement de travers : texte d'accent et flèche, cible de 44 px (marges négatives). */
  .more {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    margin-block: -12px;
    padding-inline: 4px;
    border-radius: 8px;
    color: var(--accent);
    font-size: var(--fs-small);
    font-weight: 600;
    text-decoration: none;
  }
  .more:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (hover: hover) {
    .more:hover {
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }
  }
  .tiers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .tiers > li {
    display: grid;
    min-width: 0;
  }
  .tier {
    display: grid;
    align-content: start;
    gap: 4px;
    min-width: 0;
    min-height: 44px;
    margin: 0;
    padding: 8px 10px 9px;
    border: 0;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.03);
    box-shadow: inset 0 0 0 1px var(--hair);
    color: var(--text);
    font: inherit;
    text-align: start;
  }
  button.tier {
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--dur-press) var(--ease-out);
  }
  button.tier:active {
    transform: scale(0.98);
  }
  button.tier:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (hover: hover) {
    button.tier:hover {
      filter: brightness(1.15);
    }
  }
  .tier.plus {
    background: var(--plus-tint);
    box-shadow: inset 0 0 0 1px var(--plus-line);
  }
  .tier.pro {
    background: var(--pro-tint);
    box-shadow: inset 0 0 0 1px var(--pro-line);
  }
  .nm {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 6px;
    margin: 0;
  }
  .tn {
    font-weight: 700;
  }
  .plus .tn {
    color: var(--plus);
  }
  .pro .tn {
    color: var(--pro);
  }
  .tag {
    color: var(--text-3);
    font-size: var(--fs-micro);
  }
  .tag.soon {
    color: var(--text-2);
  }
  .lim {
    display: grid;
    gap: 1px;
    color: var(--text-2);
    font-size: var(--fs-micro);
    line-height: 1.35;
  }
  .l {
    overflow-wrap: anywhere;
  }
  .l:first-child {
    color: var(--text);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  /* Colonne étroite (ordinateur, au-dessus de l'envoi) : une formule par rangée, nom à gauche,
     limites sur une ligne. */
  @container (max-width: 330px) {
    .tiers {
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
    }
    .tier {
      grid-template-columns: auto minmax(0, 1fr);
      align-items: baseline;
      column-gap: 10px;
      padding: 7px 10px;
    }
    .nm {
      flex-direction: column;
      gap: 0;
    }
    .lim {
      display: flex;
      flex-wrap: wrap;
      gap: 0 8px;
      justify-content: flex-end;
      text-align: end;
    }
    .l:first-child {
      font-size: var(--fs-micro);
    }
  }
  /* Accueil : trois grandes cartes, nom et « bientôt » en haut, limites, flèche qui avance au survol. */
  .big {
    gap: var(--sp-4);
  }
  .big .tier {
    position: relative;
    gap: var(--sp-4);
    min-height: 180px;
    padding: 22px 22px 20px;
    border-radius: 20px;
    background: linear-gradient(180deg, rgb(15 22 42 / 0.9), rgb(10 15 30 / 0.9));
    box-shadow: inset 0 0 0 1px rgb(150 175 255 / 0.14);
    text-decoration: none;
    transition:
      transform 420ms var(--ease-settle),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .big .tier.plus {
    background: linear-gradient(180deg, rgb(11 36 51 / 0.85), rgb(10 15 30 / 0.9));
    box-shadow: inset 0 0 0 1px rgb(31 168 230 / 0.45);
  }
  .big .tier.pro {
    background: linear-gradient(180deg, rgb(18 27 64 / 0.85), rgb(10 15 30 / 0.9));
    box-shadow: inset 0 0 0 1px rgb(52 97 255 / 0.55);
  }
  .big .tn {
    font-size: 1.375rem;
    letter-spacing: -0.015em;
  }
  .big .tag {
    padding: 1px 8px;
    border-radius: var(--r-pill);
    background: rgb(255 255 255 / 0.06);
    font-size: 0.75rem;
  }
  .big .lim {
    gap: 4px;
    font-size: var(--fs-small);
  }
  .big .l:first-child {
    font-size: 1.75rem;
    font-weight: 680;
    letter-spacing: -0.02em;
  }
  .go {
    position: absolute;
    inset-block-end: 18px;
    inset-inline-end: 18px;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.05);
    color: var(--text-2);
    transition: transform 420ms var(--ease-settle), color var(--dur-fast) var(--ease-out);
  }
  .big .tier:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  @media (hover: hover) {
    .big .tier:hover {
      transform: translateY(-3px);
    }
    .big .tier:hover .go {
      transform: translateX(3px);
      color: var(--text);
    }
  }
  @media (max-width: 759px) {
    .big {
      grid-template-columns: minmax(0, 1fr);
    }
    .big .tier {
      min-height: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .big .tier,
    .go {
      transition: none;
    }
    .big .tier:hover,
    .big .tier:hover .go {
      transform: none;
    }
  }
  @media (forced-colors: active) {
    .tier,
    .tier.plus,
    .tier.pro {
      border: 1px solid CanvasText;
    }
  }
</style>
