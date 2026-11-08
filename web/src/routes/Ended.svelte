<script lang="ts">
  // Fin de lecture chez le destinataire (UI §9.8, §9.10 ; benchmark S4) : affichée après la
  // dissolution, quand Content est démonté (plus aucune référence au contenu déchiffré).
  // Texte, reçu et lien sont en place dès l'arrivée ; la gomme du logo (destruction) se joue
  // dans son cadre fixe, donc l'interrompre d'un appui ne décale rien (WebKit, clics perdus).
  import { followLink, href } from "../app/router.svelte";
  import { t } from "../i18n/i18n.svelte";
  import { announce } from "../ui/announce";
  import DestroyReceipt from "../ui/DestroyReceipt.svelte";
  import Logo from "../ui/Logo.svelte";

  type Props = { kind: "destroyed" | "gone" };
  let { kind }: Props = $props();

  let title: HTMLHeadingElement | undefined = $state();
  let logo: Logo | undefined = $state();
  $effect(() => {
    if (!title) return;
    title.focus({ preventScroll: true });
    announce(title.textContent ?? "");
    if (kind === "destroyed") void logo?.erase();
  });
</script>

<section class="end" aria-labelledby="end-title" data-end={kind}>
  {#if kind === "destroyed"}<div class="end-logo"><Logo bind:this={logo} /></div>{/if}
  <h2 id="end-title" class="title" tabindex="-1" bind:this={title}>
    {kind === "destroyed" ? t("destroyed.title") : t("gone.title")}
  </h2>
  <p class="lede">{t("destroyed.body")}</p>
  {#if kind === "destroyed"}<DestroyReceipt />{/if}
  <p><a class="send" href={href("/")} onclick={(e) => followLink(e, "/")}>{t("invalid.send")}</a></p>
</section>

<style>
  .end {
    display: grid;
    justify-items: start;
    gap: var(--sp-4);
    min-width: 0;
  }
  .end-logo {
    height: 34px;
  }
  .title {
    margin: 0;
    font-size: var(--fs-h1);
    font-weight: var(--fw-h1);
    font-stretch: var(--wd-h1);
    line-height: var(--lh-h1);
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
</style>
