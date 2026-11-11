package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"strings"
	"testing"

	"github.com/skoow/shhdrop/server/internal/config"
	"github.com/skoow/shhdrop/server/internal/store"
)

// Audit F3 : une erreur système (chemin d'un fichier de partage, donc son identifiant
// interne) n'est jamais recopiée sur la sortie d'erreur ; seuls les messages écrits pour
// l'exploitant le sont.
func TestPublicMessage(t *testing.T) {
	const id = "AAAAAAAAAAAAAAAAAAAAAA"
	sys := &fs.PathError{Op: "unlinkat", Path: "/data/blobs/" + id, Err: errors.New("input/output error")}
	tests := []struct {
		name string
		err  error
		want string // contenu attendu ; vide : message fixe seulement
		deny string
	}{
		{name: "erreur système", err: sys, deny: id},
		{name: "erreur système enveloppée", err: fmt.Errorf("purge : %w", sys), deny: id},
		{name: "message pour l'exploitant", err: shown("SHH_DATA_DIR /srv n'est pas vide"), want: "SHH_DATA_DIR /srv"},
		{name: "message enveloppé", err: fmt.Errorf("x : %w", shown("index.html absent")), want: "index.html absent"},
		{name: "base plus récente", err: store.ErrNewerSchema, want: "plus récente"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := publicMessage(tt.err)
			if got == "" || (tt.want != "" && !strings.Contains(got, tt.want)) || (tt.deny != "" && strings.Contains(got, tt.deny)) {
				t.Fatalf("publicMessage = %q", got)
			}
		})
	}
}

// Audit F4 : une commande inconnue n'est jamais recopiée (elle peut contenir un secret
// collé par erreur, comme un lien).
func TestUnknownCommandNotEchoed(t *testing.T) {
	var out, errOut bytes.Buffer
	const secret = "https://shhdrop.example/#cle-secrete"
	if code := runCmd([]string{"shhdrop", secret}, &out, &errOut); code != 2 {
		t.Fatal(code)
	}
	if strings.Contains(errOut.String(), "cle-secrete") || out.Len() != 0 {
		t.Fatalf("argument recopié : %q", errOut.String())
	}
}

// Audit F3 : une erreur de démarrage système n'est pas recopiée par run.
func TestServeErrorNotEchoed(t *testing.T) {
	var out, errOut bytes.Buffer
	t.Setenv("SHH_DATA_DIR", t.TempDir())
	serveFn = func(context.Context, config.Config, io.Writer) error {
		return &fs.PathError{Op: "open", Path: "/x/blobs/AAAAAAAAAAAAAAAAAAAAAA", Err: fs.ErrPermission}
	}
	t.Cleanup(func() { serveFn = serve })
	if code := runCmd([]string{"shhdrop", "serve"}, &out, &errOut); code != 1 {
		t.Fatal(code)
	}
	if strings.Contains(errOut.String(), "AAAAAAAAAAAAAAAAAAAAAA") {
		t.Fatalf("erreur système recopiée : %q", errOut.String())
	}
}
