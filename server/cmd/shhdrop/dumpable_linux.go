//go:build linux

package main

import "golang.org/x/sys/unix"

// durcirProcessus : PR_SET_DUMPABLE(0) interdit au noyau d'écrire un core dump du processus et
// retire à un autre processus le droit de lire /proc/<pid>/mem, /proc/<pid>/maps, etc. (ils
// passent à root:root, non lisibles par le service non privilégié). Les clés de conversation du
// salon vivent en mémoire : c'est une ceinture, en plus de ulimits.core=0 et memswap=mem du
// conteneur (audit adverse du 13 novembre, Z2). Sans effet sur le fonctionnement. Une erreur
// (noyau sans prctl) n'empêche pas de démarrer : le durcissement du conteneur reste.
func durcirProcessus() {
	_ = unix.Prctl(unix.PR_SET_DUMPABLE, 0, 0, 0, 0)
}
