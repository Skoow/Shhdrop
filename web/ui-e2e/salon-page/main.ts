// Page d'essai du module WebAssembly du salon (Task 9), pour ui-e2e/salon-moteur.spec.ts
// seulement : jamais livrée (construite par global-setup.ts dans ui-e2e/salon-page/dist, hors de
// web/dist). Le site n'appelle pas encore le salon ; cette page charge le module par le chemin du
// site tel quel (src/salon/engine.ts, source remplacée par le greffon shh-salon : fichier
// assets/salon-EMPREINTE.wasm lu par fetch avec `integrity`). Le test pilote le module par
// page.evaluate (window.shhSalon).
import { loadSalonEngine } from "../../src/salon/engine";

(window as unknown as { shhSalon: typeof loadSalonEngine }).shhSalon = loadSalonEngine;
document.querySelector("#out")!.textContent = "prêt";
