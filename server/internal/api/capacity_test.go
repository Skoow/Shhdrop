package api

import "testing"

// Capacité réglée (config.Capacity, SHH_*) : appliquée aux places du serveur ; valeur nulle :
// valeurs par défaut.
func TestCapaciteAppliquee(t *testing.T) {
	s := newServerCap(nil, nil, nil, nil, false, nil, Capacity{Uploads: 300, Downloads: 1000, Watches: 70, WebSockets: 9})
	if s.xfer.ul.Total() != 300 || s.xfer.dl.Total() != 1000 || s.watchSlots.Total() != 70 || s.wsSlots.Total() != 9 {
		t.Fatal(s.xfer.ul.Total(), s.xfer.dl.Total(), s.watchSlots.Total(), s.wsSlots.Total())
	}
	s = newServer(nil, nil, nil, nil, false, nil)
	if s.xfer.ul.Total() != ulTotal || s.xfer.dl.Total() != dlTotal || s.watchSlots.Total() != watchTotal || s.wsSlots.Total() != wsTotal {
		t.Fatal("valeurs par défaut")
	}
}
