// Package courriel envoie les codes du compte par e-mail (conception du compte §3.2, §8.7,
// §21.3 ; plan lot 3) : un seul modèle (le code seul), une file en mémoire, un envoi à la fois
// vers le seul hôte SHH_SMTP_HOST, en TLS vérifié (sauf boucle locale, pour les tests). C'est
// le seul client sortant du serveur hors du repli reCAPTCHA (smtp.go ; test TestNoOutgoingHTTP).
//
// Rien n'est écrit : ni journal, ni sortie, ni fichier ; l'adresse ne vit qu'en mémoire, dans
// la file, jusqu'à la fin de son envoi (le message composé est effacé au mieux : les chaînes Go
// ne s'effacent pas). Un envoi raté est oublié en silence : la réponse à la requête ne dépend
// jamais de l'envoi (§8.7).
package courriel

import (
	"context"
	"crypto/rand"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"net/mail"
	"net/netip"
	"strings"
	"time"

	"github.com/skoow/shhdrop/server/internal/config"
)

const (
	// Capacite : messages en file au plus (conception §8.7) ; au-delà, ErrPlein (503 busy).
	Capacite = 256
	// Delai : durée maximale d'un essai d'envoi, connexion comprise (§8.7).
	Delai = 20 * time.Second
	// essais : un envoi, puis un nouvel essai après un échec temporaire (§8.7).
	essais = 2
)

var (
	// ErrPlein : la file est pleine.
	ErrPlein = errors.New("courriel : file pleine")
	// ErrInvalide : adresse, langue ou code refusés (le message ne cite jamais l'adresse).
	ErrInvalide = errors.New("courriel : message invalide")
)

// Message : tout ce qu'un e-mail peut dire. Aucun champ de modèle : il n'y en a qu'un (§21.3).
type Message struct {
	A      string // adresse exacte du destinataire (compte.Adresse.Exacte), ASCII
	Langue string // "fr" ou "en"
	Code   string // 6 chiffres
}

// Envoyeur : file en mémoire et envois, un à la fois (Run).
type Envoyeur struct {
	c         config.SMTP
	mdp       []byte
	enveloppe string // adresse de l'expéditeur (MAIL FROM), tirée de SHH_MAIL_FROM
	domaine   string // domaine de l'expéditeur, pour Message-ID
	file      chan Message
	now       func() time.Time
	delai     time.Duration
	pause     time.Duration // attente avant le nouvel essai

	// Tests seulement (même paquet) : port réellement composé (le mode reste celui de c.Port)
	// et magasin de certificats racine (nil : celui du système). L'hôte composé et le nom
	// vérifié sont toujours c.Host.
	portDial int
	racines  *x509.CertPool
}

// Nouveau prépare l'envoyeur. Refus : hôte, compte, expéditeur, port ou mot de passe absent ;
// texte clair (port autre que 465 et 587) vers un hôte qui n'est pas la boucle locale. mdp
// (contenu de SHH_SMTP_PASSWORD_FILE) est gardé tel quel, en mémoire seulement. À ne créer
// qu'avec SHH_COMPTES=1 (TestCourrielSeulementAvecComptes) : sans envoyeur, aucune sortie.
func Nouveau(c config.SMTP, mdp []byte) (*Envoyeur, error) {
	if c.Host == "" || c.User == "" || c.From == "" || len(mdp) == 0 || c.Port < 1 || c.Port > 65535 {
		return nil, errors.New("courriel : SHH_SMTP_HOST, SHH_SMTP_PORT, SHH_SMTP_USER, SHH_SMTP_PASSWORD_FILE et SHH_MAIL_FROM sont obligatoires")
	}
	if _, err := mode(c); err != nil {
		return nil, err
	}
	a, err := mail.ParseAddress(c.From)
	if err != nil || strings.Count(a.Address, "@") != 1 || !adresseOK(a.Address) {
		return nil, errors.New("courriel : SHH_MAIL_FROM invalide")
	}
	_, dom, _ := strings.Cut(a.Address, "@")
	return &Envoyeur{c: c, mdp: mdp, enveloppe: a.Address, domaine: strings.ToLower(dom),
		file: make(chan Message, Capacite), now: time.Now, delai: Delai, pause: 2 * time.Second}, nil
}

type modeTLS uint8

const (
	tlsImplicite modeTLS = iota // port 465
	tlsStartTLS                 // port 587, STARTTLS exigé
	texteClair                  // tout autre port, boucle locale seulement (tests)
)

// mode : 465 → TLS implicite, 587 → STARTTLS obligatoire ; tout autre port : texte clair,
// refusé hors de la boucle locale (conception §8.1 ; même règle que config.comptesFromEnv,
// revérifiée ici).
func mode(c config.SMTP) (modeTLS, error) {
	switch c.Port {
	case 465:
		return tlsImplicite, nil
	case 587:
		return tlsStartTLS, nil
	}
	if c.Host == "localhost" {
		return texteClair, nil
	}
	if a, err := netip.ParseAddr(c.Host); err == nil && a.Unmap().IsLoopback() {
		return texteClair, nil
	}
	return 0, errors.New("courriel : texte clair refusé hors de la boucle locale (ports 465 ou 587 seulement)")
}

// Mettre ajoute m à la file, sans attendre. ErrInvalide : adresse hors du « dot-atom » ASCII
// (aucun espace, chevron ni saut de ligne : rien ne peut ajouter un en-tête ou une commande
// SMTP), langue autre que fr et en, code autre que 6 chiffres ASCII. ErrPlein : 256 en file.
func (e *Envoyeur) Mettre(m Message) error {
	if !adresseOK(m.A) || !codeOK(m.Code) || (m.Langue != "fr" && m.Langue != "en") {
		return ErrInvalide
	}
	select {
	case e.file <- m:
		return nil
	default:
		return ErrPlein
	}
}

// Plein : la file est pleine (Mettre rendrait ErrPlein maintenant).
func (e *Envoyeur) Plein() bool { return len(e.file) >= cap(e.file) }

// Run envoie les messages de la file, un à la fois, jusqu'à l'annulation de ctx (les messages
// restants sont alors oubliés). Une seule instance à la fois.
func (e *Envoyeur) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-e.file:
			e.traiter(ctx, m)
		}
	}
}

// traiter : au plus deux essais ; un refus définitif du serveur (code 5xx) n'est pas réessayé.
// Toute erreur est oubliée : elle peut citer l'adresse (réponse du serveur), elle ne sort pas.
func (e *Envoyeur) traiter(ctx context.Context, m Message) {
	var id [16]byte
	rand.Read(id[:]) // crypto/rand ne renvoie pas d'erreur sous Linux
	brut := composer(e.c.From, m, e.now(), "<"+hex.EncodeToString(id[:])+"@"+e.domaine+">")
	defer clear(brut)
	for i := 0; i < essais; i++ {
		if i > 0 {
			t := time.NewTimer(e.pause)
			select {
			case <-ctx.Done():
				t.Stop()
				return
			case <-t.C:
			}
		}
		err := e.envoyer(ctx, m.A, brut)
		if err == nil || definitif(err) || ctx.Err() != nil {
			return
		}
	}
}

func codeOK(c string) bool {
	if len(c) != 6 {
		return false
	}
	for i := 0; i < len(c); i++ {
		if c[i] < '0' || c[i] > '9' {
			return false
		}
	}
	return true
}

// adresseOK : partie locale en « dot-atom » ASCII (RFC 5322), domaine [A-Za-z0-9.-], un seul
// « @ », 254 caractères au plus. Plus strict que nécessaire pour SMTP : c'est la même forme que
// compte.Normaliser accepte.
func adresseOK(a string) bool {
	local, dom, ok := strings.Cut(a, "@")
	if !ok || len(a) > 254 || local == "" || len(local) > 64 || dom == "" {
		return false
	}
	for _, p := range [2]string{local, dom} {
		if p[0] == '.' || p[len(p)-1] == '.' || strings.Contains(p, "..") {
			return false
		}
	}
	for i := 0; i < len(local); i++ {
		c := local[i]
		if !alnum(c) && c != '.' && !strings.ContainsRune("!#$%&'*+/=?^_`{|}~-", rune(c)) {
			return false
		}
	}
	for i := 0; i < len(dom); i++ {
		if c := dom[i]; !alnum(c) && c != '.' && c != '-' {
			return false
		}
	}
	return true
}

func alnum(c byte) bool { return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' }
