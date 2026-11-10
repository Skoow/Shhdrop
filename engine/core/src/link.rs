//! Liens de partage et de gestion (spec §32, `transfer/link.ts`) : à la racine du site, le secret
//! après le « # ». Le fragment n'est jamais envoyé au serveur ; ni le lien ni la page ne portent
//! d'identifiant (l'id du partage se calcule à partir de K_lien).
use crate::encoding::{b64u, unb64u};
use crate::error::{Error, Result};
use crate::keys::{KLien, SGestion};
use crate::whatwg::Url;
use zeroize::{Zeroize, Zeroizing};

/// Lien analysé : K_lien pour un lien de partage, S_gestion pour un lien de gestion.
#[derive(Debug)]
pub enum ParsedLink {
    Share { origin: String, k_lien: KLien },
    Manage { origin: String, s_gestion: SGestion },
}

/// Secret de 32 octets en base64url sans bourrage : 43 caractères.
pub const KEY_CHARS: usize = 43;

fn is_b64u_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'-' || c == b'_'
}

/// `^#[A-Za-z0-9_-]{43}$` (lien de partage) : rend les 43 caractères.
fn share_fragment(hash: &str) -> Option<&str> {
    hash.strip_prefix('#')
        .filter(|k| k.len() == KEY_CHARS && k.bytes().all(is_b64u_char))
}

/// `^#m[A-Za-z0-9_-]{43}$` (lien de gestion) : rend les 43 caractères. Les longueurs (44 et 45)
/// diffèrent : aucun fragment n'a les deux formes.
fn manage_fragment(hash: &str) -> Option<&str> {
    hash.strip_prefix("#m")
        .filter(|k| k.len() == KEY_CHARS && k.bytes().all(is_b64u_char))
}

const LOCAL: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// https: obligatoire, sauf http: vers la boucle locale (développement et tests).
fn allowed_scheme(u: &Url) -> bool {
    u.scheme() == "https" || (u.scheme() == "http" && LOCAL.contains(&u.hostname()))
}

/// Vérifie une origine (audit F1) : forme canonique exacte `https://hôte[:port]` (http seulement
/// pour localhost, 127.0.0.1, [::1]), sans chemin, requête, fragment ni identifiants.
pub fn check_origin(origin: &str) -> Result<String> {
    match Url::parse(origin) {
        Some(u) if u.origin() == origin && allowed_scheme(&u) => Ok(origin.to_owned()),
        _ => Err(Error::OrigineInvalide),
    }
}

/// Base de dépôt : `^/(?:[A-Za-z0-9_-]+/)*$` (« / » en production, « /shhdrop/ » pour la démo).
fn check_base(base: &str) -> Result<&str> {
    let ok = base.strip_prefix('/').is_some_and(|rest| {
        rest.is_empty()
            || rest.strip_suffix('/').is_some_and(|segs| {
                segs.split('/')
                    .all(|seg| !seg.is_empty() && seg.bytes().all(is_b64u_char))
            })
    });
    if ok {
        Ok(base)
    } else {
        Err(Error::BaseInvalide)
    }
}

/// `{origine}{base}#{K_lien}` : 45 caractères de plus que l'origine avec la base « / ».
pub fn share_link(origin: &str, k_lien: &KLien, base: &str) -> Result<String> {
    let origin = check_origin(origin)?;
    let base = check_base(base)?;
    Ok(format!("{origin}{base}#{}", b64u(k_lien.as_bytes())))
}

/// `{origine}{base}#m{S_gestion}`.
pub fn manage_link(origin: &str, s_gestion: &SGestion, base: &str) -> Result<String> {
    let origin = check_origin(origin)?;
    let base = check_base(base)?;
    Ok(format!("{origin}{base}#m{}", b64u(s_gestion.as_bytes())))
}

/// Décodage strict : 43 caractères, encodage canonique, 32 octets.
fn strict(s: &str) -> Result<[u8; 32]> {
    let b = Zeroizing::new(unb64u(s).map_err(|_| Error::LienInvalide)?);
    b.as_slice().try_into().map_err(|_| Error::LienInvalide)
}

/// Analyse un lien : chemin égal à `base` exactement (`/shhdrop` sans barre finale toléré pour
/// la démo), sans identifiants dans l'adresse. La requête est ignorée (les messageries ajoutent
/// `?fbclid=…` en gardant le fragment). L'origine attendue n'est pas vérifiée ici : l'appelant
/// compare `origin` à la sienne.
pub fn parse_link(url: &str, base: &str) -> Result<ParsedLink> {
    check_base(base)?;
    let u = Url::parse(url).ok_or(Error::LienInvalide)?;
    if !allowed_scheme(&u) || u.has_credentials() {
        return Err(Error::LienInvalide);
    }
    let path = u.pathname();
    if path != base && format!("{path}/") != base {
        return Err(Error::LienInvalide);
    }
    let hash = u.hash();
    if let Some(k) = share_fragment(&hash) {
        let k_lien = KLien::from_bytes(strict(k)?);
        return Ok(ParsedLink::Share {
            origin: u.origin(),
            k_lien,
        });
    }
    if let Some(s) = manage_fragment(&hash) {
        let s_gestion = SGestion::from_bytes(strict(s)?);
        return Ok(ParsedLink::Manage {
            origin: u.origin(),
            s_gestion,
        });
    }
    Err(Error::LienInvalide)
}

/// Lien de partage suivi du mot de passe (QR code, D41-29) : `{lien}.{base64url(UTF-8)}`. Le
/// « . » n'est pas dans l'alphabet base64url : aucune ambiguïté avec un lien simple. Refuse
/// (`lien_invalide`) tout lien qui n'est pas un lien de partage, un mot de passe vide ou un
/// mot de passe encodé sur plus de 64 caractères.
pub fn share_link_with_password(link: &str, password: &str) -> Result<String> {
    // JavaScript levait « Invalid URL » sur une adresse illisible : ici, `lien_invalide`.
    let u = Url::parse(link).ok_or(Error::LienInvalide)?;
    if share_fragment(&u.hash()).is_none() || password.is_empty() {
        return Err(Error::LienInvalide);
    }
    let pw = Zeroizing::new(b64u(password.as_bytes()));
    if pw.len() > 64 {
        return Err(Error::LienInvalide);
    }
    Ok(format!("{link}.{}", pw.as_str()))
}

/// Mot de passe du fragment : base64url canonique de 2 à 64 caractères, UTF-8 valide, une
/// marque d'ordre d'octets en tête retirée (comme `TextDecoder`), non vide.
fn decode_password(s: &str) -> Option<String> {
    if !(2..=64).contains(&s.len()) || !s.bytes().all(is_b64u_char) {
        return None;
    }
    let bytes = unb64u(s).ok()?;
    let mut pw = match String::from_utf8(bytes) {
        Ok(pw) => pw,
        Err(e) => {
            e.into_bytes().zeroize();
            return None;
        }
    };
    if pw.starts_with('\u{feff}') {
        pw.drain(..'\u{feff}'.len_utf8());
    }
    if pw.is_empty() { None } else { Some(pw) }
}

/// Sépare le mot de passe d'un lien de QR code (D41-29), sans jamais échouer : un fragment
/// `#<K_lien>.<…>` rend le lien simple (`href` normalisé) et le mot de passe s'il est lisible
/// (sinon `None` : écran de saisie normal) ; tout autre lien est rendu tel quel.
pub fn split_password(href: &str) -> (String, Option<String>) {
    let Some(mut u) = Url::parse(href) else {
        return (href.to_owned(), None);
    };
    let hash = u.hash();
    let Some((k, rest)) = hash
        .strip_prefix('#')
        .and_then(|h| h.split_at_checked(KEY_CHARS))
        .filter(|(k, rest)| k.bytes().all(is_b64u_char) && rest.starts_with('.'))
    else {
        return (href.to_owned(), None);
    };
    let password = decode_password(&rest[1..]);
    u.set_fragment(k);
    (u.href(), password)
}

#[cfg(test)]
mod tests {
    // Cas de web/src/transfer/link.test.ts, portés un à un.
    use super::*;

    const K1: [u8; 32] = [1; 32];

    fn k() -> String {
        b64u(&K1) // 43 caractères
    }

    fn kind(p: &ParsedLink) -> char {
        match p {
            ParsedLink::Share { .. } => 's',
            ParsedLink::Manage { .. } => 'm',
        }
    }

    fn origin(p: &ParsedLink) -> &str {
        match p {
            ParsedLink::Share { origin, .. } | ParsedLink::Manage { origin, .. } => origin,
        }
    }

    fn key(p: &ParsedLink) -> [u8; 32] {
        match p {
            ParsedLink::Share { k_lien, .. } => *k_lien.as_bytes(),
            ParsedLink::Manage { s_gestion, .. } => *s_gestion.as_bytes(),
        }
    }

    fn err(r: Result<ParsedLink>) -> Error {
        r.expect_err("refus attendu")
    }

    /// Forme d'un lien de partage de production (SHARE_LINK_SHAPE de link.ts) :
    /// `https://[a-z0-9.-]+(:\d+)?/#` + 43 caractères base64url.
    fn production_shape(l: &str) -> bool {
        let Some(rest) = l.strip_prefix("https://") else {
            return false;
        };
        let Some((host, frag)) = rest.split_once("/#") else {
            return false;
        };
        let (h, port) = host.split_once(':').unwrap_or((host, "1"));
        !h.is_empty()
            && h.bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'.' || c == b'-')
            && !port.is_empty()
            && port.bytes().all(|c| c.is_ascii_digit())
            && share_fragment(&format!("#{frag}")).is_some()
    }

    #[test]
    fn aller_retour_share_link() {
        let kl = KLien::from_bytes([9; 32]);
        let link = share_link("https://shhdrop.example", &kl, "/").unwrap();
        assert_eq!(link, format!("https://shhdrop.example/#{}", b64u(&[9; 32])));
        assert_eq!(link.len(), "https://shhdrop.example".len() + 45);
        assert!(production_shape(&link));
        assert_eq!(
            share_link("https://shhdrop.app", &kl, "/").unwrap().len(),
            64
        );
        let p = parse_link(&link, "/").unwrap();
        assert_eq!(kind(&p), 's');
        assert_eq!(origin(&p), "https://shhdrop.example");
        assert_eq!(key(&p), [9; 32]);
    }

    #[test]
    fn aller_retour_manage_link() {
        let s = SGestion::from_bytes([5; 32]);
        let link = manage_link("http://127.0.0.1:4000", &s, "/").unwrap();
        assert_eq!(link, format!("http://127.0.0.1:4000/#m{}", b64u(&[5; 32])));
        let p = parse_link(&link, "/").unwrap();
        assert_eq!(kind(&p), 'm');
        assert_eq!(key(&p), [5; 32]);
        assert!(!production_shape(&link));
    }

    #[test]
    fn secret_qui_commence_par_m() {
        let km = format!("m{}", &k()[1..]);
        assert_eq!(
            kind(&parse_link(&format!("https://x.test/#{km}"), "/").unwrap()),
            's'
        );
        assert_eq!(
            kind(&parse_link(&format!("https://x.test/#m{km}"), "/").unwrap()),
            'm'
        );
    }

    #[test]
    fn formes_de_fragment() {
        let k = k();
        assert!(share_fragment(&format!("#{k}")).is_some());
        assert!(manage_fragment(&format!("#m{k}")).is_some());
        for h in [
            String::new(),
            "#".into(),
            format!("#{}", &k[1..]),
            format!("#{k}A"),
            format!("#m{}", &k[2..]),
            format!("#{}+", &k[1..]),
            format!("#{k} "),
        ] {
            assert!(
                share_fragment(&h).is_none() && manage_fragment(&h).is_none(),
                "{h}"
            );
        }
    }

    #[test]
    fn refuse_les_liens_invalides() {
        let k = k();
        let k42 = &k[..42];
        let bad = [
            "pas une url".to_owned(),
            "https://x/".into(),
            "https://x/#".into(),
            format!("https://x/#{}", &k[1..]),
            format!("https://x/#{k}A"),
            format!("https://x/#m{}", &k[2..]),
            format!("https://x/#m{k}A"),
            format!("https://x/#{k42}+"),
            format!("https://x/#{k42}="),
            format!("https://x/#{k42}B"), // non canonique (bits de bourrage)
            format!("https://x/#{k}="),
            format!("https://x/#x{k}"),
            format!("https://x/x#{k}"),
            format!("https://x/s#{k}"),
            format!("https://x/s/AAAAAAAAAAAAAAAAAAAAAA#{k}"),
            format!("https://x/m/AAAAAAAAAAAAAAAAAAAAAA#{k}"),
            format!("https://x//#{k}"),
            format!("https://x/shhdrop/#{k}"),
            // Lien collé abîmé (Review Focus 3) : point, parenthèse, « #M » majuscule.
            format!("https://x/#{k}."),
            format!("https://x/#{k})"),
            format!("https://x/#M{k}"),
        ];
        for u in bad {
            assert_eq!(err(parse_link(&u, "/")), Error::LienInvalide, "{u}");
        }
    }

    #[test]
    fn requete_ignoree() {
        let p = parse_link(&format!("https://x.test/?fbclid=abc&utm=1#{}", k()), "/").unwrap();
        assert_eq!(kind(&p), 's');
        assert_eq!(key(&p), K1);
        assert_eq!(origin(&p), "https://x.test");
    }

    #[test]
    fn base_de_demo() {
        let k = k();
        let kl = KLien::from_bytes([3; 32]);
        let link = share_link("https://skoow.github.io", &kl, "/shhdrop/").unwrap();
        assert_eq!(
            link,
            format!("https://skoow.github.io/shhdrop/#{}", b64u(&[3; 32]))
        );
        let p = parse_link(&link, "/shhdrop/").unwrap();
        assert_eq!(
            (kind(&p), origin(&p), key(&p)),
            ('s', "https://skoow.github.io", [3; 32])
        );
        let u = format!("https://skoow.github.io/shhdrop#{k}");
        assert_eq!(kind(&parse_link(&u, "/shhdrop/").unwrap()), 's');
        let s = SGestion::from_bytes([4; 32]);
        let m = manage_link("https://skoow.github.io", &s, "/shhdrop/").unwrap();
        let p = parse_link(&m, "/shhdrop/").unwrap();
        assert_eq!(
            (kind(&p), origin(&p), key(&p)),
            ('m', "https://skoow.github.io", [4; 32])
        );
        for u in [
            format!("https://x/#{k}"),
            format!("https://x/shhdropx/#{k}"),
            format!("https://x/shhdrop/shhdrop/#{k}"),
            format!("https://x/shhdrop/s#{k}"),
        ] {
            assert_eq!(err(parse_link(&u, "/shhdrop/")), Error::LienInvalide, "{u}");
        }
        for b in ["", "Shhdrop/", "/shhdrop", "//", "/a b/"] {
            assert_eq!(
                err(parse_link(&format!("https://x/#{k}"), b)),
                Error::BaseInvalide,
                "{b}"
            );
            let r = share_link("https://x.test", &KLien::from_bytes([0; 32]), b);
            assert_eq!(r, Err(Error::BaseInvalide), "{b}");
        }
    }

    #[test]
    fn http_seulement_en_boucle_locale() {
        let k = k();
        for host in [
            "localhost",
            "localhost:8080",
            "127.0.0.1",
            "127.0.0.1:4000",
            "[::1]",
            "[::1]:4000",
        ] {
            assert_eq!(
                kind(&parse_link(&format!("http://{host}/#{k}"), "/").unwrap()),
                's',
                "{host}"
            );
        }
        for host in [
            "shhdrop.example",
            "127.0.0.2",
            "10.0.0.1",
            "localhost.example",
            "[::2]",
        ] {
            assert_eq!(
                err(parse_link(&format!("http://{host}/#{k}"), "/")),
                Error::LienInvalide,
                "{host}"
            );
        }
        for proto in ["ftp:", "file:", "javascript:"] {
            assert_eq!(
                err(parse_link(&format!("{proto}//x/#{k}"), "/")),
                Error::LienInvalide,
                "{proto}"
            );
        }
    }

    #[test]
    fn le_lien_ne_porte_que_la_cle() {
        let kl = KLien::from_bytes([8; 32]);
        let link = share_link("https://shhdrop.app", &kl, "/").unwrap();
        assert!(!link.contains("Ab3!xY7#"));
        assert_eq!(&link["https://shhdrop.app/#".len()..], b64u(&[8; 32]));
    }

    #[test]
    fn origine_et_identifiants() {
        let k = k();
        assert_eq!(
            origin(&parse_link(&format!("https://srv.test:8443/#{k}"), "/").unwrap()),
            "https://srv.test:8443"
        );
        for u in [
            format!("https://user:pw@srv.test/#{k}"),
            format!("https://user@srv.test/#{k}"),
            format!("https://:pw@srv.test/#{k}"),
        ] {
            assert_eq!(err(parse_link(&u, "/")), Error::LienInvalide, "{u}");
        }
        assert_eq!(
            origin(&parse_link(&format!("https://autre.example/#{k}"), "/").unwrap()),
            "https://autre.example"
        );
    }

    #[test]
    fn check_origin_cas() {
        for o in [
            "https://srv.test",
            "https://srv.test:8443",
            "http://localhost:8080",
            "http://127.0.0.1:4000",
            "http://[::1]:4000",
        ] {
            assert_eq!(check_origin(o).as_deref(), Ok(o));
        }
        for o in [
            "http://srv.test/",
            "https://srv.test/",
            "https://srv.test/app",
            "https://srv.test?x=1",
            "https://srv.test#x",
            "https://u:p@srv.test",
            "http://srv.test",
            "ftp://srv.test",
            "srv.test",
            "",
            "HTTPS://SRV.TEST",
        ] {
            assert_eq!(check_origin(o), Err(Error::OrigineInvalide), "{o}");
        }
    }

    #[test]
    fn share_et_manage_valident_l_origine() {
        let kl = KLien::from_bytes([0; 32]);
        assert_eq!(
            share_link("http://srv.test/", &kl, "/"),
            Err(Error::OrigineInvalide)
        );
        let s = SGestion::from_bytes([0; 32]);
        assert_eq!(
            manage_link("https://srv.test/x", &s, "/"),
            Err(Error::OrigineInvalide)
        );
    }

    #[test]
    fn lien_et_mot_de_passe_du_qr() {
        let kl = KLien::from_bytes([7; 32]);
        let link = share_link("https://shhdrop.test", &kl, "/").unwrap();
        let pw = "aC3!cD5?#Fg";
        let q = share_link_with_password(&link, pw).unwrap();
        assert_eq!(q, format!("{link}.YUMzIWNENT8jRmc"));
        let frag = &q[q.find('#').unwrap()..];
        assert!(share_fragment(frag).is_none());
        assert_eq!(split_password(&q), (link.clone(), Some(pw.to_owned())));
        assert_eq!(kind(&parse_link(&split_password(&q).0, "/").unwrap()), 's');
        assert_eq!(
            share_link_with_password(&link, ""),
            Err(Error::LienInvalide)
        );
        let s = SGestion::from_bytes([7; 32]);
        let m = manage_link("https://shhdrop.test", &s, "/").unwrap();
        assert_eq!(share_link_with_password(&m, pw), Err(Error::LienInvalide));
        // JavaScript : « Invalid URL » levé par `new URL` ; ici, le refus commun.
        assert_eq!(
            share_link_with_password("pas une url", pw),
            Err(Error::LienInvalide)
        );
    }

    #[test]
    fn analyse_robuste_du_mot_de_passe() {
        let link = share_link("https://shhdrop.test", &KLien::from_bytes([7; 32]), "/").unwrap();
        assert_eq!(split_password(&link), (link.clone(), None));
        let long = format!(".{}", "a".repeat(65));
        for bad in [
            ".",
            ".a",
            ".!!",
            ".YUMzIWNENT8jRmc=",
            ".gA",
            ".YUMzIWNENT8jRmd",
            &long,
            ".YUMz.IWNE",
        ] {
            assert_eq!(
                split_password(&format!("{link}{bad}")),
                (link.clone(), None),
                "{bad}"
            );
        }
        assert_eq!(
            split_password("pas une url"),
            ("pas une url".to_owned(), None)
        );
        let m = format!("https://shhdrop.test/#m{}", "A".repeat(43));
        assert_eq!(split_password(&m), (m.clone(), None));
        // TextDecoder retire une marque d'ordre d'octets (BOM) en tête : « 77u_YQ » = BOM + « a ».
        assert_eq!(
            split_password(&format!("{link}.77u_YQ")),
            (link.clone(), Some("a".into()))
        );
        assert_eq!(
            split_password(&format!("{link}.77u_")),
            (link.clone(), None)
        );
    }

    /// Fuzz léger : liens tronqués ou altérés, jamais de panique (Global Constraints).
    #[test]
    fn jamais_de_panique() {
        let k = k();
        let seeds = [
            format!("https://x.test/#{k}"),
            format!("http://[::1]:4000/shhdrop/#m{k}"),
            format!("https://u:p@[2001:db8::1]:8443/a/%2e/../?q#{k}.YUMz"),
            format!("HTTPS:\\\\0x7f.1:0443\\#{k}.w4k"),
        ];
        let alter = [
            '%', '[', ']', ':', '@', '.', '/', '\\', '#', '?', 'é', '\u{0}', ' ', '\n', 'x', '0',
        ];
        let mut s = 0x1234_5678u32;
        let mut next = || {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            s as usize
        };
        for seed in &seeds {
            let chars: Vec<char> = seed.chars().collect();
            for cut in 0..=chars.len() {
                let t: String = chars[..cut].iter().collect();
                let _ = parse_link(&t, "/");
                let _ = split_password(&t);
                let _ = share_link_with_password(&t, "a");
                let _ = check_origin(&t);
            }
            for _ in 0..3000 {
                let mut c = chars.clone();
                for _ in 0..1 + next() % 4 {
                    let i = next() % c.len();
                    match next() % 3 {
                        0 => c[i] = alter[next() % alter.len()],
                        1 => c.insert(i, alter[next() % alter.len()]),
                        _ => {
                            c.remove(i);
                        }
                    }
                    if c.is_empty() {
                        c.push('x');
                    }
                }
                let t: String = c.iter().collect();
                let _ = parse_link(&t, "/");
                let _ = split_password(&t);
                let _ = share_link_with_password(&t, "a");
                let _ = check_origin(&t);
            }
        }
    }
}
