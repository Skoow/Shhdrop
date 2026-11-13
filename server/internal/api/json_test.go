package api

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

type voidBody struct {
	Void [][2]int `json:"void"`
	N    *int     `json:"n"`
}

func decodeBody(body string) (voidBody, error) {
	var v voidBody
	r := httptest.NewRequest("POST", "/", strings.NewReader(body))
	err := readJSON(httptest.NewRecorder(), r, &v)
	return v, err
}

// Audit F7 : un tableau de taille fixe ([2]int) n'accepte que ce nombre d'éléments ;
// encoding/json ignorait le 3ᵉ (« [[0,5,999]] » accepté comme [0,5]) et complétait un tableau
// trop court par des zéros.
func TestReadJSONFixedArrays(t *testing.T) {
	tests := []struct {
		name string
		body string
		ok   bool
	}{
		{name: "paire", body: `{"void":[[0,5]]}`, ok: true},
		{name: "plusieurs paires", body: `{"void":[[0,5],[7,9]]}`, ok: true},
		{name: "liste vide", body: `{"void":[]}`, ok: true},
		{name: "trois éléments", body: `{"void":[[0,5,999]]}`},
		{name: "un élément", body: `{"void":[[0]]}`},
		{name: "paire vide", body: `{"void":[[]]}`},
		{name: "objet dans la paire", body: `{"void":[[0,{"a":1}]]}`},
		{name: "clé inconnue", body: `{"x":1}`},
		{name: "clé en double", body: `{"n":1,"n":2}`},
		{name: "casse différente", body: `{"N":1}`},
		{name: "deux objets", body: `{"n":1}{"n":2}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v, err := decodeBody(tt.body)
			if (err == nil) != tt.ok {
				t.Fatalf("readJSON(%s) : err = %v, attendu ok = %v (%v)", tt.body, err, tt.ok, v)
			}
		})
	}
}

// Fuzz : readJSON (strictKeys puis Decode) ne panique jamais, et tout corps accepté se
// relit à l'identique.
func FuzzReadJSON(f *testing.F) {
	for _, s := range []string{`{"void":[[0,5]]}`, `{"void":[[0,5,999]]}`, `{"n":1}`, `{"n":1,"n":2}`,
		`[`, `{"void":[[`, `{"void":null}`, `{"void":[[1e400,2]]}`, ``, `null`} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, body string) {
		v, err := decodeBody(body)
		if err != nil {
			return
		}
		for _, p := range v.Void {
			_ = p[1]
		}
	})
}

// Relecture C-2 Task 17 : un corps `null` là où un objet est attendu est refusé (errKeys), pour
// toutes les routes ; un champ pointeur facultatif peut rester `null`.
func TestReadJSONNull(t *testing.T) {
	type vide struct{}
	type imbrique struct {
		In  struct{ A int }  `json:"in"`
		Opt *struct{ A int } `json:"opt"`
	}
	lire := func(body string, v any) error {
		return readJSON(httptest.NewRecorder(), httptest.NewRequest("POST", "/", strings.NewReader(body)), v)
	}
	tests := []struct {
		name string
		body string
		v    func() any
		ok   bool
	}{
		{"null pour un objet vide", `null`, func() any { return &vide{} }, false},
		{"null pour un objet", `null`, func() any { return &voidBody{} }, false},
		{"null avec espaces", " null ", func() any { return &vide{} }, false},
		{"objet vide", `{}`, func() any { return &vide{} }, true},
		{"objet imbriqué null", `{"in":null}`, func() any { return &imbrique{} }, false},
		{"pointeur facultatif null", `{"opt":null}`, func() any { return &imbrique{} }, true},
		{"champ simple null", `{"n":null}`, func() any { return &voidBody{} }, true},
		{"tableau null", `{"void":null}`, func() any { return &voidBody{} }, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := lire(tt.body, tt.v())
			if (err == nil) != tt.ok {
				t.Fatalf("readJSON(%q) : err = %v, attendu ok = %v", tt.body, err, tt.ok)
			}
		})
	}
}

// strictKeys rend errKeys (et non une autre erreur) pour un corps `null`.
func TestStrictKeysNull(t *testing.T) {
	type vide struct{}
	if err := strictKeys(json.NewDecoder(strings.NewReader("null")), reflect.TypeOf(vide{})); err != errKeys {
		t.Fatalf("err = %v, attendu errKeys", err)
	}
}

// Revue finale C-2, mineur (h) : v qui n'est pas un pointeur non nul (erreur de programmation)
// → erreur interne (500), jamais une panique ni un 400.
func TestReadJSONSansPointeur(t *testing.T) {
	var nul *voidBody
	for nom, v := range map[string]any{"valeur": voidBody{}, "nil": nil, "pointeur nul": nul, "entier": 3} {
		r := httptest.NewRequest("POST", "/", strings.NewReader(`{}`))
		func() {
			defer func() {
				if p := recover(); p != nil {
					t.Fatalf("%s : panique %v", nom, p)
				}
			}()
			if err := readJSON(httptest.NewRecorder(), r, v); err == nil || err == errBadRequest {
				t.Fatalf("%s : %v, attendu une erreur interne", nom, err)
			}
		}()
	}
}
