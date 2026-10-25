import { t } from '../i18n/index.js'

// Liens utiles du panneau « Chercher quelqu'un » : des sites sans recherche qu'on peut interroger d'ici.
// Le navigateur ouvre le site, rien ne passe par le serveur de Parenthèse. Quand le site le permet, l'adresse
// porte déjà le nom cherché. Ajouter un lien : un objet de plus, avec son pays et une phrase qui dit ce qu'on
// y trouve.

const enc = encodeURIComponent

export const SEARCH_LINK_REGIONS = [
  { id: 'fr', label: t('France') },
  { id: 'be', label: t('Belgique, Pays-Bas') },
  { id: 'world', label: t('Ailleurs') },
]

export const SEARCH_LINKS = [
  {
    id: 'gallica',
    region: 'fr',
    name: t('Presse ancienne'),
    detail: t('Gallica, journaux numérisés'),
    url: ({ firstName, lastName }) => `https://gallica.bnf.fr/services/engine/search/sru?operation=searchRetrieve&version=1.2&query=${enc(`(gallica adj "${[firstName, lastName].filter(Boolean).join(' ')}") and dc.type all "fascicule"`)}`,
  },
  {
    id: 'francearchives',
    region: 'fr',
    name: t('Registres matricules, état civil'),
    detail: t('FranceArchives, hommes nés de 1847 à 1901'),
    url: ({ firstName, lastName }) => `https://francearchives.gouv.fr/fr/basedenoms?q=${enc([lastName, firstName].filter(Boolean).join(' '))}`,
  },
  {
    id: 'mdh',
    region: 'fr',
    name: t('Morts pour la France'),
    detail: t('Mémoire des hommes'),
    url: () => 'https://www.memoiredeshommes.defense.gouv.fr/',
  },
  {
    id: 'leonore',
    region: 'fr',
    name: t("Légion d'honneur"),
    detail: t('Base Léonore'),
    url: () => 'https://www.leonore.archives-nationales.culture.gouv.fr/',
  },
  {
    id: 'geneanet',
    region: 'fr',
    name: 'Geneanet',
    detail: t('Arbres et relevés'),
    url: ({ firstName, lastName }) => `https://www.geneanet.org/fonds/individus/?nom=${enc(lastName)}&prenom=${enc(firstName)}&go=1`,
  },
  {
    id: 'openarchives',
    region: 'be',
    name: 'Open Archives',
    detail: t('État civil et registres'),
    url: ({ firstName, lastName }) => `https://www.openarchieven.nl/search.php?lang=fr&name=${enc([firstName, lastName].filter(Boolean).join(' '))}`,
  },
  {
    id: 'wikitree',
    region: 'world',
    name: 'WikiTree',
    detail: t('Arbre mondial tenu par ses membres'),
    // La recherche par prénom ne se préremplit pas : la page du nom de famille liste toutes ses fiches
    url: ({ lastName }) => (lastName ? `https://www.wikitree.com/genealogy/${enc(lastName.toUpperCase())}` : 'https://www.wikitree.com/'),
  },
  {
    id: 'freebmd',
    region: 'world',
    name: 'FreeBMD',
    detail: t('Angleterre et pays de Galles'),
    url: () => 'https://www.freebmd.org.uk/cgi/search.pl',
  },
  {
    id: 'familysearch',
    region: 'world',
    name: 'FamilySearch',
    detail: t('Registres du monde entier, compte gratuit'),
    url: ({ firstName, lastName, birthYear }) => {
      const params = new URLSearchParams({ 'q.givenName': firstName || '', 'q.surname': lastName || '' })
      if (birthYear) {
        params.set('q.birthLikeDate.from', String(birthYear))
        params.set('q.birthLikeDate.to', String(birthYear))
      }
      return `https://www.familysearch.org/search/record/results?${params}`
    },
  },
]
