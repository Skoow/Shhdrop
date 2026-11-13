package share

// waitBackgroundSync : attend les synchronisations de fond (tests).
func (s *Service) waitBackgroundSync() { s.bgSync.Wait() }
