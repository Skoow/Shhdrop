package courriel

import (
	"bytes"
	"mime/quotedprintable"
	"time"
)

// Le seul modèle d'e-mail du serveur (conception du compte §21.3, décision 2 du propriétaire :
// rien d'autre qu'un code). Il sert à tous les envois (inscription, récupération, nouvelle
// adresse) : ni pseudo, ni lien, ni nom de salon ou de partage, ni raison de l'envoi, ni date de
// création, ni adresse IP. Il n'existe aucun autre texte d'e-mail dans le serveur (testé).

// texte : objet et corps (lignes séparées par CRLF) dans la langue de la requête ; ok faux pour
// une langue inconnue. Le corps anglais n'est pas écrit dans la conception (§21.3 ne donne que
// l'objet) : traduction du lot 3, à relire par le propriétaire avec en.ts (§19).
func texte(langue, code string) (objet, corps string, ok bool) {
	c := code[:3] + " " + code[3:]
	switch langue {
	case "fr":
		return "Votre code Shhgone",
			"Votre code : " + c + "\r\nIl expire dans 15 minutes.\r\nSi vous n'avez rien demandé, ignorez ce message.\r\n", true
	case "en":
		return "Your Shhgone code",
			"Your code: " + c + "\r\nIt expires in 15 minutes.\r\nIf you did not ask for anything, ignore this message.\r\n", true
	}
	return "", "", false
}

// composer : le message entier (RFC 5322), en-têtes exactement From, To, Subject, Date,
// Message-ID, MIME-Version, Content-Type, Content-Transfer-Encoding (§21.3). m est déjà
// validé (Mettre) : aucune valeur ne contient de saut de ligne.
func composer(from string, m Message, date time.Time, messageID string) []byte {
	objet, corps, _ := texte(m.Langue, m.Code)
	var b bytes.Buffer
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + m.A + "\r\n")
	b.WriteString("Subject: " + objet + "\r\n")
	b.WriteString("Date: " + date.UTC().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("Message-ID: " + messageID + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
	w := quotedprintable.NewWriter(&b)
	w.Write([]byte(corps)) // écrit dans un bytes.Buffer : aucune erreur possible
	w.Close()
	return b.Bytes()
}
