package share

// Dimensions du paquet chiffré, miroir exact du code TypeScript (spec §7.3).
var Buckets = []int{1, 16, 80, 160, 400, 800, 1600}

const (
	ChunkCT   = 65552 // morceau chiffré : 64 Kio + tag GCM
	Header    = 48    // en-tête en clair, dans le segment 0
	SegChunks = 64    // morceaux par segment de transport
)

func validBucket(b int) bool {
	for _, v := range Buckets {
		if v == b {
			return true
		}
	}
	return false
}

// SegmentCount = ceil(bucket / 64).
func SegmentCount(bucket int) int { return (bucket + SegChunks - 1) / SegChunks }

// SegmentSize : taille exacte du segment n (l'en-tête est dans le segment 0).
func SegmentSize(bucket, n int) int {
	chunks := min(SegChunks, bucket-n*SegChunks)
	size := chunks * ChunkCT
	if n == 0 {
		size += Header
	}
	return size
}

// segOffset : position du segment n dans le fichier (somme des segments précédents).
func segOffset(bucket, n int) int {
	if n == 0 {
		return 0
	}
	return Header + n*SegChunks*ChunkCT
}

// totalSize : taille réservée pour un palier.
func totalSize(bucket int) int { return Header + bucket*ChunkCT }
