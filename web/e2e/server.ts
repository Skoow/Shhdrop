// Lance le vrai binaire `server/shhdrop serve` pour les tests d'intégration :
// dossier de données temporaire, port libre (SHH_LISTEN=127.0.0.1:0, lu sur stdout),
// stdout et stderr capturés en octets bruts (fouillés par le test « le serveur ne voit rien »).
import { spawn, type ChildProcess } from "node:child_process";
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

export async function startServer(): Promise<TestServer> {
  if (!existsSync(BINARY)) throw new Error(`binaire absent : ${BINARY} (lancer make test-e2e)`);
  const dataDir = mkdtempSync(join(tmpdir(), "shh-e2e-"));
  const proc: ChildProcess = spawn(BINARY, ["serve"], {
    env: { PATH: process.env.PATH ?? "", SHH_DATA_DIR: dataDir, SHH_LISTEN: "127.0.0.1:0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  proc.stderr!.on("data", (b: Buffer) => err.push(b));
  const exited = new Promise<void>((res) => proc.once("exit", () => res()));

  const addr = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("serveur : pas de SHH_LISTENING en 10 s")), 10_000);
    proc.stdout!.on("data", (b: Buffer) => {
      out.push(b);
      const m = /^SHH_LISTENING (\S+)\n/.exec(Buffer.concat(out).toString("utf8"));
      if (m) {
        clearTimeout(timer);
        resolve(m[1]!);
      }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`serveur arrêté (code ${code}) : ${Buffer.concat(err).toString("utf8")}`));
    });
  });

  const stop = async () => {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    proc.kill("SIGTERM");
    const t = setTimeout(() => proc.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(t);
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
