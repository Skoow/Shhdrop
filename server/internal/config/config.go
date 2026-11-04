// Package config lit la configuration du serveur depuis l'environnement.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	DataDir         string
	Listen          string
	StorageMaxBytes int64
	// BehindProxy (SHH_BEHIND_PROXY=1) : une requête locale sans X-Shh-Client-IP
	// valide est refusée au lieu de partager les limites de l'adresse locale.
	BehindProxy bool
	StaticDir   string // SHH_STATIC_DIR : fichiers du site (web/dist) ; vide = page d'attente
	Now         func() time.Time
}

func FromEnv() (Config, error) {
	c := Config{
		DataDir:         os.Getenv("SHH_DATA_DIR"),
		Listen:          "127.0.0.1:8080",
		StorageMaxBytes: 107374182400, // 100 Gio (spec §24)
		Now:             time.Now,
	}
	if c.DataDir == "" {
		return Config{}, errors.New("SHH_DATA_DIR est obligatoire")
	}
	if v := os.Getenv("SHH_LISTEN"); v != "" {
		c.Listen = v
	}
	if v := os.Getenv("SHH_STORAGE_MAX"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n <= 0 {
			return Config{}, fmt.Errorf("SHH_STORAGE_MAX invalide: %q", v)
		}
		c.StorageMaxBytes = n
	}
	switch v := os.Getenv("SHH_BEHIND_PROXY"); v {
	case "", "0":
	case "1":
		c.BehindProxy = true
	default:
		return Config{}, fmt.Errorf("SHH_BEHIND_PROXY invalide (0 ou 1): %q", v)
	}
	c.StaticDir = os.Getenv("SHH_STATIC_DIR")
	return c, nil
}
