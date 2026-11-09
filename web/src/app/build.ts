// Version du site affichée dans le pied de page : hash court du commit injecté au build
// (vite.config.ts, buildId) ; « dev » hors build. Aucune donnée secrète.
export const BUILD_ID: string = typeof __SHH_BUILD__ === "string" && /^([0-9a-f]{7}|dev)$/.test(__SHH_BUILD__) ? __SHH_BUILD__ : "dev";
