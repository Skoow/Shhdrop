// Client de transfert : création, ouverture, destruction et suivi d'un partage
// (spec §7.4 à §7.6). Tout le chiffrement a lieu ici ; le serveur ne reçoit que des
// empreintes (V_accès, V_preuve, V_gestion), K_accès, K_preuve ou S_gestion, et des
// segments chiffrés. K_lien, le mot de passe, les noms et le contenu ne sortent jamais.
import { BUCKETS, open, seal, segmentCount, segmentSize, type Item, type Manifest } from "../crypto/container";
import { b64u, unb64u } from "../crypto/encoding";
import { checkKdfParams, deriveAccess, deriveContent, KDF_MIN, randomBytes, sha256 } from "../crypto/kdf";
import { checkPassword } from "../crypto/passphrase";
import * as api from "./api";
import { manageLink, parseLink, shareLink, type ParsedLink } from "./link";

export type { Net } from "./api";

/** Paramètres Argon2id des nouveaux partages (spec §7.1 : 64 Mio, 3 passes). */
export const KDF_CREATE = { ops: KDF_MIN.ops, mem: KDF_MIN.mem } as const;

/**
 * Délai minimal entre la réception du défi anti-robot et la création : le serveur refuse
 * une création moins de 3 s après l'émission du défi (heure signée « shown_at »). 100 ms
 * de marge couvrent l'arrondi à la seconde côté serveur.
 */
export const CAPTCHA_MIN_MS = 3100;

export class NotFoundError extends Error {
  constructor() {
    super("introuvable");
    this.name = "NotFoundError";
  }
}

export class BadPasswordError extends Error {
  constructor(readonly attemptsLeft: number) {
    super("mauvais_mot_de_passe");
    this.name = "BadPasswordError";
  }
}

// 404 (inexistant, expiré, détruit, mauvaise clé d'accès : réponse uniforme) → NotFoundError ;
// 403 bad_password → BadPasswordError ; autres erreurs HTTP → Error(code du serveur).
function translate(e: unknown): unknown {
  if (e instanceof api.HttpError) {
    if (e.status === 404) return new NotFoundError();
    if (e.status === 403 && e.code === "bad_password" && e.attemptsLeft !== undefined) return new BadPasswordError(e.attemptsLeft);
    return new Error(e.code);
  }
  return e;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw translate(e);
  }
}

function parseKind(link: string, kind: "s" | "m"): ParsedLink & { origin: string } {
  const p = parseLink(link);
  if (p.kind !== kind) throw new Error("lien_invalide");
  return { ...p, origin: new URL(link).origin };
}

export type CreateOpts = api.Net & {
  ttlHours: 1 | 6 | 12 | 24;
  maxOpens: number;
  password: string;
  /** Résout le défi ALTCHA (objet renvoyé par GET /api/captcha, sans shown_at) ; rend la charge utile base64. */
  solveCaptcha: (c: unknown) => Promise<string>;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Crée un partage. Clés neuves à chaque appel (K_lien, sel, S_gestion) ; le paquet est
 * scellé une seule fois, et seuls ses segments déjà chiffrés sont renvoyés en cas de
 * nouvel essai. Ordre : scellement, puis défi anti-robot (valable 2 min), puis création,
 * au plus tôt CAPTCHA_MIN_MS après la réception du défi — createShare attend lui-même
 * le temps restant (l'écran du Plan 2 peut s'y fier). En cas d'échec après la création,
 * l'envoi est détruit (au mieux) pour libérer la place réservée.
 */
export async function createShare(
  origin: string,
  items: Item[],
  o: CreateOpts,
): Promise<{ link: string; manage: string; expiresInS: number }> {
  if (![1, 6, 12, 24].includes(o.ttlHours)) throw new Error("duree_invalide");
  if (!Number.isInteger(o.maxOpens) || o.maxOpens < 1 || o.maxOpens > 10) throw new Error("ouvertures_invalides");
  const pw = checkPassword(o.password);
  if (!pw.ok) throw new Error(`mot_de_passe_${pw.reason}`);
  const c = api.ctx(origin, o);

  const kLien = randomBytes(32);
  const salt = randomBytes(16);
  const sGestion = randomBytes(32);
  const { vAcces } = await deriveAccess(kLien);
  const keys = await deriveContent(kLien, o.password, salt, KDF_CREATE);
  const { bucket, segments } = await seal(items, keys);
  const vPreuve = keys.vPreuve;
  keys.kPreuve.fill(0); // inutile à l'expéditeur

  const cap = await call(api.captcha(c));
  const shownAt = Date.now();
  const altcha = await o.solveCaptcha(cap.challenge);
  const wait = shownAt + CAPTCHA_MIN_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  const created = await call(
    api.create(c, {
      bucket,
      ttl_hours: o.ttlHours,
      max_opens: o.maxOpens,
      salt: b64u(salt),
      kdf: { ...KDF_CREATE },
      access_v: b64u(vAcces),
      proof_v: b64u(vPreuve),
      manage_v: b64u(await sha256(sGestion)),
      altcha,
      hp: "",
      shown_at: cap.shownAt,
    }),
  );
  try {
    if (created.segments !== segments.length) throw new Error("reponse_invalide");
    o.onProgress?.(0, segments.length);
    for (let n = 0; n < segments.length; n++) {
      await call(api.putSegment(c, created.id, created.uploadToken, n, segments[n]!));
      o.onProgress?.(n + 1, segments.length);
    }
    const expiresInS = await call(api.finalize(c, created.id, created.uploadToken));
    return { link: shareLink(origin, created.id, kLien), manage: manageLink(origin, created.id, sGestion), expiresInS };
  } catch (e) {
    await api.destroy(c, created.id, { sGestion }).catch(() => undefined);
    throw e;
  } finally {
    kLien.fill(0);
    sGestion.fill(0);
  }
}

export async function fetchMeta(link: string, net?: api.Net): Promise<{ expiresInS: number }> {
  const p = parseKind(link, "s");
  const { kAcces } = await deriveAccess(p.secret);
  const m = await call(api.meta(api.ctx(p.origin, net), p.id, kAcces));
  return { expiresInS: m.expiresInS };
}

// Dérive les clés de contenu à partir de meta, en refusant tout paramètre douteux du serveur.
async function contentKeys(p: ParsedLink, m: api.Meta, password: string) {
  if (!(BUCKETS as readonly number[]).includes(m.bucket) || m.segments !== segmentCount(m.bucket)) {
    throw new Error("reponse_invalide");
  }
  checkKdfParams(m.kdf); // le minimum est imposé par le navigateur, pas par le serveur
  let salt: Uint8Array;
  try {
    salt = unb64u(m.salt);
  } catch {
    throw new Error("reponse_invalide");
  }
  if (salt.length !== 16) throw new Error("reponse_invalide");
  return deriveContent(p.secret, password, salt, m.kdf);
}

export type Opened = { manifest: Manifest; item(i: number): Uint8Array; done(): Promise<void> };

/**
 * Ouvre un partage : meta → clés → unlock (consomme une ouverture) → segments → open().
 * Mauvais mot de passe → BadPasswordError (essais restants) ; inexistant, expiré, détruit
 * ou plus d'ouverture → NotFoundError. Après lecture, appeler done() (fin du téléchargement,
 * qui permet l'effacement). En cas d'échec après unlock, done() est appelé d'office.
 */
export async function openShare(
  link: string,
  password: string,
  onProgress?: (d: number, t: number) => void,
  net?: api.Net,
): Promise<Opened> {
  const p = parseKind(link, "s");
  const c = api.ctx(p.origin, net);
  const { kAcces } = await deriveAccess(p.secret);
  const m = await call(api.meta(c, p.id, kAcces));
  const keys = await contentKeys(p, m, password);
  const u = await call(api.unlock(c, p.id, kAcces, keys.kPreuve));
  keys.kPreuve.fill(0);

  let finished = false;
  const done = async () => {
    if (finished) return;
    finished = true;
    try {
      await api.done(c, p.id, u.downloadToken);
    } catch (e) {
      // 404 : partage déjà effacé (expiré ou détruit) ; le contenu est déjà lu.
      if (!(e instanceof api.HttpError && e.status === 404)) throw translate(e);
    }
  };
  try {
    if (u.segments !== m.segments) throw new Error("reponse_invalide");
    const segs: Uint8Array[] = [];
    onProgress?.(0, m.segments);
    for (let n = 0; n < m.segments; n++) {
      segs.push(await call(api.getSegment(c, p.id, u.downloadToken, n, segmentSize(m.bucket, n))));
      onProgress?.(n + 1, m.segments);
    }
    const o = await open(segs, keys);
    return { manifest: o.manifest, item: (i) => o.item(i), done };
  } catch (e) {
    await done().catch(() => undefined);
    throw e;
  }
}

/**
 * Détruit un partage : avec le lien de partage et le mot de passe (K_accès + K_preuve ;
 * un mauvais mot de passe compte un essai et rend NotFoundError), ou avec le lien de
 * gestion (S_gestion seul).
 */
export async function destroyShare(link: string, opts: { password?: string } & api.Net): Promise<void> {
  const p = parseLink(link);
  const c = api.ctx(new URL(link).origin, opts);
  if (p.kind === "m") {
    await call(api.destroy(c, p.id, { sGestion: p.secret }));
    return;
  }
  if (opts.password === undefined) throw new Error("mot_de_passe_requis");
  const { kAcces } = await deriveAccess(p.secret);
  const m = await call(api.meta(c, p.id, kAcces));
  const keys = await contentKeys(p, m, opts.password);
  try {
    await call(api.destroy(c, p.id, { kAcces, kPreuve: keys.kPreuve }));
  } finally {
    keys.kPreuve.fill(0);
  }
}

export async function shareStatus(
  manage: string,
  net?: api.Net,
): Promise<{ opensUsed: number; maxOpens: number; expiresInS: number; state: string }> {
  const p = parseKind(manage, "m");
  return call(api.status(api.ctx(p.origin, net), p.id, p.secret));
}
