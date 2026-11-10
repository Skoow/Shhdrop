// @vitest-environment happy-dom
// Tâche UP : mot de passe toujours généré, choix payants verrouillés, ligne « Avec Plus » au
// dépassement de taille, pages d'erreur (D41-15, D41-16, D41-17).
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOptions } from "../flows/options.svelte";
import { setScreenTitle } from "../app/title";
import { setLang } from "../i18n/i18n.svelte";
import { CONTENT_MAX, generatePassword } from "../index";
import ErrorPage from "../routes/ErrorPage.svelte";
import Options from "../routes/Options.svelte";
import CapacityGauge from "./CapacityGauge.svelte";
import PaidSheet from "./PaidSheet.svelte";

const mounted: Record<string, unknown>[] = [];
function show(C: unknown, props: Record<string, unknown>) {
  const c = mount(C as never, { target: document.body, props }) as Record<string, unknown>;
  mounted.push(c);
  flushSync();
  return c;
}
const text = () => document.body.textContent!.replace(/[  ]/g, " ");
beforeEach(() => setLang("fr"));
afterEach(() => {
  while (mounted.length) void unmount(mounted.pop()!);
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("options : mot de passe généré seulement, choix payants verrouillés", () => {
  function opts(onpaid = vi.fn()) {
    const options = createOptions({ generate: generatePassword });
    show(Options, { options, unviewable: [], vaultShown: false, estimate: { fastS: 1, slowS: 2 }, onpaid });
    return { options, onpaid };
  }
  it("aucune saisie de mot de passe : ni champ, ni « Écrire mon propre mot de passe » ; Générer un autre et Copier restent", () => {
    const { options } = opts();
    expect(document.querySelectorAll("input[type=text], input:not([type]), input[type=password]")).toHaveLength(0);
    expect(text()).not.toContain("Écrire mon propre");
    const labels = [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(labels).toContain("Générer un autre");
    expect(labels).toContain("Copier");
    const before = options.password;
    (document.querySelector('button[aria-label="Générer un autre"]') as HTMLButtonElement).click();
    flushSync();
    expect(options.password).not.toBe(before);
    expect(options.password).toHaveLength(11);
  });
  it("2, 3 et 7 jours, « Démarrer à la première ouverture » (Plus), « Jusqu'à 50 » (Pro) : verrouillés, texte blanc, aucun effet sur les options", () => {
    const { options, onpaid } = opts();
    const locked = [...document.querySelectorAll<HTMLButtonElement>("[data-locked] button, button[data-locked]")];
    expect(locked.map((b) => b.textContent!.replace(/\u202f/g, " ").trim())).toEqual(["2 jours", "3 jours", "7 jours", "Démarrer à la première ouverture", "Jusqu'à 50"]);
    const desc = locked.map((b) => document.getElementById(b.getAttribute("aria-describedby")!)!.textContent);
    expect(desc).toEqual([...Array(4).fill("Avec Plus, bientôt disponible."), "Avec Pro, bientôt disponible."]);
    expect(document.querySelectorAll(".badge")).toHaveLength(0);
    expect(locked.map((b) => b.title)).toEqual(["Plus", "Plus", "Plus", "Plus", "Pro"]);
    for (const b of locked) b.click();
    expect(onpaid.mock.calls.map((c) => c[0])).toEqual(["plus", "plus", "plus", "plus", "pro"]);
    expect([options.ttlHours, options.maxOpens]).toEqual([12, 1]);
  });
  it("sans onpaid : aucun choix verrouillé", () => {
    const options = createOptions({ generate: generatePassword });
    show(Options, { options, unviewable: [], vaultShown: false, estimate: { fastS: 1, slowS: 2 } });
    expect(document.querySelectorAll("[data-locked]")).toHaveLength(0);
  });
});

describe("feuille Plus : honnête, rien à acheter", () => {
  it("ce que Plus ajoute, prix prévu de §38.8, « Bientôt disponible » ; ni formulaire, ni champ, ni achat", () => {
    show(PaidSheet, { open: true, tier: "plus" });
    const s = text();
    for (const x of ["Shhdrop Plus", "10 Go par partage", "2 Go par partage", "50 Go par partage", "Durée jusqu'à 7 jours (gratuit : 24 h maximum)", "7 €", "70 €", "Bientôt disponible."])
      expect(s, x).toContain(x);
    expect(s).not.toMatch(/ouvertures \(gratuit/); // D41-36 : Plus garde les ouvertures du gratuit
    expect(s).not.toMatch(/élément/); // D41-17 : le nombre d'éléments n'est pas vendu
    expect([...document.querySelectorAll("button")].map((b) => b.textContent).join("|")).not.toMatch(/Acheter|Payer|S'abonner/i);
    expect(s).not.toMatch(/offre limitée|plus que/i);
    expect(document.querySelectorAll("form, input, a[href]")).toHaveLength(0);
  });
  it("Pro : 50 Go, 50 ouvertures, 20 € par mois et 200 € par an (2 mois offerts) ; mensuel par abonnement, annuel au choix ; carte et crypto-monnaies ; aucun frais caché", () => {
    show(PaidSheet, { open: true, tier: "pro" });
    const s = text();
    for (const x of ["Shhdrop Pro", "50 Go par partage", "Jusqu'à 50 ouvertures (gratuit : 10)", "20 € par mois, TTC", "ou 200 € par an", "2 mois offerts", "Au mois :", "abonnement renouvelé automatiquement chaque mois, résiliable en un clic, sans frais.", "À l'année, au choix :", "paiement unique (rien n'est prélevé ensuite) ou renouvellement automatique", "Moyens de paiement", "Carte bancaire", "Crypto-monnaies", "Aucun frais caché."]) expect(s.replace(/[\u202f\u00a0]/g, " "), x).toContain(x);
    expect(s).not.toContain("220");
    expect(s).not.toContain("payé en une fois");
    // Aucun logo de marque tierce : les moyens de paiement sont des libellés et des pictogrammes maison.
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(s).not.toMatch(/Visa|Mastercard|Bitcoin|Ethereum|PayPal/i);
  });
});

describe("dépassement de 2 Go : l'erreur seule, les espaces Plus et Pro sont à côté de la jauge (retours OPT)", () => {
  it("au-delà de 2 Go : « Trop gros », sans ligne « Avec Plus » en doublon", () => {
    show(CapacityGauge, { bytes: CONTENT_MAX + 1, count: 2, head: true });
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("Trop gros");
    expect(document.querySelector("[data-upsell]")).toBeNull();
  });
});

describe("pages d'erreur (FR, EN) : titre d'onglet, action claire", () => {
  const cases = [
    ["notfound", "Cette page n'existe pas.", "Page introuvable · Shhdrop", "This page does not exist."],
    ["offline", "Vous êtes hors ligne.", "Hors ligne · Shhdrop", "You are offline."],
    ["server", "Le serveur a un problème.", "Erreur du serveur · Shhdrop", "The server has a problem."],
    ["limit", "Trop de demandes rapprochées.", "Trop de demandes · Shhdrop", "Too many requests in a row."],
    ["unsupported", "Ce navigateur ne permet pas de chiffrer en sécurité.", "Navigateur non pris en charge · Shhdrop", "This browser cannot encrypt safely."],
    ["maintenance", "Shhdrop est en maintenance.", "Maintenance · Shhdrop", "Shhdrop is under maintenance."],
  ] as const;
  it.each(cases)("%s", (kind, fr, title, en) => {
    setLang("fr");
    setScreenTitle("open");
    const c = show(ErrorPage, { kind, onretry: () => undefined });
    expect(document.querySelector("h1")!.textContent).toBe(fr);
    expect(document.activeElement).toBe(document.querySelector("h1"));
    expect(document.title).toBe(title);
    setLang("en");
    flushSync();
    expect(document.querySelector("h1")!.textContent).toBe(en);
    void unmount(c);
    mounted.pop();
    expect(document.title).toBe("Open a share · Shhdrop"); // rendu à l'écran d'avant
  });
  it("429 : compte à rebours de Retry-After, « Réessayer » activé à zéro", () => {
    vi.useFakeTimers();
    const onretry = vi.fn();
    show(ErrorPage, { kind: "limit", retryAfterS: 3, onretry });
    const btn = () => [...document.querySelectorAll("button")].find((b) => b.textContent!.includes("Réessayer"))!;
    expect(text()).toContain("Vous pourrez réessayer dans 3 s.");
    expect(btn().disabled).toBe(true);
    vi.advanceTimersByTime(3100);
    flushSync();
    expect(text()).toContain("Vous pouvez réessayer.");
    expect(btn().disabled).toBe(false);
    btn().click();
    expect(onretry).toHaveBeenCalledTimes(1);
  });
  it("hors ligne : le retour du réseau relance d'office", () => {
    const onretry = vi.fn();
    show(ErrorPage, { kind: "offline", onretry });
    window.dispatchEvent(new Event("online"));
    expect(onretry).toHaveBeenCalledTimes(1);
  });
  it("introuvable : lien vers l'accueil ; navigateur non pris en charge : aucune action trompeuse", () => {
    show(ErrorPage, { kind: "notfound" });
    expect(document.querySelector("a")!.textContent).toBe("Retour à l'accueil");
    while (mounted.length) void unmount(mounted.pop()!);
    document.body.innerHTML = "";
    show(ErrorPage, { kind: "unsupported" });
    expect(document.querySelectorAll("a, button")).toHaveLength(0);
  });
});
