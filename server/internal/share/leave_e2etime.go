//go:build e2etime

package share

import (
	"os"
	"strconv"
)

// Binaire des tests de bout en bout seulement (go build -tags e2etime, ui-e2e/global-setup.ts) :
// SHH_E2E_LEAVE_DELAY (secondes, 1 à 180) raccourcit l'attente après « je pars » (D41-28).
// Absent du binaire livré : l'étiquette n'est jamais posée par la CI de mise en ligne.
func init() {
	if n, err := strconv.Atoi(os.Getenv("SHH_E2E_LEAVE_DELAY")); err == nil && n >= 1 && n <= LeaveDelay {
		leaveDelay = int64(n)
	}
}
