package usage

import (
	"reflect"
	"testing"
)

func TestCompteurs(t *testing.T) {
	var c Counters
	if c.Snapshot() != (Snapshot{}) {
		t.Fatal("valeur zéro non nulle")
	}
	c.PartageCree()
	c.EnvoiTermine()
	c.Deverrouillage()
	c.Deverrouillage()
	c.Destruction()
	c.RefusDebit()
	c.Recu(10)
	c.Recu(5)
	c.Servi(7)
	c.SalonCree()
	c.EntreeSalon()
	want := Snapshot{PartagesCrees: 1, EnvoisTermines: 1, Deverrouillages: 2, Destructions: 1, RefusDebit: 1,
		OctetsRecus: 15, OctetsServis: 7, SalonsCrees: 1, EntreesSalon: 1}
	if got := c.Snapshot(); got != want {
		t.Fatalf("%+v", got)
	}
}

// Rien par personne ni par partage : les deux types ne portent que des entiers. Une table,
// une liste, une chaîne ou une date ajoutée plus tard fait échouer ce test.
func TestQueDesEntiers(t *testing.T) {
	for _, ty := range []reflect.Type{reflect.TypeOf(Snapshot{}), reflect.TypeOf(Counters{})} {
		for i := 0; i < ty.NumField(); i++ {
			f := ty.Field(i)
			if k := f.Type.Kind(); k != reflect.Int64 && f.Type.String() != "atomic.Int64" {
				t.Errorf("%s.%s : %s (seuls des entiers sont permis)", ty.Name(), f.Name, f.Type)
			}
		}
	}
}
