<script lang="ts">
  // Options de l'envoi (UI §9.3, benchmark M4) : durée et ouvertures (phrase « S'efface dans
  // 12 h ou après 1 ouverture… » sur ordinateur), mot de passe, destinataire (interrupteur
  // « Autoriser le téléchargement » ; plus de sous-option du coffre, décision du propriétaire du
// 11 novembre), estimation du temps d'envoi.
  // `compact` : feuille du téléphone, une ligne d'aide au plus par réglage.
  // Choix payants : plus aucun ici (décision du propriétaire du 11 novembre, audit M17) ; une
  // seule ligne discrète dans l'en-tête du composeur ouvre la feuille d'information.
  import { MAX_OPENS, PW_TRIES, TTL_HOURS } from "../index";
  import type { Options } from "../flows/options.svelte";
  import { formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { ShieldAlert, TriangleAlert } from "../ui/Icon";
  import PassphraseField from "../ui/PassphraseField.svelte";
  import Segmented from "../ui/Segmented.svelte";
  import Switch from "../ui/Switch.svelte";

  type Props = {
    options: Options;
    /** Éléments qui ne pourront pas être ouverts sans téléchargement (spec §34). */
    unviewable: string[];
    compact?: boolean;
    /**
     * Ordinateur large : « controls » (réglages, colonne du milieu) et « summary » (phrase et
     * estimation, colonne de l'envoi) ; « all » ailleurs.
     */
    part?: "all" | "controls" | "summary";
  };
  let { options, unviewable, compact = false, part = "all" }: Props = $props();

  const lang = $derived(getLang());
  const ttlLabel = (h: number) => formatDuration(h * 3600, lang);
  const ttlOptions = $derived(TTL_HOURS.map((h) => ({ value: h, label: ttlLabel(h) })));
  const opensOptions = Array.from({ length: MAX_OPENS }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  // Une seule durée quand les deux s'arrondissent pareil (« environ 1 s », pas « 1 s à 1 s »).
  const opensText = $derived(t("options.opens.count", { n: options.maxOpens }));

  // Phrase coupée autour des valeurs pour les mettre en avant, sans HTML dans les textes.
  const parts = $derived.by(() => {
    const ttl = ttlLabel(options.ttlHours);
    const s = t("options.summary", { ttl: "\u0000", opens: "\u0001" });
    return s.split(/(\u0000|\u0001)/).map((p) => (p === "\u0000" ? { b: ttl } : p === "\u0001" ? { b: opensText } : { s: p }));
  });
</script>

{#snippet summary()}
  <p class="summary">
    {#each parts as p, i (i)}{#if "b" in p}<b class="num">{p.b}</b>{:else}{p.s}{/if}{/each}
  </p>
{/snippet}
{#snippet trust()}
  <p class="line"><ShieldAlert size={16} strokeWidth={1.9} aria-hidden="true" /><span>{t("options.pw.lead")}</span></p>
  <p class="line"><ShieldAlert size={16} strokeWidth={1.9} aria-hidden="true" /><span>{t("options.tries", { n: PW_TRIES })}</span></p>
{/snippet}

{#if part === "summary"}
  <div class="sumpart">
    {@render summary()}
    <div class="trustpart">{@render trust()}</div>
  </div>
{:else}
<section class={["opts", { compact, dense: part === "controls" }]} aria-labelledby={compact ? undefined : "opts-title"} aria-label={compact ? t("options.title") : undefined}>
  {#if !compact}<h2 id="opts-title" class="h">{t("options.title")}</h2>{/if}

  <div class="block">
    {#if part === "all"}{@render summary()}{/if}
    <div class="ctl">
      <span class="cl" aria-hidden="true">{t("options.ttl.label")}</span>
      <Segmented label={t("options.ttl.label")} options={ttlOptions} bind:value={() => options.ttlHours, (v) => (options.ttlHours = v)} />
      <p class="hint">{t("options.ttl.hint")}</p>
    </div>
    <div class="ctl">
      <span class="cl" aria-hidden="true">{t("options.opens.label")}</span>
      <Segmented label={t("options.opens.label")} options={opensOptions} columns={5} bind:value={() => options.maxOpens, (v) => (options.maxOpens = v)} />
      <p class="hint">{t("options.opens.hint")}</p>
    </div>
  </div>

  <div class="block">
    <h3 class="h3">{t("options.pw.title")}</h3>
    <PassphraseField {options} />
    {#if part === "all"}{@render trust()}{/if}
  </div>

  <div class="block" role="group" aria-labelledby="rights-title">
    <h3 class="h3" id="rights-title">{t("options.rights.label")}</h3>
    <div class="rights">
      <Switch label={t("options.download.label")} hint={t("options.download.hint")} checked={options.allowDownload} onchange={(v) => (options.allowDownload = v)} />
    </div>
    {#if !options.allowDownload && unviewable.length > 0}
      <div class="warn" role="status">
        <TriangleAlert size={16} strokeWidth={1.9} aria-hidden="true" />
        <span>{t("options.download.warn", { n: unviewable.length })}</span>
        <button type="button" class="fix" onclick={() => (options.allowDownload = true)}>{t("options.download.label")}</button>
      </div>
    {/if}
  </div>

</section>
{/if}

<style>
  .opts {
    display: grid;
    gap: var(--sp-5);
    min-width: 0;
  }
  .compact {
    gap: var(--sp-4);
  }
  /* Colonne du milieu sur grand écran : réglages serrés, tout tient sans défiler. */
  .dense {
    gap: var(--sp-4);
  }
  .dense .block {
    gap: var(--sp-2);
  }
  .dense .h {
    font-size: 1.0625rem;
  }
  .sumpart {
    display: grid;
    gap: var(--sp-3);
  }
  .trustpart {
    display: grid;
    gap: var(--sp-2);
    padding-top: var(--sp-3);
    border-top: 1px solid var(--hair);
  }
  .h {
    font-size: var(--fs-h3);
    font-weight: 640;
    letter-spacing: -0.01em;
  }
  .block {
    display: grid;
    gap: var(--sp-3);
    min-width: 0;
  }
  .summary {
    margin: 0;
    font-size: 1.1875rem;
    line-height: 1.4;
    font-weight: 520;
    text-wrap: pretty;
  }
  .compact .summary {
    font-size: 1.0625rem;
  }
  .summary b {
    color: var(--accent);
    font-weight: 680;
  }
  .ctl {
    display: grid;
    gap: 6px;
  }
  .cl {
    color: var(--text-2);
    font-size: var(--fs-small);
    font-weight: 600;
  }
  .hint {
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-small);
  }
  .h3 {
    font-size: 1rem;
    font-weight: 640;
  }
  .line {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
    line-height: 1.45;
  }
  .line > :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--accent);
  }
  .rights {
    display: grid;
    border-radius: 14px;
  }
  .warn {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 4px 8px;
    padding: 8px 8px 8px 12px;
    border-radius: 12px;
    background: var(--warn-tint);
    color: var(--text);
    font-size: var(--fs-small);
  }
  .warn > :global(svg) {
    color: var(--warn);
  }
  .fix {
    grid-column: 2;
    justify-self: start;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--warn);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  @media (forced-colors: active) {
    .warn {
      border: 1px solid CanvasText;
    }
  }
</style>
