<script lang="ts">
  // Règles d'un mot de passe saisi (spec §31 : 10 caractères au moins, ni répétition, ni suite,
  // ni rangée de clavier, ni mot de passe courant), en direct, et indication de solidité fondée
  // sur la longueur seulement : aucune promesse chiffrée, aucun calcul « d'entropie » (UI §20.8).
  import type { PwCheck } from "../index";
  import { t } from "../i18n/i18n.svelte";
  import { Check, X } from "./Icon";

  type Props = { value: string; result: PwCheck | null; min: number; id?: string };
  let { value, result, min, id }: Props = $props();

  const len = $derived([...value.normalize("NFC")].length);
  const longEnough = $derived(len >= min);
  const weak = $derived(longEnough && result !== null && !result.ok && result.reason !== "trop_court" ? result.reason : null);
  const notCommon = $derived(longEnough && result !== null && result.ok);
  const strength = $derived(!longEnough || weak !== null ? "weak" : len >= 20 ? "good" : "ok");
</script>

<div class="pc" {id}>
  <div class="meter">
    <span class={["seg", strength, { on: len > 0 }]}></span>
    <span class={["seg", strength, { on: longEnough }]}></span>
    <span class={["seg", strength, { on: strength === "good" }]}></span>
    <span class={["lbl", strength]}>{len === 0 ? t("options.pw.length", { n: 0 }) : weak !== null ? t("options.pw.strength.guessable") : t(`options.pw.strength.${strength}`)}</span>
  </div>
  <ul class="rules">
    <li class={{ ok: longEnough }}>
      {#if longEnough}<Check size={16} strokeWidth={2.2} aria-hidden="true" />{:else}<X size={16} strokeWidth={2.2} aria-hidden="true" />{/if}
      <span>{t("options.pw.rule.length", { min })} <span class="num cnt">({len}/{min})</span></span>
    </li>
    <li class={{ ok: notCommon }}>
      {#if notCommon}<Check size={16} strokeWidth={2.2} aria-hidden="true" />{:else}<X size={16} strokeWidth={2.2} aria-hidden="true" />{/if}
      <span>{t(weak === null ? "options.pw.rule.common" : `options.pw.rule.${weak}`)}</span>
    </li>
  </ul>
  <p class="tip">{t("options.pw.tip")}</p>
</div>

<style>
  .pc {
    display: grid;
    gap: var(--sp-2);
  }
  .meter {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
    align-items: center;
    gap: 4px;
  }
  .seg {
    height: 4px;
    border-radius: 2px;
    background: rgb(233 236 242 / 0.12);
  }
  .seg.on.weak {
    background: var(--danger);
  }
  .seg.on.ok {
    background: var(--warn);
  }
  .seg.on.good {
    background: var(--accent);
  }
  .lbl {
    min-width: 6.5rem;
    padding-inline-start: var(--sp-2);
    color: var(--text-2);
    font-size: var(--fs-small);
    text-align: end;
  }
  .rules {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 16px;
    font-size: var(--fs-small);
    color: var(--text-2);
  }
  .rules li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .rules li :global(svg) {
    flex: none;
    color: var(--text-3);
  }
  .rules li.ok {
    color: var(--text);
  }
  .rules li.ok :global(svg) {
    color: var(--accent);
  }
  .cnt {
    color: var(--text-3);
  }
  .tip {
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-small);
  }
  @media (forced-colors: active) {
    .seg {
      background: GrayText;
    }
    .seg.on {
      background: Highlight;
      forced-color-adjust: none;
    }
  }
</style>
