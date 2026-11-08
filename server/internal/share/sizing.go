package share

// Dimensions du paquet chiffré, miroir exact du code TypeScript (spec §7.3).
// Paliers gratuits (spec §24, §29.3, §41.2) : le dernier morceau de chaque palier est réservé
// au manifeste, donc le palier 1 sert au texte seul et le plus grand (32 769 morceaux, 513
// segments dont le dernier d'un seul morceau) contient exactement 2 Gio de données.
var Buckets = []int{1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16385, 32769}

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
func segOffset(bucket, n int) int64 {
	if n == 0 {
		return 0
	}
	return Header + int64(n)*SegChunks*ChunkCT
}

// totalSize : taille réservée pour un palier.
// int64 : 2 148 073 536 octets pour le palier de 2 Gio dépassent un int de 32 bits.
func totalSize(bucket int) int64 { return Header + int64(bucket)*ChunkCT }

// ContentBytes : données utiles d'un palier (le dernier morceau est celui du manifeste),
// unité des quotas d'octets (spec §4, §24) : 0 pour le palier 1, 2 Gio pour le plus grand.
func ContentBytes(bucket int) int64 { return int64(bucket-1) * 65536 }

// ValidBucket : b est un palier gratuit (spec §41.2).
func ValidBucket(b int) bool { return validBucket(b) }
