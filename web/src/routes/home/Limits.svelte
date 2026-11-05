<script lang="ts">
  // Accueil v4, « Ce que Shhdrop ne peut pas faire » (spec §18, benchmark motif 14) : section à
  // part, fond ambre retenu. Les limites sont dites aussi clairement que les garanties.
  import { t, type Key } from "../../i18n/i18n.svelte";
  import { reveal } from "../../ui/attach";
  import { TriangleAlert } from "../../ui/Icon";
  import SectionBg from "../../ui/SectionBg.svelte";

  const limits = ["capture", "ip", "sender", "site"] as const;
</script>

<section class="limits" aria-labelledby="limits-title">
  <SectionBg kind="caution" />
  <div class="head rv" {@attach reveal}>
    <span class="mark" aria-hidden="true"><TriangleAlert size={26} strokeWidth={1.75} /></span>
    <h2 id="limits-title">{t("home.limits.title")}</h2>
  </div>
  <ul>
    {#each limits as k (k)}<li class="rv" {@attach reveal}>{t(`home.limits.${k}` as Key)}</li>{/each}
  </ul>
</section>

<style>
  .limits {
    position: relative;
    isolation: isolate;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-6);
    padding-block: 96px;
  }
  .head {
    display: grid;
    gap: var(--sp-4);
    align-content: start;
    min-width: 0;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 16px;
    color: var(--warn);
    background: var(--warn-tint);
    box-shadow: inset 0 0 0 1px rgb(242 196 109 / 0.3);
  }
  h2 {
    min-width: 0;
    max-width: 14ch;
    overflow-wrap: break-word;
    font-size: var(--fs-section);
    line-height: 1.04;
    font-weight: 620;
    font-stretch: 110%;
    letter-spacing: -0.03em;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-3);
  }
  li {
    position: relative;
    min-width: 0;
    overflow-wrap: break-word;
    padding: 18px 20px 18px 52px;
    border-radius: 16px;
    background: rgb(20 18 14 / 0.7);
    box-shadow:
      inset 0 0 0 1px rgb(242 196 109 / 0.12),
      inset 0 1px 0 rgb(255 255 255 / 0.04);
    color: var(--text);
  }
  li::before {
    content: "";
    position: absolute;
    left: 22px;
    top: 26px;
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: var(--warn);
    transform: rotate(45deg);
  }
  @media (min-width: 720px) {
    ul {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1024px) {
    .limits {
      grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.4fr);
      column-gap: 72px;
      align-items: center;
      padding-block: 104px;
    }
  }
  @media (forced-colors: active) {
    li,
    .mark {
      border: 1px solid CanvasText;
      box-shadow: none;
    }
    li::before {
      background: CanvasText;
    }
  }
</style>
