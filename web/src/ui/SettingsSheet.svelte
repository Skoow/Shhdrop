<script lang="ts">
  // Réglages : langue, Sécurité, Confidentialité, À propos. Même panneau depuis l'onglet
  // Réglages (téléphone) et l'entrée discrète de l'en-tête (ordinateur, écrans sans onglets).
  import { followLink, href } from "../app/router.svelte";
  import type { Lang } from "../i18n/format";
  import { getLang, setLang, t } from "../i18n/i18n.svelte";
  import { ArrowRight } from "./Icon";
  import Sheet from "./Sheet.svelte";
  import Switch from "./Switch.svelte";
  import { fileSettings } from "../flows/settings.svelte";

  /** `locked` : pendant un envoi, la langue ne change pas (UI §10). */
  let { open = $bindable(false), locked = false }: { open: boolean; locked?: boolean } = $props();

  const CODE_URL = "https://github.com/Skoow/Shhdrop";
  function pick(l: Lang) {
    if (!locked) setLang(l);
  }
  function go(e: MouseEvent, path: string) {
    open = false;
    followLink(e, path);
  }
</script>

<Sheet bind:open title={t("settings.title")}>
  <div class="set">
    <section aria-labelledby="set-lang">
      <h3 id="set-lang">{t("settings.lang")}</h3>
      <div class="langs">
        <button type="button" class="row" lang="fr" aria-pressed={getLang() === "fr"} aria-disabled={locked} aria-describedby={locked ? "set-lang-locked" : undefined} onclick={() => pick("fr")}>Français</button>
        <button type="button" class="row" lang="en" aria-pressed={getLang() === "en"} aria-disabled={locked} aria-describedby={locked ? "set-lang-locked" : undefined} onclick={() => pick("en")}>English</button>
      </div>
      {#if locked}<p id="set-lang-locked" class="about">{t("shell.lang.locked")}</p>{/if}
    </section>
    <section aria-labelledby="set-files">
      <h3 id="set-files">{t("settings.files")}</h3>
      <Switch label={t("settings.clean")} hint={t("settings.clean.hint")} checked={fileSettings.autoClean} onchange={(v) => (fileSettings.autoClean = v)} />
    </section>
    <section aria-labelledby="set-info">
      <h3 id="set-info">{t("settings.info")}</h3>
      <a class="row link" href={href("/securite")} onclick={(e) => go(e, "/securite")}>{t("shell.security")}<ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" /></a>
      <a class="row link" href={href("/confidentialite")} onclick={(e) => go(e, "/confidentialite")}>{t("shell.privacy")}<ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" /></a>
    </section>
    <section aria-labelledby="set-about">
      <h3 id="set-about">{t("settings.about")}</h3>
      <p class="about">{t("settings.about.body")}</p>
      <a class="row link" href={CODE_URL} rel="noopener noreferrer" target="_blank">{t("settings.code")}<ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" /></a>
    </section>
  </div>
</Sheet>

<style>
  .set {
    display: grid;
    gap: var(--sp-5);
  }
  section {
    display: grid;
    gap: var(--sp-2);
  }
  h3 {
    font-size: var(--fs-small);
    color: var(--text-2);
    font-weight: 600;
  }
  .langs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-2);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    min-height: 52px;
    padding: 0 var(--sp-4);
    border: 0;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.05);
    box-shadow: inset 0 0 0 1px var(--hair-2);
    color: var(--text);
    font: inherit;
    font-weight: 560;
    text-decoration: none;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .langs .row {
    justify-content: center;
  }
  .row:active {
    background: rgb(255 255 255 / 0.1);
  }
  .row[aria-pressed="true"] {
    background: var(--accent-tint);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .about {
    margin: 0;
    color: var(--text-2);
  }
  .row[aria-disabled="true"] {
    color: var(--text-disabled);
    cursor: not-allowed;
  }
</style>
