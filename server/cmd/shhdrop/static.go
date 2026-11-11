package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// staticHandler sert le site (web/dist) depuis dir (audit F7) :
//   - dir et dir/index.html doivent exister au démarrage ;
//   - os.Root : aucun lien symbolique ne sort du dossier ;
//   - tout nom qui commence par « . » (.env, .git/…) → 404 ;
//   - un dossier n'est jamais listé : son index.html, sinon 404 ;
//   - repli de l'application monopage : un chemin inconnu dont le dernier segment n'a pas
//     d'extension sert index.html ; un fichier absent (x.js) → 404. Les liens sont à la
//     racine (« /#clé », spec §32) : plus de repli particulier sous /s/ ni /m/ ; un chemin
//     abîmé sans extension charge l'application, qui retire le « # » (UI §12.1) ;
//   - statut réel (audit de performance, point 5) : seules les routes de l'application
//     (appRoutes, mêmes que web/src/app/router.svelte.ts) répondent 200 ; tout autre chemin
//     sans extension reçoit index.html avec le statut 404 (l'application y affiche « Cette
//     page n'existe pas. »), jamais un « soft 404 » en 200.
//
// Les en-têtes de sécurité sont posés par api.New autour de ce gestionnaire.
func staticHandler(dir string) (http.Handler, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("SHH_STATIC_DIR %s : %w", dir, err)
	}
	if fi, err := root.Stat("index.html"); err != nil || !fi.Mode().IsRegular() {
		root.Close()
		return nil, fmt.Errorf("SHH_STATIC_DIR %s : index.html absent", dir)
	}
	fsys := root.FS()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "méthode non permise", http.StatusMethodNotAllowed)
			return
		}
		name, ok := staticName(r.URL.Path)
		if !ok {
			http.NotFound(w, r)
			return
		}
		f, fi, err := openRegular(fsys, name)
		status := http.StatusOK
		if errors.Is(err, fs.ErrNotExist) && !strings.Contains(path.Base(name), ".") && !isDir(fsys, name) {
			if !appRoutes[r.URL.Path] {
				status = http.StatusNotFound
			}
			name = "index.html"
			f, fi, err = openRegular(fsys, name)
		}
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		rs, ok := f.(io.ReadSeeker)
		if !ok {
			http.NotFound(w, r)
			return
		}
		if status == http.StatusNotFound {
			// ServeContent répondrait 200 : en-têtes posés à la main, corps entier (pas de plage).
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Content-Length", strconv.FormatInt(fi.Size(), 10))
			w.WriteHeader(http.StatusNotFound)
			if r.Method != http.MethodHead {
				io.Copy(w, rs)
			}
			return
		}
		h := w.Header()
		// Cache : no-store partout, posé par api.New, sauf pour un fichier à empreinte de
		// /assets/ qui existe (jamais pour un 404 ni pour le repli vers index.html) : un an,
		// immuable (revue du 10 novembre ; remplace « aucun cache », retours CLEAN4).
		if immutableAsset.MatchString("/"+name) && path.Base(name) == fi.Name() {
			h.Set("Cache-Control", immutableCache)
		}
		// Variante précompressée au build (vite.config.ts, precompress) : mêmes octets une fois
		// décompressés (SRI inchangée), jamais de compression à la volée ni sur /api/*.
		if compressible(name) {
			h.Add("Vary", "Accept-Encoding")
			if ef, enc := encodedVariant(fsys, name, r.Header.Get("Accept-Encoding")); ef != nil {
				defer ef.Close()
				if t := mime.TypeByExtension(path.Ext(name)); t != "" {
					h.Set("Content-Type", t)
				}
				h.Set("Content-Encoding", enc)
				http.ServeContent(w, r, fi.Name(), time.Time{}, ef)
				return
			}
		}
		// Date nulle : pas de Last-Modified (no-store, ou contenu immuable sous ce nom).
		http.ServeContent(w, r, fi.Name(), time.Time{}, rs)
	}), nil
}

// immutableAsset : fichiers de /assets/ dont le nom porte une empreinte du contenu (vite :
// nom-EMPREINTE.ext, 8 caractères base64url ou plus). Leur contenu ne change jamais sous ce
// nom : cache d'un an. Tout le reste garde le no-store posé par api.New (HTML, routes,
// cadre PDF, polices de /fonts/ et images sans empreinte, robots.txt, sitemap.xml, manifeste).
var immutableAsset = regexp.MustCompile(`^/assets/.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2|png|webp|svg|wasm)$`)

const immutableCache = "public, max-age=31536000, immutable"

// compressible : types précompressés par le build : texte, et le moteur WebAssembly (481 Ko,
// 141 Ko en brotli, spec moteur §7) ; les images et polices le sont déjà.
func compressible(name string) bool {
	switch path.Ext(name) {
	case ".js", ".css", ".html", ".svg", ".webmanifest", ".xml", ".txt", ".wasm":
		return true
	}
	return false
}

// encodedVariant : name.br, sinon name.gz, si le client les accepte et qu'ils existent.
func encodedVariant(fsys fs.FS, name, accept string) (interface {
	io.ReadSeeker
	io.Closer
}, string) {
	for _, enc := range [...]struct{ token, ext string }{{"br", ".br"}, {"gzip", ".gz"}} {
		if !accepts(accept, enc.token) {
			continue
		}
		f, _, err := openRegular(fsys, name+enc.ext)
		if err != nil {
			continue
		}
		rsc, ok := f.(interface {
			io.ReadSeeker
			io.Closer
		})
		if !ok {
			f.Close()
			continue
		}
		return rsc, enc.token
	}
	return nil, ""
}

// accepts : vrai si Accept-Encoding contient token sans « q=0 ».
func accepts(header, token string) bool {
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		if !strings.EqualFold(strings.TrimSpace(fields[0]), token) {
			continue
		}
		for _, p := range fields[1:] {
			p = strings.ReplaceAll(strings.TrimSpace(p), " ", "")
			if p == "q=0" || p == "q=0.0" || p == "q=0.00" || p == "q=0.000" {
				return false
			}
		}
		return true
	}
	return false
}

// appRoutes : chemins de l'application qui répondent 200 (voir match() dans
// web/src/app/router.svelte.ts ; un test compare les deux listes).
var appRoutes = map[string]bool{
	"/":                 true,
	"/securite":         true,
	"/confidentialite":  true,
	"/conditions":       true,
	"/mentions-legales": true,
	"/signaler":         true,
	"/offres":           true,
	"/envoyer":          true,
}

// staticName : chemin de l'URL → nom dans le dossier ; refuse les segments cachés.
func staticName(p string) (string, bool) {
	if !strings.HasPrefix(p, "/") {
		return "", false
	}
	for _, seg := range strings.Split(p, "/") {
		if strings.HasPrefix(seg, ".") {
			return "", false // « . », « .. », .env, .git…
		}
	}
	name := strings.TrimPrefix(path.Clean(p), "/")
	if name == "" {
		name = "index.html"
	}
	return name, true
}

func isDir(fsys fs.FS, name string) bool {
	fi, err := fs.Stat(fsys, name)
	return err == nil && fi.IsDir()
}

// openRegular ouvre name, ou name/index.html si c'est un dossier ; fichier ordinaire seulement.
func openRegular(fsys fs.FS, name string) (fs.File, fs.FileInfo, error) {
	if isDir(fsys, name) {
		name = path.Join(name, "index.html")
	}
	f, err := fsys.Open(name)
	if err != nil {
		return nil, nil, err
	}
	fi, err := f.Stat()
	if err != nil || !fi.Mode().IsRegular() {
		f.Close()
		return nil, nil, fs.ErrNotExist
	}
	return f, fi, nil
}
