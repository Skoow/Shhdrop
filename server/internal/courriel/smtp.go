package courriel

// Seul fichier du serveur qui ouvre une connexion sortante hors du repli reCAPTCHA
// (TestNoOutgoingHTTP, spec §35.1, conception du compte §15) : vers SHH_SMTP_HOST seulement,
// en TLS 1.2 au moins avec vérification du certificat pour ce nom (TLS implicite sur 465,
// STARTTLS exigé sur 587, jamais de repli en clair). Texte clair : boucle locale seulement.

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/smtp"
	"net/textproto"
	"strconv"
	"time"
)

var errSansStartTLS = errors.New("courriel : STARTTLS non annoncé (aucun repli en clair)")

// envoyer : une session SMTP complète pour un message, bornée par e.delai. Le nom annoncé
// (EHLO) est celui par défaut de net/smtp, « localhost » : ni nom de machine, ni adresse.
func (e *Envoyeur) envoyer(ctx context.Context, a string, brut []byte) error {
	md, err := mode(e.c)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, e.delai)
	defer cancel()
	port := e.c.Port
	if e.portDial != 0 {
		port = e.portDial
	}
	adresse := net.JoinHostPort(e.c.Host, strconv.Itoa(port))
	conf := &tls.Config{ServerName: e.c.Host, MinVersion: tls.VersionTLS12, RootCAs: e.racines}
	nd := &net.Dialer{Timeout: e.delai}
	var conn net.Conn
	if md == tlsImplicite {
		conn, err = (&tls.Dialer{NetDialer: nd, Config: conf}).DialContext(ctx, "tcp", adresse)
	} else {
		conn, err = nd.DialContext(ctx, "tcp", adresse)
	}
	if err != nil {
		return err
	}
	defer conn.Close()
	fin, _ := ctx.Deadline()
	if err := conn.SetDeadline(fin); err != nil {
		return err
	}
	// Annulation de ctx (arrêt du serveur) : la connexion est fermée, la session s'arrête.
	stop := context.AfterFunc(ctx, func() { conn.SetDeadline(time.Unix(1, 0)) })
	defer stop()
	c, err := smtp.NewClient(conn, e.c.Host)
	if err != nil {
		return err
	}
	defer c.Close()
	if md == tlsStartTLS {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return errSansStartTLS
		}
		if err := c.StartTLS(conf); err != nil {
			return err
		}
	}
	// PlainAuth refuse lui-même d'envoyer le mot de passe hors TLS, sauf vers la boucle locale.
	if err := c.Auth(smtp.PlainAuth("", e.c.User, string(e.mdp), e.c.Host)); err != nil {
		return err
	}
	if err := c.Mail(e.enveloppe); err != nil {
		return err
	}
	if err := c.Rcpt(a); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(brut); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	c.Quit() // message accepté (250 après DATA) : une erreur ici ne doit pas le renvoyer
	return nil
}

// definitif : refus définitif du serveur (5xx) : un nouvel essai n'y changerait rien.
func definitif(err error) bool {
	var p *textproto.Error
	return errors.As(err, &p) && p.Code >= 500
}
