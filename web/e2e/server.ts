// Lance le vrai binaire `server/shhdrop serve` pour les tests d'intégration :
// dossier de données temporaire, port libre (SHH_LISTEN=127.0.0.1:0, lu sur stdout),
// stdout et stderr capturés en octets bruts (fouillés par le test « le serveur ne voit rien »).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const BINARY = fileURLToPath(new URL("../../server/shhdrop", import.meta.url));

export type TestServer = {
  origin: string;
  pid: number;
  dataDir: string;
  stdout(): Buffer;
  stderr(): Buffer;
  /** Arrête le processus (SIGTERM, puis SIGKILL après 5 s) ; garde le dossier de données. */
  stop(): Promise<void>;
  /** stop() puis suppression du dossier de données. */
  dispose(): Promise<void>;
};

/** Échec de démarrage : le processus a été tué et son dossier supprimé. */
export class ServerStartError extends Error {
  constructor(
    msg: string,
    readonly dataDir: string,
    readonly stdout: Buffer,
    readonly stderr: Buffer,
  ) {
    super(msg);
  }
}

export type StartOpts = {
  /** Variables ajoutées ou remplacées (une valeur undefined retire la variable). */
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
};

export async function startServer(opts: StartOpts = {}): Promise<TestServer> {
  if (!existsSync(BINARY)) throw new Error(`binaire absent : ${BINARY} (lancer make test-e2e)`);
  const dataDir = mkdtempSync(join(tmpdir(), "shh-e2e-"));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ PATH: process.env.PATH ?? "", SHH_DATA_DIR: dataDir, SHH_LISTEN: "127.0.0.1:0", ...opts.env })) {
    if (v !== undefined) env[k] = v;
  }
  const proc = spawn(BINARY, ["serve"], { env, stdio: ["ignore", "pipe", "pipe"] });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  proc.stdout.on("data", (b: Buffer) => out.push(b));
  proc.stderr.on("data", (b: Buffer) => err.push(b));
  // « close » : processus terminé ET flux stdout/stderr entièrement lus.
  const closed = new Promise<void>((res) => proc.once("close", () => res()));
  const alive = () => proc.exitCode === null && proc.signalCode === null;

  let addr: string;
  try {
    addr = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("pas de SHH_LISTENING à temps")), opts.timeoutMs ?? 10_000);
      proc.stdout.on("data", () => {
        const m = /^SHH_LISTENING (\S+)\n/.exec(Buffer.concat(out).toString("utf8"));
        if (m) {
          clearTimeout(timer);
          resolve(m[1]!);
        }
      });
      proc.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`serveur arrêté avant l'écoute (code ${code})`));
      });
    });
  } catch (e) {
    if (alive()) proc.kill("SIGKILL");
    await closed;
    rmSync(dataDir, { recursive: true, force: true });
    const stderr = Buffer.concat(err);
    throw new ServerStartError(`${(e as Error).message} : ${stderr.toString("utf8")}`, dataDir, Buffer.concat(out), stderr);
  }

  const stop = async () => {
    if (alive()) {
      proc.kill("SIGTERM");
      const t = setTimeout(() => proc.kill("SIGKILL"), 5_000);
      await closed;
      clearTimeout(t);
    }
    await closed;
  };
  return {
    origin: `http://${addr}`,
    pid: proc.pid!,
    dataDir,
    stdout: () => Buffer.concat(out),
    stderr: () => Buffer.concat(err),
    stop,
    async dispose() {
      await stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
