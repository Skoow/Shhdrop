//! Chrono natif d'Argon2id avec les paramètres de création (`cargo bench -p shhdrop-core`) :
//! médiane de 15 appels après un appel d'échauffement. La mesure qui décide est celle du
//! navigateur (WebAssembly, Chromium) ; celle-ci sert de repère sur la machine.
use shhdrop_core::kdf::{KDF_CREATE, password_key};
use std::time::Instant;

fn main() {
    let salt = [7u8; 16];
    let run = || {
        let t = Instant::now();
        let k = password_key("aC3!cD5?#Fg", &salt, KDF_CREATE.ops, KDF_CREATE.mem).unwrap();
        std::hint::black_box(k.as_bytes());
        t.elapsed().as_secs_f64() * 1000.0
    };
    let first = run();
    let mut ms: Vec<f64> = (0..15).map(|_| run()).collect();
    ms.sort_by(f64::total_cmp);
    println!(
        "argon2id natif : premier {first:.0} ms, médiane {:.0} ms, min {:.0} ms, IQR {:.0} ms",
        ms[7],
        ms[0],
        ms[11] - ms[3]
    );
}
