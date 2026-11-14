// Poste de pilotage. Le jeton reste dans une variable de cet onglet (ni stockage local ni
// cookie) ; la page n'écrit que du texte (textContent), jamais de HTML.
'use strict';

let jeton = '';
let minuterie = 0;
let echecs = 0; // lectures d'état sans réponse, de suite
let gele = false;
let armeGel = 0;
let armeDetruire = 0;

const $ = (id) => document.getElementById(id);

function el(nom, texte, classe) {
  const e = document.createElement(nom);
  if (texte !== undefined) e.textContent = texte;
  if (classe) e.className = classe;
  return e;
}

const nombre = new Intl.NumberFormat('fr-FR');

function octets(n) {
  const u = ['octets', 'Kio', 'Mio', 'Gio', 'Tio'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: i === 0 ? 0 : 1 }).format(n) + '\u00a0' + u[i];
}

function duree(s) {
  const j = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  if (j > 0) return j + ' j ' + h + ' h';
  if (h > 0) return h + ' h ' + m + ' min';
  if (m > 0) return m + ' min';
  return s + ' s';
}

function pourcent(a, b) {
  return b > 0 ? Math.round(a / b * 100) + ' %' : 'sans plafond';
}

function vider(e) { while (e.firstChild) e.removeChild(e.firstChild); }

function fait(dl, nom, valeur) {
  dl.append(el('dt', nom), el('dd', valeur));
}

function chiffre(dl, nom, valeur) {
  const d = el('div');
  d.append(el('dt', nom), el('dd', nombre.format(valeur)));
  dl.append(d);
}

// jauge : valeur face à son plafond. Au-delà de 80 % : ambre ; de 95 % : rouge (couleurs
// du navigateur pour <meter>).
function jauge(parent, nom, valeur, max, texte) {
  const j = el('div', undefined, 'jauge');
  const l = el('div', undefined, 'ligne');
  l.append(el('span', nom), el('span', texte));
  j.append(l);
  if (max > 0) {
    const m = document.createElement('meter');
    m.min = 0; m.max = max; m.value = Math.min(valeur, max);
    m.low = max * 0.8; m.high = max * 0.95; m.optimum = 0;
    m.setAttribute('aria-label', nom);
    j.append(m);
  }
  parent.append(j);
}

function compte(parent, nom, valeur, max) {
  jauge(parent, nom, valeur, max, nombre.format(valeur) + ' / ' + nombre.format(max));
}

function afficher(e) {
  const s = e.sante;
  gele = s.creations_gelees;

  const p = $('pastilles');
  vider(p);
  p.append(el('li', 'Serveur en marche', 'ok'));
  p.append(gele ? el('li', 'Créations gelées', 'attention') : el('li', 'Créations ouvertes', 'ok'));
  p.append(s.alerte_signalements
    ? el('li', 'Signalements : 5 ou plus dans l’heure', 'attention')
    : el('li', 'Signalements : pas d’alerte', 'ok'));
  p.append(el('li', s.salon_actif ? 'Salon activé' : 'Salon désactivé'));
  if (s.vidages_wal_rates > 0) {
    p.append(el('li', 'Vidages de la base ratés : ' + nombre.format(s.vidages_wal_rates) +
      ' (un autre programme lit-il shares.db ?)', 'attention'));
  }

  const d = $('sante');
  vider(d);
  fait(d, 'En marche depuis', duree(s.en_marche_depuis_s));
  fait(d, 'Site', s.origine || 'origine non configurée');
  fait(d, 'Version de Go', s.go);
  fait(d, 'Compilation', s.revision || 'empreinte absente');

  const st = e.stockage, sto = $('stockage');
  vider(sto);
  jauge(sto, 'Plafond de stockage utilisé', st.utilise, st.plafond,
    octets(st.utilise) + ' sur ' + octets(st.plafond) + ' (' + pourcent(st.utilise, st.plafond) + ')');
  jauge(sto, 'Disque occupé', st.disque_total - st.disque_libre, st.disque_total,
    octets(st.disque_libre) + ' libres sur ' + octets(st.disque_total));
  const sd = el('dl', undefined, 'faits');
  fait(sd, 'Partages', octets(st.octets_partages));
  fait(sd, 'Salon (pièces et conversations)', octets(st.octets_salon));
  fait(sd, 'Place restante sous le plafond', octets(st.restant));
  fait(sd, 'Dont réservée aux nouveaux venus', octets(st.reserve_nouveaux_venus));
  sto.append(sd);

  const a = $('activite');
  vider(a);
  const pa = e.partages;
  chiffre(a, 'Partages prêts', pa.prets);
  chiffre(a, 'Envois en cours', pa.envois_en_cours);
  chiffre(a, 'En fin de lecture', pa.fin_de_lecture);
  if (e.salon) {
    chiffre(a, 'Salons vivants', e.salon.salons_vivants);
    chiffre(a, 'Sièges occupés', e.salon.sieges_occupes);
  }

  const u = e.usage, us = $('usage');
  $('usage-note').textContent = 'Compté depuis ' + duree(s.en_marche_depuis_s)
    + ', en mémoire seulement : rien par personne ni par partage, rien sur disque, et tout repart de zéro au redémarrage.';
  vider(us);
  chiffre(us, 'Partages créés', u.partages_crees);
  chiffre(us, 'Envois terminés', u.envois_termines);
  chiffre(us, 'Déverrouillages', u.deverrouillages);
  chiffre(us, 'Destructions demandées', u.destructions_demandees);
  chiffre(us, 'Effacés par l’entretien', u.effaces_par_entretien);
  chiffre(us, 'Expéditeurs distincts aujourd’hui', u.expediteurs_du_jour);
  if (e.salon) {
    chiffre(us, 'Salons créés', u.salons_crees);
    chiffre(us, 'Entrées dans un salon', u.entrees_salon);
  }
  const ud = $('usage-details');
  vider(ud);
  fait(ud, 'Volume chiffré reçu', octets(u.octets_recus));
  fait(ud, 'Volume chiffré servi', octets(u.octets_servis));
  fait(ud, 'Requêtes refusées par la limite de débit', nombre.format(u.refus_debit));

  const c = e.capacite, ch = $('charge');
  vider(ch);
  jauge(ch, 'Envois en cours', u.envois_en_cours, c.envois_max,
    nombre.format(u.envois_en_cours) + ' / ' + nombre.format(c.envois_max) + ' (pic ' + nombre.format(u.envois_pic) + ')');
  jauge(ch, 'Lectures en cours', u.lectures_en_cours, c.lectures_max,
    nombre.format(u.lectures_en_cours) + ' / ' + nombre.format(c.lectures_max) + ' (pic ' + nombre.format(u.lectures_pic) + ')');
  compte(ch, 'Surveillances tenues', c.surveillances, c.surveillances_max);
  compte(ch, 'Appels disque en cours', c.appels_disque, c.appels_disque_max);
  if (e.salon) {
    compte(ch, 'Connexions du salon', e.salon.connexions, c.websocket_max);
    compte(ch, 'Salons vivants', e.salon.salons_vivants, e.salon.salons_max);
    compte(ch, 'Trames du salon en mémoire', e.salon.trames_en_memoire, e.salon.trames_max);
  }
  const cd = el('dl', undefined, 'faits');
  fait(cd, 'Octrois de lecture actifs', nombre.format(c.octrois_lecture));
  fait(cd, 'Budgets de lecture actifs', nombre.format(c.budgets_lecture));
  ch.append(cd);

  const m = e.memoire, me = $('memoire');
  vider(me);
  jauge(me, 'Mémoire', m.utilisee, m.limite,
    m.limite > 0 ? octets(m.utilisee) + ' sur ' + octets(m.limite) : octets(m.utilisee) + ' (sans limite)');
  const md = el('dl', undefined, 'faits');
  fait(md, 'Goroutines', nombre.format(m.goroutines));
  fait(md, 'Fils du système', m.fils_systeme > 0 ? nombre.format(m.fils_systeme) : 'illisible ici');
  fait(md, 'Passes du ramasse-miettes', nombre.format(m.passes_gc));
  fait(md, 'Dernière pause', (m.derniere_pause_gc_ns / 1e6).toFixed(2).replace('.', ',') + '\u00a0ms');
  if (e.salon) fait(md, 'Paniques récupérées (entretien du salon)', nombre.format(e.salon.paniques_entretien));
  me.append(md);

  if (!armeGel) boutonGel();
}

function boutonGel() {
  $('gel').textContent = gele ? 'Rétablir les créations' : 'Geler les créations';
  $('gel-etat').textContent = gele
    ? 'Gelées : aucun nouveau partage ni salon. Ce qui existe reste lisible.'
    : 'Ouvertes. Geler est réversible et ne touche pas ce qui existe.';
}

// fermer : le jeton est oublié, la minuterie arrêtée, et la page revient à la saisie. Appelée
// dès qu'une réponse refuse le jeton (404 : ce qui répond n'est pas, ou plus, le serveur qui le
// connaît) ou après trois lectures d'état sans réponse de suite (tunnel coupé) : sinon l'onglet
// renverrait le jeton toutes les 5 secondes à quiconque répond ensuite sur ce port.
function fermer(message) {
  jeton = '';
  echecs = 0;
  if (minuterie) { clearInterval(minuterie); minuterie = 0; }
  $('tableau').hidden = true;
  $('perdu').hidden = true;
  $('entree').hidden = false;
  $('fraicheur').textContent = '';
  $('entree-erreur').textContent = message;
}

// Onglet fermé, quitté ou mis en cache par le navigateur : le jeton ne survit pas.
addEventListener('pagehide', () => fermer(''));

async function appel(methode, chemin, corps) {
  if (!jeton) throw new Error('sans jeton');
  const r = await fetch(chemin, {
    method: methode,
    headers: corps === undefined
      ? { Authorization: 'Bearer ' + jeton }
      : { Authorization: 'Bearer ' + jeton, 'Content-Type': 'text/plain' },
    body: corps, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
  });
  return { ok: r.ok, statut: r.status, json: await r.json().catch(() => null) };
}

// rafraichir : 'ok', 'refus' (le serveur a répondu sans accepter le jeton) ou 'injoignable'.
async function rafraichir() {
  let r;
  try {
    r = await appel('GET', '/api/etat');
  } catch {
    $('perdu').hidden = false;
    return 'injoignable';
  }
  if (!r.ok || !r.json) return r.statut === 404 ? 'refus' : 'injoignable';
  try {
    afficher(r.json);
  } catch {
    return 'refus'; // réponse qui n'a pas la forme de l'état : ce n'est pas notre serveur
  }
  $('perdu').hidden = true;
  $('fraicheur').textContent = 'Lu à ' + new Date().toLocaleTimeString('fr-FR') + ', relu toutes les 5 secondes. Rien n’est enregistré.';
  return 'ok';
}

// relire : lecture périodique, et après chaque action. Refus : fermeture tout de suite ; trois
// lectures sans réponse de suite : fermeture aussi.
async function relire() {
  if (!jeton) return;
  const r = await rafraichir();
  if (!jeton) return; // fermée entretemps
  if (r === 'ok') { echecs = 0; return; }
  if (r === 'refus') {
    fermer('Session fermée : le serveur a refusé le jeton (redémarré, ou autre programme sur ce port). Le jeton a été oublié.');
    return;
  }
  $('perdu').hidden = false;
  if (++echecs >= 3) fermer('Session fermée : serveur injoignable trois fois de suite. Le jeton a été oublié ; rouvrir le tunnel, puis le saisir de nouveau.');
}

$('entree').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  jeton = $('jeton').value.trim();
  $('jeton').value = '';
  $('entree-erreur').textContent = '';
  if (minuterie) { clearInterval(minuterie); minuterie = 0; }
  echecs = 0;
  if (await rafraichir() === 'ok') {
    $('entree').hidden = true;
    $('tableau').hidden = false;
    minuterie = setInterval(relire, 5000);
  } else {
    fermer('Refusé : jeton faux, ou serveur injoignable.');
    $('jeton').focus();
  }
});

// Geler et détruire demandent un second appui dans les 5 secondes.
$('gel').addEventListener('click', async () => {
  const b = $('gel');
  if (!armeGel) {
    b.textContent = gele ? 'Confirmer : rétablir' : 'Confirmer : geler';
    armeGel = setTimeout(() => { armeGel = 0; boutonGel(); }, 5000);
    return;
  }
  clearTimeout(armeGel); armeGel = 0;
  b.disabled = true;
  const r = await appel('POST', gele ? '/api/degeler' : '/api/geler').catch(() => ({ ok: false }));
  b.disabled = false;
  $('resultat').textContent = r.ok ? (gele ? 'Créations rétablies.' : 'Créations gelées.') : 'Échec : rien n’a changé.';
  await relire();
  boutonGel();
});

$('detruire').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const b = $('detruire-bouton');
  if (!armeDetruire) {
    b.textContent = 'Confirmer la destruction définitive';
    armeDetruire = setTimeout(() => { armeDetruire = 0; b.textContent = 'Détruire ce lien'; }, 5000);
    return;
  }
  clearTimeout(armeDetruire); armeDetruire = 0;
  b.textContent = 'Détruire ce lien';
  const lien = $('lien').value.trim();
  $('lien').value = '';
  b.disabled = true;
  const r = await appel('POST', '/api/detruire', lien).catch(() => ({ ok: false, statut: 0, json: null }));
  b.disabled = false;
  const res = $('resultat');
  if (r.ok && r.json && r.json.detruit === 'partage') res.textContent = '1 partage détruit.';
  else if (r.ok && r.json && r.json.detruit === 'salon' && r.json.reste) {
    res.textContent = '1 salon détruit : plus personne ne peut y entrer ni y lire. L’effacement d’un de ses fichiers se termine en arrière-plan (repris chaque seconde).';
  } else if (r.ok && r.json && r.json.detruit === 'salon') res.textContent = '1 salon détruit.';
  else if (r.ok) res.textContent = 'Introuvable : déjà détruit, expiré, ou lien inconnu. Rien n’a été détruit.';
  else if (r.statut === 400) res.textContent = 'Ce n’est pas un lien de partage ou de salon. Rien n’a été détruit.';
  else res.textContent = 'Échec : le serveur n’a pas confirmé la destruction.';
  relire();
});
