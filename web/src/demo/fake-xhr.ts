// XMLHttpRequest de la démo (UI §14.3) : les requêtes /api/* de l'origine (en pratique les PUT
// de segment, envoyés par XHR pour suivre les octets, §0.1) vont au faux serveur ; toute autre
// requête est une vraie XMLHttpRequest. upload.onprogress suit le débit simulé ; abort() annule.
export const MARK = "__SHH_DEMO__";

type Handle = (req: Request) => Promise<Response>;

/** Pas des événements de progression (ms). */
const TICK_MS = 100;

/**
 * Classe à installer à la place de `XMLHttpRequest`. `isApi(url)` : l'URL va au faux serveur.
 * `rateBytesPerS` : même débit que le faux serveur, pour les événements de progression.
 */
export function fakeXHRClass(Original: typeof XMLHttpRequest, isApi: (u: URL) => boolean, handle: Handle, rateBytesPerS: number) {
  return class DemoXHR extends Original {
    readonly [MARK] = true;
    #fake: { method: string; url: string; headers: Headers } | null = null;
    #state = 0;
    #status = 0;
    #text = "";
    #ac: AbortController | null = null;
    #timer: ReturnType<typeof setInterval> | undefined;

    override open(method: string, url: string | URL, ...rest: unknown[]): void {
      // L'original vérifie la méthode et l'URL (et n'envoie rien avant send).
      (super.open as (...a: unknown[]) => void)(method, url, ...rest);
      const u = new URL(String(url), location.href);
      this.#fake = isApi(u) ? { method: method.toUpperCase(), url: u.href, headers: new Headers() } : null;
      this.#state = 1;
      this.#status = 0;
      this.#text = "";
    }

    override setRequestHeader(name: string, value: string): void {
      super.setRequestHeader(name, value);
      this.#fake?.headers.append(name, value);
    }

    override get readyState(): number {
      return this.#fake ? this.#state : super.readyState;
    }
    override get status(): number {
      return this.#fake ? this.#status : super.status;
    }
    override get responseText(): string {
      return this.#fake ? this.#text : super.responseText;
    }
    override get response(): unknown {
      return this.#fake ? this.#text : super.response;
    }
    override get responseURL(): string {
      return this.#fake ? (this.#state === 4 ? this.#fake.url : "") : super.responseURL;
    }

    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      const f = this.#fake;
      if (f === null) return super.send(body);
      if (this.#ac !== null) throw new DOMException("send() déjà appelé", "InvalidStateError");
      const ac = (this.#ac = new AbortController());
      const bytes = body instanceof Uint8Array ? body.length : body instanceof Blob ? body.size : 0;
      const total = bytes;
      const start = performance.now();
      const progress = (loaded: number) =>
        this.upload.dispatchEvent(new ProgressEvent("progress", { lengthComputable: true, loaded, total }));
      if (total > 0) {
        this.upload.dispatchEvent(new ProgressEvent("loadstart", { lengthComputable: true, loaded: 0, total }));
        this.#timer = setInterval(() => {
          // Plafonné sous le total : 100 % seulement à la réponse.
          progress(Math.min(total - 1, Math.floor(((performance.now() - start) / 1000) * rateBytesPerS)));
        }, TICK_MS);
      }
      const init: RequestInit = { method: f.method, headers: f.headers, signal: ac.signal };
      if (body !== undefined && body !== null && f.method !== "GET" && f.method !== "HEAD") init.body = body as BodyInit;
      void (async () => {
        let res: Response;
        let text: string;
        try {
          res = await handle(new Request(f.url, init));
          text = await res.text();
        } catch {
          if (ac.signal.aborted) return;
          this.#finish(0, "");
          this.dispatchEvent(new ProgressEvent("error"));
          this.dispatchEvent(new ProgressEvent("loadend"));
          return;
        }
        if (ac.signal.aborted) return;
        if (total > 0) {
          progress(total);
          this.upload.dispatchEvent(new ProgressEvent("load", { lengthComputable: true, loaded: total, total }));
        }
        this.#finish(res.status, text);
        this.dispatchEvent(new Event("readystatechange"));
        this.dispatchEvent(new ProgressEvent("load"));
        this.dispatchEvent(new ProgressEvent("loadend"));
      })();
    }

    override abort(): void {
      const ac = this.#ac;
      if (this.#fake === null || ac === null) return super.abort();
      if (ac.signal.aborted || this.#state === 4) return;
      ac.abort();
      this.#finish(0, "");
      this.dispatchEvent(new ProgressEvent("abort"));
      this.dispatchEvent(new ProgressEvent("loadend"));
    }

    #finish(status: number, text: string): void {
      clearInterval(this.#timer);
      this.#state = 4;
      this.#status = status;
      this.#text = text;
    }
  };
}
