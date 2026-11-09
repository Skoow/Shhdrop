//go:build !e2etime

package share

import "testing"

// Le binaire livré n'a aucun réglage de l'attente après « je pars » (D41-28) : 3 min.
func TestLeaveDelayFixedInProduction(t *testing.T) {
	t.Setenv("SHH_E2E_LEAVE_DELAY", "1")
	if leaveDelay != 180 || LeaveDelay != 180 {
		t.Fatal(leaveDelay)
	}
}
