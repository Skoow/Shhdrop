package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

// staticHandler sert le site (web/dist) depuis dir (audit F7) :
//   - dir et dir/index.html doivent exister au démarrage ;
//   - os.Root : aucun lien symbolique ne sort du dossier ;
//   - tout nom qui commence par « . » (.env, .git/…) → 404 ;
//   - un dossier n'est jamais listé : son index.html, sinon 404 ;
//   - repli de l'application monopage : un chemin inconnu dont le dernier segment n'a pas
//     d'extension (/s/<id>, /m/<id>…) sert index.html ; un fichier absent (x.js) → 404.
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
		if errors.Is(err, fs.ErrNotExist) && !strings.Contains(path.Base(name), ".") && !isDir(fsys, name) {
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
		// Date nulle : pas de Last-Modified (Cache-Control: no-store partout).
		http.ServeContent(w, r, fi.Name(), time.Time{}, rs)
	}), nil
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
