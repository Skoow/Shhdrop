package api

// Tests offensifs des audits du 12 novembre (routes des pièces du salon), repris du
// scratchpad et changés en assertions : chacun échouait avant sa correction.

import (
	"bytes"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
)

// D2 de l'audit : un vocal ne passe par aucun quota d'octets (réserve du siège) ; il se
// réécrivait sans fin (40 × 4 Mo en 204). Le total reçu par pièce est plafonné à 2 × sa
// taille : au-delà, 413 too_large (pièce à abandonner : 429 pousserait le client à réessayer
// la même requête, refusée pour toujours). Même plafond pour un fichier.
func TestAuditVocalReecritureHorsQuota(t *testing.T) {
	b := nouveauWS(t, nil)
	e := b.e
	j := b.membres(t, 1)
	c := b.entrer(t, j[0])
	lireJusqua(t, c, 0x0D)
	e.clk.Add(30 * time.Minute) // réserve vocale : 7,2 Mo ≥ 5 244 208 o
	for _, vocal := range []bool{true, false} {
		_, tok := e.pieceCreee(t, j[0], 80, vocal)
		seg := rnd(share.SegmentSize(80, 0))
		for i := range 2 { // 2 × 4 195 376 o ≤ 2 × 5 244 208 o
			if w := e.putPiece(tok, 0, seg); w.Code != 204 {
				t.Fatal(vocal, "PUT", i, w.Code, w.Body.String())
			}
		}
		for range 3 {
			expect(t, e.putPiece(tok, 0, seg), 413, `{"error":"too_large"}`)
		}
	}
}

// D4 de l'audit : HEAD sur les routes GET des segments (pièce du salon, partage) répondait
// 200 et consommait le budget de lecture sans rien servir. HEAD, et toute méthode autre que
// GET et PUT, répondent 405 (Allow: GET, PUT), avant tout budget ; le GET suivant est servi.
func TestAuditHeadConsommeBudget(t *testing.T) {
	e, _ := salonEnv(t)
	j := salonMembres(t, e, 2)
	id, segs := e.envoyerPiece(t, j[0], 1)
	c := e.create(t, "203.0.113.7:1", newKeys(), 1, 1)
	e.upload(t, c, 1)
	dl, _ := e.unlock(t, c.ID, c.k)
	routes := map[string]map[string]string{
		"/api/salons/pieces/segments/0": pieceHdr(j[1], id),
		"/api/shares/segments/0":        auth(dl),
	}
	for chemin, hdr := range routes {
		for _, m := range []string{"HEAD", "POST", "DELETE", "PATCH", "OPTIONS", "TRACE"} {
			fois := 1 // sous les 60 requêtes par minute de l'adresse
			if m == "HEAD" {
				fois = 5
			}
			for range fois {
				w := e.do(req{method: m, path: chemin, hdr: hdr})
				if w.Code != 405 || w.Header().Get("Allow") != "GET, PUT" {
					t.Fatal(chemin, m, w.Code, w.Header().Get("Allow"))
				}
				if m != "HEAD" && w.Body.String() != `{"error":"method_not_allowed"}` {
					t.Fatal(chemin, m, w.Body.String())
				}
			}
		}
		// Budget de lecture du palier 1 : 4 segments ; 5 HEAD l'auraient épuisé.
		w := e.do(req{method: "GET", path: chemin, hdr: hdr})
		if w.Code != 200 {
			t.Fatal(chemin, "GET après les HEAD :", w.Code, w.Body.String())
		}
	}
	if w := e.getPiece(j[1], id, 0); w.Code == 200 && !bytes.Equal(w.Body.Bytes(), segs[0]) {
		t.Fatal("contenu")
	}
}

// D2 de l'audit des partages : la longueur de la réponse d'unlock révélait la dernière
// ouverture (true fait un octet de moins que false) à un observateur du trafic chiffré.
// last_open est un entier 0 ou 1 : même longueur pour les deux. Reste opens_left (1 ou 2
// chiffres, risque résiduel faible, spec §36).
func TestAuditUnlockLength(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 2)
	e.upload(t, c, 1)
	var longueurs []int
	for i, attendu := range []float64{0, 1} {
		w := e.do(req{method: "POST", path: "/api/shares/unlock", hdr: access(k),
			body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})})
		expect(t, w, 200, "")
		if m := jsonOf(t, w); m["last_open"] != attendu {
			t.Fatalf("ouverture %d : last_open = %v (%T)", i+1, m["last_open"], m["last_open"])
		}
		longueurs = append(longueurs, w.Body.Len())
	}
	if longueurs[0] != longueurs[1] {
		t.Fatal("longueurs des réponses d'unlock :", longueurs)
	}
}
