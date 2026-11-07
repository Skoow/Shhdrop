<script lang="ts">
  // Lien invalide, lien incomplet (UI §9.11) : message unique (spec §5.2), capsule déjà
  // dissoute (contour en pointillés, immobile), retour à l'envoi. En démo seulement, une phrase
  // explique pourquoi un lien de démo ouvert ailleurs est invalide (crochet getDemo, jamais
  // une chaîne du dictionnaire de production).
  import { getDemo } from "../app/demo-hooks";
  import { followLink, href } from "../app/router.svelte";
  import { t } from "../i18n/i18n.svelte";
  import { announce } from "../ui/announce";

  type Props = { kind: "invalid" | "incomplete" };
  let { kind }: Props = $props();
  const demo = getDemo();

  let title: HTMLHeadingElement | undefined = $state();
  $effect(() => {
    if (!title) return;
    title.focus({ preventScroll: true });
    announce(title.textContent ?? "");
  });
</script>

<section class="invalid" aria-labelledby="invalid-title" data-invalid={kind}>
  <span class="capsule-gone" aria-hidden="true"></span>
  <h1 id="invalid-title" class="title" tabindex="-1" bind:this={title}>{t(kind === "invalid" ? "invalid" : "incomplete")}</h1>
  {#if kind === "incomplete"}
    <p class="lede">{t("incomplete.hint")}</p>
  {:else if demo}
    <p class="lede demo-note">{demo.invalidLinkNote}</p>
  {/if}
  <p><a class="send" href={href("/")} onclick={(e) => followLink(e, "/")}>{t("invalid.send")}</a></p>
</section>

<style>
  .invalid {
    width: min(100%, 640px);
    margin-inline: auto;
    padding: var(--sp-8) var(--sp-4);
    display: grid;
    justify-items: start;
    gap: var(--sp-4);
  }
  .capsule-gone {
    width: 96px;
    height: 60px;
    border: 2px dashed var(--line-strong);
    border-radius: var(--r-pill);
    margin-bottom: var(--sp-3);
  }
  .title {
    margin: 0;
    font-size: var(--fs-screen);
    font-stretch: var(--wd-screen);
    line-height: 1.1;
    letter-spacing: -0.02em;
    text-wrap: balance;
    max-width: 22ch;
  }
  .title:focus {
    outline: none;
  }
  .lede {
    margin: 0;
    color: var(--text-2);
    max-width: 60ch;
  }
  .send {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--accent);
    text-underline-offset: 0.2em;
  }
  @media (hover: hover) {
    .send:hover {
      color: var(--accent-hover);
    }
  }
  @media (forced-colors: active) {
    .capsule-gone {
      border-color: CanvasText;
    }
  }
</style>
