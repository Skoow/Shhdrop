//! Génère la table des émojis « fully-qualified » de `data/emoji-test-15.0.txt` (Unicode emoji
//! 15.0, UTS #51) : un tableau trié de séquences, consulté par recherche dichotomique.
use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-changed=data/emoji-test-15.0.txt");
    println!("cargo:rerun-if-changed=build.rs");
    let source = fs::read_to_string("data/emoji-test-15.0.txt").expect("emoji-test-15.0.txt");
    let mut liste: Vec<String> = source
        .lines()
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| {
            let (code, reste) = l.split_once(';')?;
            if reste.split('#').next()?.trim() != "fully-qualified" {
                return None;
            }
            let s: String = code
                .split_whitespace()
                .map(|h| char::from_u32(u32::from_str_radix(h, 16).expect("hex")).expect("char"))
                .collect();
            Some(s)
        })
        .collect();
    liste.sort();
    liste.dedup();
    let mut out = format!("pub static EMOJIS: [&str; {}] = [\n", liste.len());
    for s in &liste {
        out.push_str(&format!("    {:?},\n", s));
    }
    out.push_str("];\n");
    let dest = Path::new(&env::var("OUT_DIR").unwrap()).join("emojis.rs");
    fs::write(dest, out).unwrap();
}
