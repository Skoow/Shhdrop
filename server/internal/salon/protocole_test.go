package salon

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"strings"
	"testing"
)

// trameValide : une trame de 4 140 octets d'en-tête lisible (drapeaux donnés).
func trameValide(drapeaux byte) []byte {
	tr := make([]byte, TailleTrame)
	copy(tr, "SHC3")
	tr[4] = drapeaux
	for i := 5; i < len(tr); i++ {
		tr[i] = byte(i * 7)
	}
	return tr
}

func jetonB64(j [32]byte) string { return base64.RawURLEncoding.EncodeToString(j[:]) }

func accueil(jeton string, depuis uint64) []byte {
	return binary.BigEndian.AppendUint64([]byte(jeton), depuis)
}

func TestConstantes(t *testing.T) {
	if TailleTrame != 4140 || TailleAccueil != 51 || LimiteLecture != 4200 || DepuisReprise != ^uint64(0) {
		t.Fatal("constantes du protocole")
	}
	// La plus grande demande (trame ‖ pièce) tient dans la limite de lecture du WebSocket.
	if 1+TailleTrame+16 > LimiteLecture {
		t.Fatal("LimiteLecture trop petite")
	}
	if RaisonExpire != 1 || RaisonDetruit != 2 || RaisonRemplace != 4 || RaisonExclu != 5 || RaisonTropLent != 6 {
		t.Fatal("raisons de fin (plan, Protocole, 0x05)")
	}
	if CodeAccueil != 4001 || CodeRevoque != 4002 || CodeInvalide != 4003 || CodeInconnu != 4004 ||
		CodeRemplace != 4005 || CodeTropLent != 4006 || CodeFin != 1000 || CodeArret != 1001 {
		t.Fatal("codes de fermeture (plan, point 19)")
	}
}

func TestAccueil(t *testing.T) {
	var j [32]byte
	for i := range j {
		j[i] = byte(0xA0 + i)
	}
	s := jetonB64(j)
	if len(s) != 43 {
		t.Fatal(len(s))
	}
	a, err := LireAccueil(accueil(s, 42))
	if err != nil || a.Jeton != j || a.Depuis != 42 || a.Reprise {
		t.Fatalf("accueil valide : %+v, %v", a, err)
	}
	a, err = LireAccueil(accueil(s, 0))
	if err != nil || a.Depuis != 0 || a.Reprise {
		t.Fatalf("depuis = 0 : %+v, %v", a, err)
	}
	a, err = LireAccueil(accueil(s, DepuisReprise))
	if err != nil || !a.Reprise || a.Depuis != DepuisReprise {
		t.Fatalf("reprise : %+v, %v", a, err)
	}
	a, err = LireAccueil(accueil(s, DepuisReprise-1))
	if err != nil || a.Reprise {
		t.Fatalf("2^64-2 n'est pas une reprise : %+v, %v", a, err)
	}

	mauvais := map[string][]byte{
		"50 octets":            accueil(s, 0)[:50],
		"52 octets":            append(accueil(s, 0), 0),
		"vide":                 nil,
		"jeton à 44 car.":      accueil(s+"A", 0),
		"jeton à 42 car.":      append(accueil(s[:42], 0), 0),
		"bits de fin non nuls": accueil(s[:42]+"B", 0), // 43e caractère : 2 bits de bourrage à 1
	}
	for _, c := range []byte{'=', '+', '/', '\n', '\r', ' ', 0, 0x80} {
		mauvais["car. "+string(rune(c))] = accueil(s[:10]+string([]byte{c})+s[11:], 0)
		mauvais["car. final "+string(rune(c))] = accueil(s[:42]+string([]byte{c}), 0)
	}
	for nom, b := range mauvais {
		if a, err := LireAccueil(b); !errors.Is(err, ErrProtocole) {
			t.Errorf("%s : accepté (%+v, %v)", nom, a, err)
		}
	}
}

func TestDemandes(t *testing.T) {
	tr := trameValide(0b101) // volatile, 10 min
	piece := [16]byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}

	d, err := LireDemande(append([]byte{DemTrame}, tr...))
	if err != nil || d.Type != DemTrame || !bytes.Equal(d.Trame, tr) || d.Piece != nil {
		t.Fatalf("0x01 de 4 141 octets : %v", err)
	}
	b := append(append([]byte{DemTrame}, tr...), piece[:]...)
	if len(b) != 4157 {
		t.Fatal(len(b))
	}
	d, err = LireDemande(b)
	if err != nil || d.Type != DemTrame || !bytes.Equal(d.Trame, tr) || d.Piece == nil || *d.Piece != piece {
		t.Fatalf("0x01 de 4 157 octets : %+v, %v", d.Piece, err)
	}
	for _, n := range []int{1, 2, 4140, 4142, 4156, 4158, LimiteLecture} {
		x := make([]byte, n)
		x[0] = DemTrame
		copy(x[1:], tr)
		if _, err := LireDemande(x); !errors.Is(err, ErrProtocole) {
			t.Errorf("0x01 de %d octets : %v", n, err)
		}
	}
	// En-tête illisible : refusé (ErrEnTete), même à la bonne taille.
	bad := trameValide(0x08)
	if _, err := LireDemande(append([]byte{DemTrame}, bad...)); !errors.Is(err, ErrEnTete) {
		t.Errorf("0x01, bit réservé : %v", err)
	}
	bad = trameValide(0)
	bad[0] = 'X'
	if _, err := LireDemande(append(append([]byte{DemTrame}, bad...), piece[:]...)); !errors.Is(err, ErrEnTete) {
		t.Errorf("0x01 avec pièce, marque fausse : %v", err)
	}

	seq := []byte{0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08}
	for _, ty := range []byte{DemRetirer, DemLu} {
		d, err := LireDemande(append([]byte{ty}, seq...))
		if err != nil || d.Type != ty || d.Seq != 0x0102030405060708 || d.Trame != nil || d.Piece != nil {
			t.Errorf("%#02x : %+v, %v", ty, d, err)
		}
		for _, n := range []int{0, 7, 9, 16} {
			if _, err := LireDemande(append([]byte{ty}, make([]byte, n)...)); n != 8 && !errors.Is(err, ErrProtocole) {
				t.Errorf("%#02x de %d octets : %v", ty, n+1, err)
			}
		}
	}
	d, err = LireDemande(append([]byte{DemPing}, seq...))
	if err != nil || d.Type != DemPing || d.Ping != [8]byte(seq) || d.Seq != 0 {
		t.Errorf("0x04 : %+v, %v", d, err)
	}
	for _, n := range []int{0, 7, 9} {
		if _, err := LireDemande(append([]byte{DemPing}, make([]byte, n)...)); !errors.Is(err, ErrProtocole) {
			t.Errorf("0x04 de %d octets : %v", n+1, err)
		}
	}
	d, err = LireDemande([]byte{DemQuitter})
	if err != nil || d.Type != DemQuitter {
		t.Errorf("0x03 : %+v, %v", d, err)
	}
	if _, err := LireDemande([]byte{DemQuitter, 0}); !errors.Is(err, ErrProtocole) {
		t.Errorf("0x03 de 2 octets : %v", err)
	}
	for _, ty := range []byte{0x00, 0x06, 0x07, 0x08, 0x0A, 0x0E, 0xFF} {
		if _, err := LireDemande(append([]byte{ty}, seq...)); !errors.Is(err, ErrProtocole) {
			t.Errorf("type %#02x : %v", ty, err)
		}
	}
	if _, err := LireDemande(nil); !errors.Is(err, ErrProtocole) {
		t.Errorf("vide : %v", err)
	}
}

func TestEnregistrements(t *testing.T) {
	const seq = uint64(0x1122334455667788)
	n1 := [16]byte{0xA1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0xAF}
	n2 := [16]byte{0xB1, 0xB2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0xBF}
	tr := trameValide(0b011)
	tete := func(ty byte) []byte { return binary.BigEndian.AppendUint64([]byte{ty}, seq) }
	cat := func(p ...[]byte) []byte { return bytes.Join(p, nil) }
	u32 := func(v uint32) []byte { return binary.BigEndian.AppendUint32(nil, v) }
	u64 := func(v uint64) []byte { return binary.BigEndian.AppendUint64(nil, v) }
	const recu = int64(1762950000123)

	cas := []struct {
		nom    string
		got    []byte
		taille int
		want   []byte
	}{
		{"trame", EnrTrame(seq, 7, recu, tr), 4158, cat(tete(0x01), []byte{7}, u64(uint64(recu)), tr)},
		{"arrivée", EnrArrivee(seq, 3, n1), 26, cat(tete(0x02), []byte{3}, n1[:])},
		{"départ", EnrDepart(seq, 9), 10, cat(tete(0x03), []byte{9})},
		{"fin", EnrFin(seq, RaisonTropLent), 10, cat(tete(0x05), []byte{6})},
		{"présence en ligne", EnrPresence(seq, 2, true), 11, cat(tete(0x07), []byte{2, 1})},
		{"présence hors ligne", EnrPresence(seq, 2, false), 11, cat(tete(0x07), []byte{2, 0})},
		{"pong", EnrPong(seq, [8]byte{9, 8, 7, 6, 5, 4, 3, 2}), 17, cat(tete(0x08), []byte{9, 8, 7, 6, 5, 4, 3, 2})},
		{"exclusion", EnrExclusion(seq, 4, n1, 0xDEADBEEF), 30, cat(tete(0x09), []byte{4}, n1[:], u32(0xDEADBEEF))},
		{"exclusion sans exclu", EnrExclusion(seq, SansExclu, n2, 1), 30, cat(tete(0x09), []byte{0xFF}, n2[:], u32(1))},
		{"reprise", EnrReprise(seq, 5, n2), 26, cat(tete(0x0A), []byte{5}, n2[:])},
		{"limite", EnrLimite(seq, 61), 13, cat(tete(0x0B), u32(61))},
		{"plein", EnrPlein(seq), 9, tete(0x0C)},
		{"liste vide", EnrListe(seq, 0, nil), 11, cat(tete(0x0D), []byte{0, 0})},
		{"liste", EnrListe(seq, 0, []Annonce{{0, n1}, {6, n2}}), 45,
			cat(tete(0x0D), []byte{0, 2, 0}, n1[:], []byte{6}, n2[:])},
		{"effacée", EnrEfface(seq, 0x0102030405060708), 17, cat(tete(0x0E), u64(0x0102030405060708))},
	}
	for _, c := range cas {
		if len(c.got) != c.taille || len(c.want) != c.taille || !bytes.Equal(c.got, c.want) {
			t.Errorf("%s : %d octets %x\nattendu %d octets %x", c.nom, len(c.got), c.got, c.taille, c.want)
		}
		if cap(c.got) != len(c.got) {
			t.Errorf("%s : capacité %d (une seule tranche, exacte)", c.nom, cap(c.got))
		}
		if _, err := LireDemande(c.got); !errors.Is(err, ErrProtocole) {
			t.Errorf("%s : lu comme une demande du client (%v)", c.nom, err)
		}
	}
	// Liste pleine : 10 sièges.
	dix := make([]Annonce, 10)
	for i := range dix {
		dix[i] = Annonce{Siege: uint8(i), Nonce: n1}
	}
	if l := EnrListe(seq, 0, dix); len(l) != 11+10*17 || l[10] != 10 || l[11+9*17] != 9 {
		t.Errorf("liste de 10 : %d octets", len(l))
	}
	// La trame relayée est une copie : modifier la source ne change pas l'enregistrement.
	e := EnrTrame(seq, 1, recu, tr)
	tr[100] ^= 0xFF
	if e[18+100] == tr[100] {
		t.Error("EnrTrame garde une référence à la trame")
	}
	// recuMs négatif (horloge avant 1970) : codé tel quel en complément à deux, sans panique.
	if e := EnrTrame(seq, 1, -1, tr); !bytes.Equal(e[10:18], u64(^uint64(0))) {
		t.Errorf("recuMs = -1 : %x", e[10:18])
	}
}

// Préconditions des encodeurs : une trame de mauvaise taille ou une liste de plus de 255
// annonces est une erreur de programmation (panique), jamais un enregistrement tronqué.
func TestEnregistrementsPreconditions(t *testing.T) {
	panique := func(nom string, f func()) {
		t.Helper()
		defer func() {
			if recover() == nil {
				t.Errorf("%s : pas de panique", nom)
			}
		}()
		f()
	}
	panique("trame courte", func() { EnrTrame(1, 0, 0, make([]byte, TailleTrame-1)) })
	panique("trame longue", func() { EnrTrame(1, 0, 0, make([]byte, TailleTrame+1)) })
	panique("liste de 256", func() { EnrListe(1, 0, make([]Annonce, 256)) })
}

// puits : garde le résultat des encodeurs (sinon le compilateur peut l'allouer sur la pile).
var puits []byte

// Lecteurs sans allocation ; encodeurs : une seule (la tranche rendue).
func TestAllocations(t *testing.T) {
	tr := trameValide(0)
	dem := append(append([]byte{DemTrame}, tr...), make([]byte, 16)...)
	acc := accueil(strings.Repeat("A", 43), 5)
	liste := []Annonce{{1, [16]byte{}}, {2, [16]byte{}}}
	for nom, f := range map[string]func(){
		"LireEnTete":  func() { LireEnTete(tr) },
		"LireDemande": func() { LireDemande(dem) },
		"LireAccueil": func() { LireAccueil(acc) },
	} {
		if n := testing.AllocsPerRun(100, f); n != 0 {
			t.Errorf("%s : %v allocations", nom, n)
		}
	}
	for nom, f := range map[string]func(){
		"EnrTrame": func() { puits = EnrTrame(1, 2, 3, tr) },
		"EnrListe": func() { puits = EnrListe(1, 0, liste) },
		"EnrPong":  func() { puits = EnrPong(1, [8]byte{}) },
	} {
		if n := testing.AllocsPerRun(100, f); n != 1 {
			t.Errorf("%s : %v allocations", nom, n)
		}
	}
}

// erreurTypee : toute erreur des lecteurs est ErrEnTete ou ErrProtocole.
func erreurTypee(err error) bool { return errors.Is(err, ErrEnTete) || errors.Is(err, ErrProtocole) }

// verifierDemande : une demande acceptée respecte exactement la table « Client → serveur ».
func verifierDemande(t *testing.T, b []byte) {
	d, err := LireDemande(b)
	if err != nil {
		if !erreurTypee(err) {
			t.Fatalf("erreur non typée : %v", err)
		}
		return
	}
	ok := false
	switch d.Type {
	case DemTrame:
		_, e := LireEnTete(d.Trame)
		ok = e == nil && (len(b) == 1+TailleTrame && d.Piece == nil ||
			len(b) == 1+TailleTrame+16 && d.Piece != nil && bytes.Equal(d.Piece[:], b[1+TailleTrame:]))
	case DemRetirer, DemLu:
		ok = len(b) == 9 && d.Seq == binary.BigEndian.Uint64(b[1:])
	case DemQuitter:
		ok = len(b) == 1
	case DemPing:
		ok = len(b) == 9 && bytes.Equal(d.Ping[:], b[1:])
	}
	if !ok || d.Type != b[0] {
		t.Fatalf("demande acceptée hors de la table : %d octets, type %#02x", len(b), d.Type)
	}
}

// FuzzTrame : message de longueur n (0 à LimiteLecture) qui commence par tete et finit par fin
// (le reste suit un motif fixe), pour garder des entrées courtes : les lecteurs ne regardent
// que le début, la fin et la longueur. tete seule est aussi lue telle quelle.
func FuzzTrame(f *testing.F) {
	tr := trameValide(0b111)
	f.Add([]byte{DemTrame, 'S', 'H', 'C', '3', 7}, uint16(1+TailleTrame), []byte{})
	f.Add([]byte{DemTrame, 'S', 'H', 'C', '3', 1}, uint16(1+TailleTrame+16), make([]byte, 16))
	f.Add([]byte("SHC3\x04"), uint16(TailleTrame), []byte{})
	f.Add([]byte{DemRetirer, 0, 0, 0, 0, 0, 0, 0, 1}, uint16(9), []byte{})
	f.Add([]byte{DemQuitter}, uint16(1), []byte{})
	f.Add([]byte{DemPing, 1, 2, 3, 4, 5, 6, 7, 8}, uint16(9), []byte{})
	f.Add([]byte{DemLu, 0, 0, 0, 0, 0, 0, 0, 2}, uint16(9), []byte{})
	f.Add(accueil(strings.Repeat("_", 43), DepuisReprise), uint16(TailleAccueil), []byte{})
	f.Fuzz(func(t *testing.T, tete []byte, n uint16, fin []byte) {
		b := make([]byte, int(n)%(LimiteLecture+1))
		copy(b, tr)
		copy(b, tete)
		if len(fin) <= len(b) {
			copy(b[len(b)-len(fin):], fin)
		}
		lireTout(t, tete)
		lireTout(t, b)
	})
}

// lireTout : les trois lecteurs sur b ; toute erreur est typée, tout succès conforme au format.
func lireTout(t *testing.T, b []byte) {
	e, err := LireEnTete(b)
	if err != nil {
		if !errors.Is(err, ErrEnTete) {
			t.Fatalf("LireEnTete : erreur non typée %v", err)
		}
	} else if len(b) != TailleTrame || string(b[:4]) != "SHC3" || b[4]&^7 != 0 ||
		e.Volatile != (b[4]&1 == 1) || e.Regle != Regle(b[4]>>1) {
		t.Fatalf("LireEnTete accepte %x…", b[:min(len(b), 8)])
	}
	verifierDemande(t, b)
	if a, err := LireAccueil(b); err != nil {
		if !errors.Is(err, ErrProtocole) {
			t.Fatalf("LireAccueil : erreur non typée %v", err)
		}
	} else if len(b) != TailleAccueil || jetonB64(a.Jeton) != string(b[:43]) ||
		a.Depuis != binary.BigEndian.Uint64(b[43:]) || a.Reprise != (a.Depuis == DepuisReprise) {
		t.Fatalf("LireAccueil accepte %q", b)
	}
}

// FuzzFlux : un flux de messages (longueur sur 2 octets ‖ message), lus comme le serveur les
// lit (accueil puis demandes), et des enregistrements du serveur aux champs quelconques, qui
// ne doivent jamais passer pour une demande du client.
func FuzzFlux(f *testing.F) {
	f.Add([]byte{0, 1, DemQuitter, 0, 9, DemPing, 1, 2, 3, 4, 5, 6, 7, 8}, uint64(1), uint8(0), int64(0), uint32(0))
	f.Add([]byte{}, ^uint64(0), uint8(0xFF), int64(-1), ^uint32(0))
	f.Fuzz(func(t *testing.T, flux []byte, seq uint64, siege uint8, recu int64, r uint32) {
		for i := 0; len(flux) >= 2; i++ {
			n := int(binary.BigEndian.Uint16(flux))
			flux = flux[2:]
			m := flux[:min(n, len(flux))]
			flux = flux[len(m):]
			if i == 0 {
				if _, err := LireAccueil(m); err != nil && !errors.Is(err, ErrProtocole) {
					t.Fatalf("LireAccueil : %v", err)
				}
				continue
			}
			verifierDemande(t, m)
		}
		var nonce [16]byte
		binary.BigEndian.PutUint64(nonce[:], seq^uint64(r))
		var ping [8]byte
		binary.BigEndian.PutUint64(ping[:], uint64(recu))
		liste := make([]Annonce, int(siege)%11)
		for i := range liste {
			liste[i] = Annonce{Siege: siege + uint8(i), Nonce: nonce}
		}
		for _, e := range [][]byte{
			EnrTrame(seq, siege, recu, trameValide(byte(r)&7)),
			EnrArrivee(seq, siege, nonce), EnrDepart(seq, siege), EnrFin(seq, siege),
			EnrPresence(seq, siege, r&1 == 1), EnrPong(seq, ping), EnrExclusion(seq, siege, nonce, r),
			EnrReprise(seq, siege, nonce), EnrLimite(seq, r), EnrPlein(seq),
			EnrListe(seq, siege, liste), EnrEfface(seq, uint64(recu)),
		} {
			if d, err := LireDemande(e); err == nil {
				t.Fatalf("enregistrement %#02x lu comme une demande %#02x", e[0], d.Type)
			} else if !errors.Is(err, ErrProtocole) {
				t.Fatalf("enregistrement %#02x : %v", e[0], err)
			}
			if _, err := LireAccueil(e); err == nil {
				t.Fatalf("enregistrement %#02x lu comme un accueil", e[0])
			}
		}
	})
}
