package main

import (
	"fmt"
	"os"

	"github.com/skoow/shhdrop/server/internal/config"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: shhdrop serve|admin")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		// Placeholder : une tâche ultérieure démarrera le serveur.
		if _, err := config.FromEnv(); err != nil {
			fmt.Fprintln(os.Stderr, "erreur:", err)
			os.Exit(1)
		}
		fmt.Fprintln(os.Stderr, "serve: pas encore implémenté")
		os.Exit(1)
	case "admin":
		fmt.Fprintln(os.Stderr, "admin: pas encore implémenté")
		os.Exit(1)
	default:
		fmt.Fprintf(os.Stderr, "commande inconnue: %s\n", os.Args[1])
		os.Exit(2)
	}
}
