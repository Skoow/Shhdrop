<script lang="ts">
  // Options de l'envoi (UI §9.3, benchmark M4) : la phrase « S'efface dans 12 h ou après
  // 1 ouverture, au premier des deux. » et ses deux contrôles (Durée, Ouvertures) ; mot de passe ;
  // ce que le destinataire peut faire (spec §34). Chiffres lus dans les constantes.
  import type { PwCheck } from "../index";
  import { MAX_OPENS, PW_MIN_CHARS, PW_TRIES, TTL_HOURS } from "../index";
  import type { Options, Rights } from "../flows/options.svelte";
  import { formatDuration } from "../i18n/format";
  import { getLang, t } from "../i18n/i18n.svelte";
  import { ShieldAlert } from "../ui/Icon";
  import PassphraseField from "../ui/PassphraseField.svelte";
  import Segmented from "../ui/Segmented.svelte";

  type Props = {
    options: Options;
    pwResult: PwCheck | null;
    /** Éléments qui empêchent « Voir seulement » (spec §34). */
    viewOnlyBlocked: string[];
    vaultAllowed: boolean;
    /** Raison de blocage du mot de passe, reliée au champ. */
    pwErrorId?: string;
  };
  let { options, pwResult, viewOnlyBlocked, vaultAllowed, pwErrorId }: Props = $props();

  const lang = $derived(getLang());
  const ttlLabel = (h: number) => formatDuration(h * 3600, lang);
  const ttlOptions = $derived(TTL_HOURS.map((h) => ({ value: h, label: ttlLabel(h) })));
  const opensOptions = Array.from({ length: MAX_OPENS }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  const opensText = $derived(t("options.opens.count", { n: options.maxOpens }));

  // Phrase coupée autour des valeurs pour les mettre en avant, sans HTML dans les textes.
  const parts = $derived.by(() => {
    const ttl = ttlLabel(options.ttlHours);
    const s = t("options.summary", { ttl: "\u0000", opens: "\u0001" });
    return s.split(/(\u0000|\u0001)/).map((p) => (p === "\u0000" ? { b: ttl } : p === "\u0001" ? { b: opensText } : { s: p }));
  });

  const RIGHTS: Rights[] = ["voir", "enregistrer", "coffre"];
  const shownRights = $derived(RIGHTS.filter((r) => r !== "coffre" || vaultAllowed));
  const voirBlocked = $derived(viewOnlyBlocked.length > 0);
  // Si « Voir seulement » devient impossible (élément ajouté), on revient au défaut.
  $effect(() => {
    if (voirBlocked && options.rights === "voir") options.rights = "enregistrer";
  });
</script>

<section class="opts" aria-labelledby="opts-title">
  <h2 id="opts-title" class="h">{t("options.title")}</h2>

  <div class="block">
    <p class="summary">
      {#each parts as p, i (i)}{#if "b" in p}<b class="num">{p.b}</b>{:else}{p.s}{/if}{/each}
    </p>
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
    <p class="lead">{t("options.pw.lead")}</p>
    <PassphraseField {options} min={PW_MIN_CHARS} result={pwResult} describedby={pwErrorId} />
    <p class="tries"><ShieldAlert size={16} strokeWidth={1.9} aria-hidden="true" />{t("options.tries", { n: PW_TRIES })}</p>
  </div>

  <fieldset class="block rights">
    <legend class="h3">{t("options.rights.label")}</legend>
    {#each shownRights as r (r)}
      {@const off = r === "voir" && voirBlocked}
      <label class={["card", { on: options.rights === r, off }]}>
        <input
          type="radio"
          name="shh-rights"
          value={r}
          checked={options.rights === r}
          disabled={off}
          aria-describedby="rights-{r}"
          onchange={() => (options.rights = r)}
        />
        <span class="ct">
          <span class="rt">{t(`options.rights.${r}`)}</span>
          <span class="rp" id="rights-{r}">
            {#if off}{t("options.rights.voir.blocked", { names: viewOnlyBlocked.join(", ") })}
            {:else if r === "coffre"}{t("options.rights.coffre.p", { duration: ttlLabel(options.ttlHours) })}
            {:else}{t(`options.rights.${r}.p`)}{/if}
          </span>
        </span>
      </label>
    {/each}
  </fieldset>
</section>

<style>
  .opts {
    display: grid;
    gap: var(--sp-5);
    min-width: 0;
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
    margin: 0;
    padding: 0;
    border: 0;
  }
  .summary {
    margin: 0;
    font-size: 1.1875rem;
    line-height: 1.4;
    font-weight: 520;
    text-wrap: pretty;
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
    padding: 0;
    font-size: 1rem;
    font-weight: 640;
  }
  .lead {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
    line-height: 1.5;
  }
  .tries {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .tries :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--accent);
  }
  .rights legend {
    margin-bottom: var(--sp-3);
  }
  .card {
    position: relative;
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: var(--sp-3);
    align-items: start;
    padding: 14px var(--sp-4);
    border-radius: 14px;
    background: rgb(255 255 255 / 0.03);
    box-shadow: inset 0 0 0 1px var(--hair);
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }
  .card + .card {
    margin-top: var(--sp-2);
  }
  .card.on {
    background: rgb(16 42 35 / 0.55);
    box-shadow: inset 0 0 0 1.5px rgb(95 227 181 / 0.55);
  }
  .card.off {
    cursor: not-allowed;
  }
  .card.off .rt {
    color: var(--text-disabled);
  }
  .card input {
    width: 20px;
    height: 20px;
    margin: 1px 0 0;
    accent-color: var(--accent);
  }
  .card:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .ct {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .rt {
    font-weight: 600;
  }
  .rp {
    color: var(--text-2);
    font-size: var(--fs-small);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  @media (prefers-reduced-motion: reduce) {
    .card {
      transition: none;
    }
  }
  @media (forced-colors: active) {
    .card {
      border: 1px solid CanvasText;
    }
    .card.on {
      outline: 2px solid Highlight;
    }
  }
</style>
