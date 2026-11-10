//! Analyse d'URL http(s) selon la norme WHATWG URL, réduite à ce que `transfer/link.ts`
//! obtenait de `new URL(…)` : origine, identifiants, chemin, fragment et `href`. Les mêmes
//! normalisations sont refaites à la main (la crate `url` n'est pas dans la liste fermée des
//! dépendances) : espaces et caractères de contrôle en bord, tabulations et retours à la ligne
//! retirés, schéma et hôte en minuscules, `\` lu comme `/`, barres en trop après le schéma,
//! port par défaut retiré, adresses IPv4 (forme courte, octale, hexadécimale) et IPv6
//! réécrites, segments `.` et `..` (et `%2e`) résolus, encodage `%XX` des mêmes caractères.
//!
//! Écarts avec `new URL` (Node 22), mesurés par comparaison sur environ 590 000 adresses :
//! seuls `http:` et `https:` sont lus (refus des autres) ; un hôte non ASCII (nom de domaine
//! internationalisé, même encodé en `%XX`) est refusé, faute des tables Unicode UTS 46 ; une
//! étiquette `xn--…` est gardée telle quelle (en minuscules), sans la validation Punycode/UTS 46
//! qui fait refuser `xn--zz` par `new URL`. Décision du 10 novembre (option A) : sans risque,
//! car l'appelant compare toujours l'origine rendue à la sienne (ASCII). Écarts listés dans
//! engine/vectors/README.md.

/// URL `http:` ou `https:` analysée ; les chaînes sont déjà sous leur forme sérialisée.
pub(crate) struct Url {
    scheme: &'static str,
    username: String,
    password: String,
    host: String,
    port: Option<u16>,
    path: Vec<String>,
    query: Option<String>,
    fragment: Option<String>,
}

// Ensembles d'encodage « percent-encode » de la norme, pour un octet ASCII (version de Node 22,
// moteur du générateur des vecteurs : `^` n'est pas encodé dans le chemin).
fn c0(b: u8) -> bool {
    !(0x20..=0x7e).contains(&b)
}
fn fragment_set(b: u8) -> bool {
    c0(b) || b" \"<>`".contains(&b)
}
fn query_set(b: u8) -> bool {
    c0(b) || b" \"#<>".contains(&b)
}
fn special_query_set(b: u8) -> bool {
    query_set(b) || b == b'\''
}
fn path_set(b: u8) -> bool {
    query_set(b) || b"?`{}".contains(&b)
}
fn userinfo_set(b: u8) -> bool {
    path_set(b) || b"/:;=@[\\]^|".contains(&b)
}

/// Encode chaque octet UTF-8 de `s` qui appartient à `set` (tout octet non ASCII en fait partie).
fn encode(s: &str, set: fn(u8) -> bool) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        if set(b) {
            out.push('%');
            out.push(char::from(b"0123456789ABCDEF"[usize::from(b >> 4)]));
            out.push(char::from(b"0123456789ABCDEF"[usize::from(b & 15)]));
        } else {
            out.push(char::from(b));
        }
    }
    out
}

/// `%XX` → octet ; un `%` qui n'est pas suivi de deux chiffres hexadécimaux reste tel quel.
fn percent_decode(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    let hex = |c: u8| char::from(c).to_digit(16).map(|d| d as u8);
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let h = b.get(i + 1).and_then(|&c| hex(c));
            let l = b.get(i + 2).and_then(|&c| hex(c));
            if let (Some(h), Some(l)) = (h, l) {
                out.push(h << 4 | l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    out
}

/// Nombre d'une partie d'IPv4 : décimal, octal (`0…`) ou hexadécimal (`0x…`). Une valeur trop
/// grande est ramenée à `u64::MAX` (elle sera refusée, comme toute valeur ≥ 2^32).
fn ipv4_number(s: &str) -> Option<u64> {
    if s.is_empty() {
        return None;
    }
    let (digits, radix) = if s.len() >= 2 && (s.starts_with("0x") || s.starts_with("0X")) {
        (&s[2..], 16)
    } else if s.len() >= 2 && s.starts_with('0') {
        (&s[1..], 8)
    } else {
        (s, 10)
    };
    let mut v: u64 = 0;
    for c in digits.chars() {
        let d = c.to_digit(radix)?;
        v = v
            .saturating_mul(u64::from(radix))
            .saturating_add(u64::from(d));
    }
    Some(v)
}

/// « Ends in a number » : la dernière étiquette (hors point final) est un nombre.
fn ends_in_number(host: &str) -> bool {
    let mut parts: Vec<&str> = host.split('.').collect();
    if parts.last() == Some(&"") {
        if parts.len() == 1 {
            return false;
        }
        parts.pop();
    }
    let last = parts.last().copied().unwrap_or("");
    (!last.is_empty() && last.bytes().all(|c| c.is_ascii_digit())) || ipv4_number(last).is_some()
}

fn parse_ipv4(host: &str) -> Option<String> {
    let mut parts: Vec<&str> = host.split('.').collect();
    if parts.last() == Some(&"") && parts.len() > 1 {
        parts.pop();
    }
    if parts.len() > 4 {
        return None;
    }
    let numbers = parts
        .iter()
        .map(|p| ipv4_number(p))
        .collect::<Option<Vec<u64>>>()?;
    let (last, head) = numbers.split_last()?;
    if head.iter().any(|&n| n > 255) || *last >= 256u64.pow(5 - numbers.len() as u32) {
        return None;
    }
    let mut ip = *last;
    for (i, &n) in head.iter().enumerate() {
        ip += n << (8 * (3 - i));
    }
    let b = (ip as u32).to_be_bytes();
    Some(format!("{}.{}.{}.{}", b[0], b[1], b[2], b[3]))
}

/// Analyseur IPv6 de la norme, pas à pas (compression `::`, IPv4 final).
fn parse_ipv6(s: &str) -> Option<[u16; 8]> {
    let c: Vec<u8> = s.bytes().collect();
    let at = |p: usize| c.get(p).copied();
    let mut a = [0u16; 8];
    let mut piece = 0usize;
    let mut compress: Option<usize> = None;
    let mut p = 0usize;
    if at(0) == Some(b':') {
        if at(1) != Some(b':') {
            return None;
        }
        p = 2;
        piece = 1;
        compress = Some(1);
    }
    while let Some(ch) = at(p) {
        if piece == 8 {
            return None;
        }
        if ch == b':' {
            if compress.is_some() {
                return None;
            }
            p += 1;
            piece += 1;
            compress = Some(piece);
            continue;
        }
        let mut value: u16 = 0;
        let mut length = 0;
        while length < 4 {
            let Some(d) = at(p).and_then(|x| char::from(x).to_digit(16)) else {
                break;
            };
            value = value * 16 + d as u16;
            p += 1;
            length += 1;
        }
        match at(p) {
            Some(b'.') => {
                if length == 0 || piece > 6 {
                    return None;
                }
                p -= length;
                let mut seen = 0;
                while at(p).is_some() {
                    if seen > 0 {
                        if at(p) == Some(b'.') && seen < 4 {
                            p += 1;
                        } else {
                            return None;
                        }
                    }
                    let mut v4: Option<u16> = None;
                    if !at(p).is_some_and(|x| x.is_ascii_digit()) {
                        return None;
                    }
                    while let Some(x) = at(p).filter(u8::is_ascii_digit) {
                        let n = u16::from(x - b'0');
                        v4 = match v4 {
                            None => Some(n),
                            Some(0) => return None,
                            Some(v) => Some(v * 10 + n),
                        };
                        if v4 > Some(255) {
                            return None;
                        }
                        p += 1;
                    }
                    a[piece] = a[piece] * 0x100 + v4?;
                    seen += 1;
                    if seen == 2 || seen == 4 {
                        piece += 1;
                    }
                }
                if seen != 4 {
                    return None;
                }
                break;
            }
            Some(b':') => {
                p += 1;
                at(p)?;
            }
            Some(_) => return None,
            None => {}
        }
        a[piece] = value;
        piece += 1;
    }
    if let Some(start) = compress {
        let mut swaps = piece - start;
        piece = 7;
        while piece != 0 && swaps > 0 {
            a.swap(piece, start + swaps - 1);
            piece -= 1;
            swaps -= 1;
        }
    } else if piece != 8 {
        return None;
    }
    Some(a)
}

fn serialize_ipv6(a: &[u16; 8]) -> String {
    // Plus longue suite (au moins 2) de zéros, la première en cas d'égalité : « :: ».
    let (mut best, mut best_len) = (None, 1);
    let mut i = 0;
    while i < 8 {
        let j = (i..8).find(|&j| a[j] != 0).unwrap_or(8);
        if j - i > best_len {
            best = Some(i);
            best_len = j - i;
        }
        i = j.max(i + 1);
    }
    let mut out = String::from("[");
    let mut i = 0;
    while i < 8 {
        if Some(i) == best {
            out.push_str(if i == 0 { "::" } else { ":" });
            i += best_len;
            continue;
        }
        out.push_str(&format!("{:x}", a[i]));
        if i != 7 {
            out.push(':');
        }
        i += 1;
    }
    out.push(']');
    out
}

/// Hôte d'une URL http(s), sérialisé ; `None` si `new URL` le refuserait (ou s'il n'est pas ASCII).
fn parse_host(raw: &str) -> Option<String> {
    if let Some(inner) = raw.strip_prefix('[') {
        return Some(serialize_ipv6(&parse_ipv6(inner.strip_suffix(']')?)?));
    }
    let bytes = percent_decode(raw);
    if !bytes.is_ascii() {
        return None; // nom de domaine internationalisé : voir l'en-tête du module
    }
    let mut host = String::from_utf8(bytes).ok()?;
    host.make_ascii_lowercase();
    let forbidden = |b: u8| b <= 0x20 || b == 0x7f || b"#%/:<>?@[\\]^|".contains(&b);
    if host.is_empty() || host.bytes().any(forbidden) {
        return None;
    }
    if ends_in_number(&host) {
        return parse_ipv4(&host);
    }
    Some(host)
}

fn is_single_dot(s: &str) -> bool {
    s == "." || s.eq_ignore_ascii_case("%2e")
}

fn is_double_dot(s: &str) -> bool {
    ["..", ".%2e", "%2e.", "%2e%2e"]
        .iter()
        .any(|d| s.eq_ignore_ascii_case(d))
}

impl Url {
    /// `new URL(input)` sans base, pour `http:` et `https:` seulement.
    pub(crate) fn parse(input: &str) -> Option<Url> {
        let s: String = input
            .trim_matches(|c: char| c <= ' ')
            .chars()
            .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
            .collect();
        let (scheme_raw, rest) = s.split_once(':')?;
        let mut sc = scheme_raw.chars();
        if !sc.next().is_some_and(|c| c.is_ascii_alphabetic())
            || !sc.all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
        {
            return None;
        }
        let (scheme, default_port) = match scheme_raw.to_ascii_lowercase().as_str() {
            "http" => ("http", 80),
            "https" => ("https", 443),
            _ => return None,
        };
        let rest = rest.trim_start_matches(['/', '\\']);
        let end = rest.find(['/', '\\', '?', '#']).unwrap_or(rest.len());
        let (authority, after) = rest.split_at(end);

        let (userinfo, hostport) = match authority.rsplit_once('@') {
            Some((u, h)) => (Some(u), h),
            None => (None, authority),
        };
        let (username, password) = match userinfo {
            None => (String::new(), String::new()),
            Some(u) => {
                let (n, p) = u.split_once(':').unwrap_or((u, ""));
                (encode(n, userinfo_set), encode(p, userinfo_set))
            }
        };
        let mut in_brackets = false;
        let sep = hostport.char_indices().find(|&(_, c)| {
            match c {
                '[' => in_brackets = true,
                ']' => in_brackets = false,
                _ => {}
            }
            c == ':' && !in_brackets
        });
        let (host_raw, port_raw) = match sep {
            Some((i, _)) => (&hostport[..i], Some(&hostport[i + 1..])),
            None => (hostport, None),
        };
        if host_raw.is_empty() {
            return None;
        }
        let mut port = None;
        if let Some(pr) = port_raw.filter(|p| !p.is_empty()) {
            let mut v: u32 = 0;
            for c in pr.chars() {
                v = v * 10 + c.to_digit(10)?;
                if v > 65535 {
                    return None;
                }
            }
            port = (v != default_port).then_some(v as u16);
        }
        let host = parse_host(host_raw)?;

        let qf = after.find(['?', '#']).unwrap_or(after.len());
        let (path_raw, after) = after.split_at(qf);
        let path_raw = path_raw.strip_prefix(['/', '\\']).unwrap_or(path_raw);
        let segments: Vec<&str> = path_raw.split(['/', '\\']).collect();
        let mut path = Vec::new();
        for (i, seg) in segments.iter().enumerate() {
            let last = i + 1 == segments.len();
            let seg = encode(seg, path_set);
            if is_double_dot(&seg) {
                path.pop();
                if last {
                    path.push(String::new());
                }
            } else if is_single_dot(&seg) {
                if last {
                    path.push(String::new());
                }
            } else {
                path.push(seg);
            }
        }
        let (query, fragment) = match after.strip_prefix('?') {
            Some(q) => {
                let (q, f) = match q.split_once('#') {
                    Some((q, f)) => (q, Some(f)),
                    None => (q, None),
                };
                (Some(encode(q, special_query_set)), f)
            }
            None => (None, after.strip_prefix('#')),
        };
        Some(Url {
            scheme,
            username,
            password,
            host,
            port,
            path,
            query,
            fragment: fragment.map(|f| encode(f, fragment_set)),
        })
    }

    pub(crate) fn scheme(&self) -> &str {
        self.scheme
    }

    /// `hostname` : hôte sérialisé (IPv6 entre crochets).
    pub(crate) fn hostname(&self) -> &str {
        &self.host
    }

    /// Vrai si `username` ou `password` n'est pas vide.
    pub(crate) fn has_credentials(&self) -> bool {
        !self.username.is_empty() || !self.password.is_empty()
    }

    /// `origin` : `schéma://hôte[:port]`.
    pub(crate) fn origin(&self) -> String {
        match self.port {
            Some(p) => format!("{}://{}:{p}", self.scheme, self.host),
            None => format!("{}://{}", self.scheme, self.host),
        }
    }

    /// `pathname`.
    pub(crate) fn pathname(&self) -> String {
        self.path.iter().map(|s| format!("/{s}")).collect()
    }

    /// `hash` : `#` + fragment, ou vide si le fragment est absent ou vide.
    pub(crate) fn hash(&self) -> String {
        match self.fragment.as_deref() {
            None | Some("") => String::new(),
            Some(f) => format!("#{f}"),
        }
    }

    /// `u.hash = "#" + f` pour un fragment déjà sans caractère à encoder.
    pub(crate) fn set_fragment(&mut self, f: &str) {
        self.fragment = Some(encode(f, fragment_set));
    }

    /// `href` : URL entière sérialisée.
    pub(crate) fn href(&self) -> String {
        let mut out = format!("{}://", self.scheme);
        if self.has_credentials() {
            out.push_str(&self.username);
            if !self.password.is_empty() {
                out.push(':');
                out.push_str(&self.password);
            }
            out.push('@');
        }
        out.push_str(&self.host);
        if let Some(p) = self.port {
            out.push_str(&format!(":{p}"));
        }
        out.push_str(&self.pathname());
        if let Some(q) = &self.query {
            out.push('?');
            out.push_str(q);
        }
        if let Some(f) = &self.fragment {
            out.push('#');
            out.push_str(f);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::Url;

    fn href(s: &str) -> Option<String> {
        Url::parse(s).map(|u| u.href())
    }

    // Résultats de `new URL(s).href` sous Node 22 (moteur du générateur des vecteurs).
    #[test]
    fn normalisations() {
        for (s, want) in [
            ("https://@x.test/", "https://x.test/"),
            ("https://:@x.test/", "https://x.test/"),
            ("https://::@x.test/", "https://:%3A@x.test/"),
            ("https://a@b@x/", "https://a%40b@x/"),
            ("https://u%20:p@x/", "https://u%20:p@x/"),
            ("https://a!b.test/", "https://a!b.test/"),
            ("https://a..b/", "https://a..b/"),
            ("https://XN--T-9FAB.example/", "https://xn--t-9fab.example/"),
            ("https://127.1/", "https://127.0.0.1/"),
            ("https://0x7f.0.0.1/", "https://127.0.0.1/"),
            ("https://1.2.3.4./", "https://1.2.3.4/"),
            ("https://x.test:/", "https://x.test/"),
            ("https://x.test:0443/", "https://x.test/"),
            ("http://x.test:80/", "http://x.test/"),
            ("https://x.test:80/", "https://x.test:80/"),
            ("https://[0:0::1]/", "https://[::1]/"),
            ("https://[::ffff:1.2.3.4]/", "https://[::ffff:102:304]/"),
            ("https://[1:0:0:2:0:0:0:3]/", "https://[1:0:0:2::3]/"),
            ("https:x.test/#a", "https://x.test/#a"),
            ("https:///x.test/", "https://x.test/"),
            ("HTTPS://x.test/", "https://x.test/"),
            ("https://x%2Etest/", "https://x.test/"),
            (
                "https://x.test/a^b`{}/?q' \"#f `<>",
                "https://x.test/a^b%60%7B%7D/?q%27%20%22#f%20%60%3C%3E",
            ),
            ("https://x.test/a/../#k", "https://x.test/#k"),
            ("https://x.test/%2E%2e/", "https://x.test/"),
            ("https://x.test/\u{e9}/", "https://x.test/%C3%A9/"),
            ("https://x.test/?a#b#c", "https://x.test/?a#b#c"),
            ("https://[::1]:443/", "https://[::1]/"),
            (" \t https://x.te\nst/ \u{1}", "https://x.test/"),
        ] {
            assert_eq!(href(s).as_deref(), Some(want), "{s:?}");
        }
    }

    #[test]
    fn refus() {
        for s in [
            "pas une url",
            "https://a b/",
            "https://x.123/",
            "https://1.2.3.4.5/",
            "https://08/",
            "https://1.2.3.256/",
            "https://x.test:65536/",
            "https://x.test:+1/",
            "https://",
            "https://u@/",
            "https://:443/",
            "https://[::1/",
            "https://[::1::2]/",
            "https://a%zz/",
            "https://a%25b/",
            "https://a^b/",
            "https://a|b/",
            "https://a<b/",
            "https://a\u{7f}b/",
            "foo://x/",
            "https://\u{e9}t\u{e9}.example/",
            "https://x%C3%A9/",
        ] {
            assert!(href(s).is_none(), "{s:?}");
        }
    }

    #[test]
    fn origine() {
        let u = Url::parse("HTTP://U:P@LOCALHOST:8080/a?b#c").unwrap();
        assert_eq!(u.origin(), "http://localhost:8080");
    }
}
