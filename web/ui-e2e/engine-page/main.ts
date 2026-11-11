// Page d'essai du chargement vérifié du moteur (spec moteur §7, Task 10), pour
// ui-e2e/hygiene.spec.ts seulement : jamais livrée (construite par global-setup.ts dans
// ui-e2e/engine-page/dist*, hors de web/dist). Le site n'appelle pas encore le moteur (Task 11) ;
// cette page appelle les modules du site tels quels (load.ts, argon2.ts, sources remplacées par
// le greffon shh-engine), sans code propre aux tests dans le build de production.
// Un clic : loadEngine(), puis K_mdp du vecteur « mot de passe généré » (engine/vectors/v2.json).
import { passwordKeyForCreate } from "../../src/engine/argon2";
import { loadEngine } from "../../src/engine/load";

const out = document.querySelector("#out")!;
document.querySelector("#kdf")!.addEventListener("click", async () => {
  out.textContent = "…";
  try {
    const engine = await loadEngine();
    const salt = Uint8Array.from({ length: 16 }, (_, i) => 16 + i);
    const k = await passwordKeyForCreate(engine, "aC3!cD5?#Fg", salt);
    out.textContent = "cle " + [...k].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    out.textContent = "erreur " + (e instanceof Error ? e.message : "?");
  }
});
