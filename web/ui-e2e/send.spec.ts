// Envoi (UI §9.4) sur le vrai serveur : phases dans l'ordre, coches d'étape seulement après un
// progrès réel (M3), lien jamais avant finalize, pause, coupure, annulation, fermeture de page,
// double clic, erreurs, petits écrans. Captures fr-FR à 1440 × 900 et 390 × 844.
import type { Page, Request } from "@playwright/test";
import { NotFoundError, shareStatus } from "../src/index";
import { capture, expect, test } from "./fixtures";
import { addFile, addRealFile, addText, armed, noHScroll, readyHeading, sendButton, sleep } from "./send-helpers";

const SEG = /\/api\/shares\/segments\/\d+(\?from=\d+)?$/; // plage de morceaux : ?from (audit H-2)
const MIB = 1048576;

const stepItem = (page: Page, name: string) => page.getByRole("list", { name: "Étapes confirmées" }).getByRole("listitem").filter({ hasText: name });


/** Lien de gestion déduit de l'en-tête X-Shh-Manage de la création (S_gestion), pour vérifier en Node. */
function manageFrom(page: Page, origin: string): { link: () => string | undefined; creates: () => number } {
  let link: string | undefined;
  let n = 0;
  page.on("request", (r: Request) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/shares") {
      n++;
      const m = r.headers()["x-shh-manage"];
      if (m) link = `${origin}/#m${m}`;
    }
  });
  return { link: () => link, creates: () => n };
}

async function gone(manage: string, origin: string): Promise<boolean> {
  try {
    await shareStatus(manage, origin);
    return false;
  } catch (e) {
    return e instanceof NotFoundError;
  }
}

/** Retarde chaque PUT de segment de `ms` (l'envoi local serait sinon instantané). */
async function slowSegments(page: Page, ms: number, puts: string[] = [], fast = 0) {
  await page.route(SEG, async (route) => {
    puts.push(route.request().url());
    if (puts.length > fast) await sleep(ms);
    await route.continue().catch(() => undefined);
  });
  return puts;
}

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

  test("texte + photo : phases dans l'ordre, coches honnêtes, lien jamais avant finalize, capsule nommée", async ({ page, shh }) => {
    test.setTimeout(120_000);
    await page.goto(shh.origin + "/");
    await addText(page, "Le code de la porte est 4471.");
    await addRealFile(page, "plage-nuit.jpg");
    await addFile(page, "archive-photos.bin", 3 * MIB);
    // Chaque PUT retardé de 2 s, puis finalize retardé de 2 s.
    await slowSegments(page, 2000, [], 1);
    let finalizing = false;
    await page.route("**/api/shares/finalize", async (route) => {
      finalizing = true;
      await sleep(2500);
      await route.continue();
    });
    const titles: string[] = [];
    await page.exposeFunction("__phase", (s: string) => titles.push(s));
    await sendButton(page).click();
    await page.evaluate(() => {
      const seen = new Set<string>();
      const w = window as unknown as { __capBad: number; __capSeen: number };
      w.__capBad = 0;
      w.__capSeen = 0;
      const look = () => {
        // La légende « ce que le serveur reçoit » ne se pose jamais sur un nom lisible (scan UX).
        if (document.querySelector("[data-capsule] .veil-cap")) {
          w.__capSeen++;
          const shown = [...document.querySelectorAll("[data-capsule] .names .nm")].map((e) => e.textContent ?? "").join("|");
          if (/plage-nuit|archive-photos|Le code/.test(shown)) w.__capBad++;
        }
        const h = document.querySelector("#seal-title")?.textContent ?? "";
        if (h && !seen.has(h)) {
          seen.add(h);
          (window as unknown as { __phase(s: string): void }).__phase(h);
        }
      };
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
      look();
    });
    const capsule = page.locator("[data-capsule]").first();
    await expect(capsule).toBeVisible();
    expect(await capsule.evaluate((e) => getComputedStyle(e).viewTransitionName)).toBe("capsule");

    // Envoi en cours : aucune coche « Envoyé » avant l'accusé du dernier segment.
    await expect(page.getByRole("heading", { name: "Chiffrement et envoi" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^Bloc \d \/ 3$/)).toBeVisible({ timeout: 30_000 }); // la note est un élément (D41-37)
    await expect(stepItem(page, "Envoyé")).toHaveCount(0);
    await expect(page.locator(".stats")).toHaveCSS("font-variant-numeric", "tabular-nums");
    await page.waitForTimeout(300);
    await capture(page, "seal-progress");
    await expect(page.locator(".sealing")).not.toContainText("palier");

    // Finalisation retardée : « Envoyé » est là, « Scellé » non ; aucun lien nulle part.
    await expect.poll(() => finalizing, { timeout: 30_000 }).toBe(true);
    await expect(page.getByRole("heading", { name: "Finalisation" })).toBeVisible();
    await expect(stepItem(page, "Chiffré sur cet appareil")).toHaveCount(1);
    await expect(stepItem(page, "Envoyé")).toHaveCount(1);
    await expect(stepItem(page, "Scellé")).toHaveCount(0);
    await expect(page.getByText("Finalisation : l'envoi ne peut plus être annulé", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Annuler" })).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe("");
    expect(await page.evaluate(() => document.body.innerText.includes("/#"))).toBe(false);
    await expect(readyHeading(page)).toHaveCount(0);

    await expect(readyHeading(page)).toBeVisible({ timeout: 30_000 });
    expect(await page.locator("[data-capsule]").first().evaluate((e) => getComputedStyle(e).viewTransitionName)).toBe("capsule");
    // Ordre réel des phases affichées (sans en sauter, sans revenir en arrière).
    const order = ["Préparation des clés", "Vérification anti-robot", "Chiffrement et envoi", "Finalisation", "Scellé"];
    const idx = titles.filter((x) => order.includes(x)).map((x) => order.indexOf(x));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(idx.at(-1)).toBe(4);
    expect(idx).toContain(2);
    expect(idx).toContain(3);
    const cap = await page.evaluate(() => {
      const w = window as unknown as { __capBad: number; __capSeen: number };
      return { bad: w.__capBad, seen: w.__capSeen };
    });
    expect(cap.bad).toBe(0);
    expect(cap.seen).toBeGreaterThan(0);
  });

  test("Pause : plus aucun PUT pendant 5 s, Reprendre, succès ; M12 : Pause et Annuler à chaque phase", async ({ page, shh }) => {
    test.setTimeout(120_000);
    await page.goto(shh.origin + "/");
    await addFile(page, "video.bin", 14 * MIB);
    const puts = await slowSegments(page, 900);
    await sendButton(page).click();
    // Avant la création : Annuler seulement.
    await expect(page.getByRole("button", { name: "Annuler" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chiffrement et envoi" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Annuler" })).toBeVisible();
    const pause = page.getByRole("button", { name: "Pause" });
    await expect(pause).toBeEnabled();
    await pause.click();
    await expect(page.getByRole("heading", { name: "En pause" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^En pause · reprise automatique dans \d+:\d\d$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Annuler" })).toBeVisible();
    await capture(page, "seal-paused");
    const before = puts.length;
    await page.waitForTimeout(5000);
    expect(puts.length).toBe(before);
    await page.getByRole("button", { name: "Reprendre" }).click();
    await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
    expect(puts.length).toBeGreaterThan(before);
  });

  test("coupure de 60 s pendant l'envoi : bandeau avec compte à rebours, puis succès", async ({ page, shh, context }) => {
    test.setTimeout(180_000);
    await page.goto(shh.origin + "/");
    await addFile(page, "gros.bin", 20 * MIB);
    let cut = false;
    await page.route(SEG, async (route) => {
      if (!cut && /\/segments\/[1-9]\d*$/.test(route.request().url())) {
        cut = true;
        await context.setOffline(true);
        await route.abort("internetdisconnected");
        return;
      }
      await route.continue().catch(() => route.abort().catch(() => undefined));
    });
    await sendButton(page).click();
    const banner = page.getByRole("status").filter({ hasText: /Connexion perdue|Hors ligne/ });
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/L'envoi est conservé encore \d+\smin sans connexion\./)).toBeVisible();
    await expect(stepItem(page, "Envoyé")).toHaveCount(0);
    await capture(page, "seal-offline");
    await page.waitForTimeout(60_000);
    await context.setOffline(false);
    await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
  });

  test("Annuler au milieu : composeur intact, avis, partage effacé côté serveur", async ({ page, shh }) => {
    test.setTimeout(120_000);
    // Écoute posée AVANT tout ajout : l'envoi démarre dès l'ajout (§41.14), la création du
    // partage peut donc partir avant « Chiffrer et envoyer » (test instable sinon).
    const m = manageFrom(page, shh.origin);
    await page.goto(shh.origin + "/");
    await addText(page, "Texte à garder");
    await addFile(page, "doc.bin", 10 * MIB);
    await slowSegments(page, 1500);
    await sendButton(page).click();
    await expect(page.getByRole("heading", { name: "Chiffrement et envoi" })).toBeVisible({ timeout: 30_000 });
    // S9 : pendant l'envoi, Ctrl/Cmd + V (fichier ou texte) n'ajoute rien au composeur caché.
    await page.evaluate(() => {
      const f = new DataTransfer();
      f.items.add(new File(["x"], "colle.txt", { type: "text/plain" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: f, bubbles: true, cancelable: true }));
      const t = new DataTransfer();
      t.setData("text/plain", "collé pendant l'envoi");
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: t, bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole("dialog", { name: "Nouveau texte" })).toHaveCount(0);
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
    await expect(page.getByText("Annuler l'envoi ? Le lien ne sera pas créé ; vos éléments restent dans la liste.")).toBeVisible();
    await page.getByRole("button", { name: "Annuler l'envoi" }).click();
    await expect(page.locator(".note").getByText("Envoi annulé. Vos éléments restent dans la liste, déjà envoyés ; videz-la pour les effacer du serveur.")).toBeVisible();
    await expect(page.locator("[data-row]")).toHaveCount(2);
    await expect(sendButton(page)).toBeVisible();
    await expect(page.getByRole("list", { name: "Étapes confirmées" })).toHaveCount(0);
    expect(m.link()).toBeDefined();
    // Spec §41.14 : le brouillon reste (les éléments sont toujours là) ; vider la liste l'efface.
    expect(await gone(m.link()!, shh.origin)).toBe(false);
    for (const name of ["doc.bin", "Note"]) {
      const direct = page.getByRole("button", { name: new RegExp(`^Supprimer ${name}`) }).first();
      if (await direct.isVisible()) await direct.click();
      else {
        await page.getByRole("button", { name: new RegExp(`^Actions pour ${name}`) }).first().click();
        await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
      }
    }
    await expect.poll(() => gone(m.link()!, shh.origin), { timeout: 15_000 }).toBe(true);
  });

  test("pagehide au milieu (fermeture de la page) : partage effacé côté serveur (destroy keepalive)", async ({ page, shh }) => {
    test.setTimeout(120_000);
    // Écoute posée AVANT tout ajout : l'envoi démarre dès l'ajout (§41.14), la création du
    // partage peut donc partir avant « Chiffrer et envoyer » (test instable sinon).
    const m = manageFrom(page, shh.origin);
    await page.goto(shh.origin + "/");
    await addFile(page, "doc.bin", 10 * MIB);
    // Premier segment libre, les suivants retenus : l'envoi reste au milieu. (La page n'est pas
    // fermée pendant l'interception : seul l'événement pagehide est envoyé, voir plus bas.)
    await slowSegments(page, 60_000, [], 1);
    await sendButton(page).click();
    await expect(page.getByText(/^Bloc \d+ \/ \d+$/)).toBeVisible({ timeout: 30_000 });
    expect(await armed(page)).toBe(true);
    expect(m.link()).toBeDefined();
    // Événement `pagehide` (celui que le navigateur envoie à la fermeture) : l'envoi est annulé et
    // la destruction part en keepalive. Une vraie fermeture (page.close) est trop aléatoire dans
    // Chromium sans interface pour un test stable : le processus de rendu peut être tué avant.
    const destroyed = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/manage/destroy", { timeout: 10_000 });
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
    expect((await destroyed).method()).toBe("POST");
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.close({ runBeforeUnload: false });
    await expect.poll(() => gone(m.link()!, shh.origin), { timeout: 15_000 }).toBe(true);
  });

  test("double clic : une seule création", async ({ page, shh }) => {
    test.setTimeout(90_000);
    // Écoute posée AVANT tout ajout : l'envoi démarre dès l'ajout (§41.14), la création du
    // partage peut donc partir avant « Chiffrer et envoyer » (test instable sinon).
    const m = manageFrom(page, shh.origin);
    await page.goto(shh.origin + "/");
    await addText(page, "double");
    await sendButton(page).dblclick();
    await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
    expect(m.creates()).toBe(1);
  });

  test("double clic pendant le changement d'écran animé : une seule finalisation", async ({ page, shh }) => {
    test.setTimeout(90_000);
    // WebKit met l'écran à jour plus tard (View Transitions) : le second clic arrivait encore sur
    // le composeur et lançait une seconde finalisation, refusée (404) → « transfert interrompu ».
    // Reproduit partout : transition factice dont la mise à jour de l'écran n'arrive qu'après
    // 300 ms (WebKit n'appelle le rappel qu'après avoir peint l'état d'avant), sans calque qui
    // capterait le second clic.
    await page.addInitScript(() => {
      (document as Document & { startViewTransition: unknown }).startViewTransition = (cb: () => void) => {
        const done = new Promise<void>((ok) => setTimeout(() => (cb(), ok()), 300));
        return { finished: done, updateCallbackDone: done, ready: done, skipTransition() {} };
      };
    });
    let finalizes = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/api/shares/finalize") finalizes++;
    });
    await page.goto(shh.origin + "/");
    await addText(page, "double");
    await sendButton(page).dblclick();
    await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
    expect(finalizes).toBe(1);
  });

  test("partage disparu pendant l'envoi (404 aux PUT) → « Le transfert a été interrompu »", async ({ page, shh }) => {
    test.setTimeout(90_000);
    await page.goto(shh.origin + "/");
    // Un fichier (un texte seul ne fait aucun PUT, spec §41.14) ; 404 dès l'envoi anticipé.
    await page.route(SEG, (route) => route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not_found"}' }));
    await addFile(page, "disparu.bin", 1000);
    await sendButton(page).click();
    const alert = page.getByRole("alert");
    await expect(alert).toHaveText("Le transfert a été interrompu (le serveur a peut-être redémarré). Réessayez.", { timeout: 30_000 });
    await expect(alert).toBeFocused();
    await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
    await page.getByRole("button", { name: "Modifier l'envoi" }).click();
    await expect(page.locator("[data-row]")).toHaveCount(1);
  });

  test("Worker absent, sans repli : vérification impossible sur cet appareil + Réessayer", async ({ page, shh }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      // @ts-expect-error retrait volontaire
      delete window.Worker;
    });
    await page.goto(shh.origin + "/");
    await addText(page, "sans worker");
    await sendButton(page).click();
    await expect(page.getByRole("alert")).toHaveText(
      "La vérification anti-robot n'a pas pu se faire sur cet appareil. Réessayez, ou essayez depuis un autre navigateur.",
      { timeout: 30_000 },
    );
    await expect(page.getByRole("button", { name: "Réessayer" })).toBeEnabled();
  });

  test("limite d'envois (429) : Réessayer désactivé avec compte à rebours", async ({ page, shh }) => {
    test.setTimeout(60_000);
    await page.goto(shh.origin + "/");
    await addText(page, "limite");
    await page.route("**/api/shares", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 429, contentType: "application/json", body: '{"error":"rate_limited","retry_after_s":120}' })
        : route.continue(),
    );
    await sendButton(page).click();
    await expect(page.getByRole("alert")).toHaveText(/^Limite d'envois atteinte\. Réessayez dans 2\smin\.$/, { timeout: 30_000 });
    const retry = page.getByRole("button", { name: /^Réessayer dans \d/ });
    await expect(retry).toBeDisabled();
  });

  for (const [w, h] of [
    [320, 640],
    [844, 390],
  ] as const) {
    test(`envoi puis Lien prêt à ${w} × ${h} : aucun débordement horizontal`, async ({ page, shh }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: w, height: h });
      await page.goto(shh.origin + "/");
      await addText(page, "petit écran");
      await addFile(page, "un-nom-de-fichier-vraiment-tres-long-pour-voir.bin", 2 * MIB);
      await slowSegments(page, 1500);
      await sendButton(page).click();
      await expect(page.getByRole("heading", { name: "Chiffrement et envoi" })).toBeVisible({ timeout: 30_000 });
      expect(await noHScroll(page)).toBe(true);
      await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
      expect(await noHScroll(page)).toBe(true);
    });
  }

  test("mouvement réduit : sceau fermé sans animation (capture seal-sealed)", async ({ page, shh }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(shh.origin + "/");
    await addText(page, "réduit");
    await page.route("**/api/shares/finalize", async (route) => {
      await sleep(1500);
      await route.continue();
    });
    await sendButton(page).click();
    await expect(page.getByRole("heading", { name: "Finalisation" })).toBeVisible({ timeout: 30_000 });
    await expect(readyHeading(page)).toBeVisible({ timeout: 30_000 });
    await capture(page, "seal-sealed");
    // Fondu d'écran bref et transitions finies autorisés en mouvement réduit : on les laisse finir ;
    // aucune animation (sceau compris) ne doit encore tourner ensuite.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)).toBe(0);
  });
});

test.describe("captures 390", () => {
  test.use({ locale: "fr-FR", viewport: { width: 390, height: 844 } });

  test("scellement en cours à 390 × 844", async ({ page, shh }) => {
    test.setTimeout(90_000);
    await slowSegments(page, 8000, [], 1);
    await page.goto(shh.origin + "/");
    await addText(page, "Le code de la porte est 4471.");
    await addRealFile(page, "toits-belleville.jpg");
    await addRealFile(page, "anniversaire-lou.webm");
    await addFile(page, "releve-annuel.bin", 9 * MIB);
    await sendButton(page).click();
    // Note, photo, vidéo : un segment chacune ; relevé : 3 (spec §41.14, D41-37).
    await expect(page.getByText(/^Bloc \d \/ 6$/)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await capture(page, "seal-progress-390");
    expect(await noHScroll(page)).toBe(true);
  });
});

