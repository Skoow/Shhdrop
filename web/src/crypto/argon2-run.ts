// Exécution d'Argon2id : ici, dans la page (tests, développement, démo). Le build de
// production remplace ce module par argon2-run.worker.ts (greffon shh-argon2, vite.config.ts).
export { argon2id as runArgon2id } from "./argon2";
