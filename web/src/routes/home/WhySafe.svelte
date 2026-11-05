<script lang="ts">
  // Accueil v3, « Pourquoi c'est sûr » (UI §9.1 ; spec §2, §9, §18, §26) : neuf affirmations
  // vraies, chacune avec sa phrase ; un lien d'exemple dont la partie secrète est surlignée ;
  // ce que Shhdrop ne peut pas faire. Aucun nom d'algorithme (UI §20.8), jamais « 100 % ».
  import { followLink, href } from "../../app/router.svelte";
  import { t, type Key } from "../../i18n/i18n.svelte";
  import { reveal } from "../../ui/attach";
  import Guilloche from "../../ui/Guilloche.svelte";
  import { ArrowRight, CodeXml, EyeOff, HardDrive, Link2, Lock, Server, ShieldX, Timer, UserX } from "../../ui/Icon";
  import Schema from "../../ui/Schema.svelte";

  const CODE_URL = "https://github.com/Skoow/shhdrop";
  const claims = [
    { k: "e2e", icon: Lock },
    { k: "link", icon: Link2 },
    { k: "ttl", icon: Timer },
    { k: "tries", icon: ShieldX },
    { k: "key", icon: Server },
    { k: "account", icon: UserX },
    { k: "ip", icon: HardDrive },
    { k: "track", icon: EyeOff },
    { k: "code", icon: CodeXml },
  ] as const;
  const limits = ["capture", "ip", "sender", "site"] as const;
</script>

<section class="why" aria-labelledby="why-title">
  <Guilloche lines={28} />
  <div class="side rv" {@attach reveal}>
    <h2 id="why-title">{t("home.why.title")}</h2>
    <p class="lede">{t("home.why.lede")}</p>
    <figure class="example">
      <figcaption>{t("home.why.example")}</figcaption>
      <p class="url" translate="no"><span>https://shhdrop.app/</span><mark>#q3V9-kT0aZx7Lw2…</mark></p>
      <p class="note"><Lock size={15} strokeWidth={2} aria-hidden="true" />{t("home.why.example.note")}</p>
    </figure>
    <div class="schema-wrap"><Schema /></div>
    <a class="more" href={href("/securite")} onclick={(e) => followLink(e, "/securite")}>
      {t("home.why.more")}<ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" />
    </a>
  </div>

  <div class="list">
    <ul class="claims">
      {#each claims as { k, icon: Icon } (k)}
        <li class="claim rv" {@attach reveal}>
          <span class="ic"><Icon size={24} strokeWidth={1.6} aria-hidden="true" /></span>
          <div>
            <h3>{t(`home.why.${k}.t` as Key)}</h3>
            <p>
              {t(`home.why.${k}.p` as Key)}
              {#if k === "code"}<a href={CODE_URL} rel="noopener noreferrer">{t("home.why.code.link")}</a>{/if}
            </p>
          </div>
        </li>
      {/each}
    </ul>
    <div class="limits rv" {@attach reveal}>
      <h3>{t("home.limits.title")}</h3>
      <ul>
        {#each limits as k (k)}<li>{t(`home.limits.${k}` as Key)}</li>{/each}
      </ul>
    </div>
  </div>
</section>

<style>
  .why {
    grid-template-columns: minmax(0, 1fr);
    position: relative;
    isolation: isolate;
    display: grid;
    gap: var(--sp-7);
    padding-block-start: 120px;
  }
  .side {
    display: grid;
    gap: var(--sp-4);
    align-content: start;
    min-width: 0;
  }
  h2 {
    min-width: 0;
    overflow-wrap: break-word;
    font-size: var(--fs-section);
    line-height: 1.04;
    font-weight: 620;
    font-stretch: 110%;
    letter-spacing: -0.03em;
  }
  .lede {
    margin: 0;
    color: var(--text-2);
    font-size: 1.125rem;
  }

  /* Lien d'exemple (benchmark motif 13) : la fin, après « # », surlignée. */
  .example {
    margin: var(--sp-3) 0 0;
    padding: var(--sp-4) var(--sp-4) var(--sp-4);
    border-radius: var(--r-lg);
    background: rgb(4 6 9 / 0.55);
    box-shadow: inset 0 0 0 1px var(--hair);
    display: grid;
    gap: var(--sp-2);
    min-width: 0;
  }
  figcaption {
    color: var(--text-2);
    font-size: var(--fs-small);
  }
  .url {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.9375rem;
    overflow-wrap: anywhere;
    color: var(--text);
  }
  mark {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--accent-tint);
    color: var(--accent);
    box-shadow: inset 0 0 0 1px rgb(95 227 181 / 0.35);
  }
  .note {
    margin: 0;
    display: flex;
    gap: var(--sp-2);
    align-items: flex-start;
    font-size: var(--fs-small);
    color: var(--text);
  }
  .note :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--accent);
  }
  .schema-wrap {
    margin-top: var(--sp-3);
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    justify-self: start;
    min-height: 44px;
    color: var(--text);
    font-weight: 560;
    text-decoration: none;
  }
  .more :global(svg) {
    color: var(--accent);
    transition: transform 500ms var(--ease-settle);
  }
  @media (hover: hover) {
    .more:hover {
      text-decoration: underline;
      text-decoration-color: var(--accent);
      text-underline-offset: 0.3em;
    }
    .more:hover :global(svg) {
      transform: translateX(5px);
    }
  }

  .list {
    display: grid;
    gap: var(--sp-6);
    min-width: 0;
  }
  .claims {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .claim {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    gap: var(--sp-4);
    padding: 22px 4px;
    border-top: 1px solid var(--hair);
  }
  .claim:first-child {
    border-top: 0;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    color: var(--accent);
    box-shadow: inset 0 0 0 1px rgb(95 227 181 / 0.22);
    transition: transform 520ms var(--ease-settle);
  }
  @media (hover: hover) and (prefers-reduced-motion: no-preference) {
    .claim:hover .ic {
      transform: scale(1.08) rotate(-4deg);
    }
  }
  .claim h3 {
    font-size: 1.1875rem;
    line-height: 1.3;
    font-weight: 620;
    font-stretch: 104%;
  }
  .claim p {
    margin: 6px 0 0;
    color: var(--text-2);
  }
  .claim a {
    color: var(--text);
    text-decoration-color: var(--accent);
    text-underline-offset: 0.25em;
  }

  /* Limites (benchmark motif 14, spec §18) : dites, pas cachées. */
  .limits {
    padding: var(--sp-5);
    border-radius: var(--r-xl);
    background: rgb(255 255 255 / 0.03);
    box-shadow: inset 0 0 0 1px var(--hair);
  }
  .limits h3 {
    font-size: 1.1875rem;
    font-weight: 620;
  }
  .limits ul {
    margin: var(--sp-3) 0 0;
    padding-inline-start: 1.2em;
    display: grid;
    gap: var(--sp-2);
    color: var(--text-2);
  }
  .limits li::marker {
    color: var(--warn);
  }

  @media (min-width: 1024px) {
    .why {
      grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
      column-gap: 80px;
      padding-block-start: 200px;
    }
    .side {
      position: sticky;
      top: 104px;
      align-self: start;
    }
  }
  @media (forced-colors: active) {
    .example,
    .limits,
    .ic {
      border: 1px solid CanvasText;
      box-shadow: none;
    }
    mark {
      background: Highlight;
      color: HighlightText;
    }
  }
</style>
