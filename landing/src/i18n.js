// Textes de la landing, une entrée par langue. Le français est servi à /, l'anglais à /en/.
// Les titres en deux morceaux [début, fin] : la fin est rendue en italique (<em className="s">).
// Fichier sans JSX : lu par l'app (App.jsx), par le prérendu (scripts/prerender.mjs) et par les tests.

export const LOCALES = ['fr', 'en']

// /en et /en/... servent l'anglais, tout le reste le français
export function localeFromPath(pathname = '/') {
  return /^\/en(\/|$)/.test(pathname) ? 'en' : 'fr'
}

const SITE = 'https://parenthese.io'

export const COPY = {
  fr: {
    home: '/',
    meta: {
      lang: 'fr',
      url: `${SITE}/`,
      ogLocale: 'fr_FR',
      title: "Parenthèse : l'arbre généalogique vivant de votre famille",
      description: "Créez l'arbre généalogique de votre famille en ligne, avec photos, vidéos et voix. Partagez-le en un lien : la famille consulte sans compte et contribue avec un mot de passe.",
      socialDescription: "L'arbre généalogique de votre famille en ligne, avec photos, voix et souvenirs. Partageable en un lien, sans compte.",
      imageAlt: 'Parenthèse, votre histoire familiale, vivante et partagée',
      schemaLanguage: 'fr-FR',
      appDescription: "Web app pour créer l'arbre généalogique d'une famille en ligne, avec photos, anecdotes, vidéos et voix, partageable en un lien sans compte.",
    },
    // Paramètres ajoutés aux liens vers l'app (vide en français : l'app suit la langue du navigateur)
    appQuery: '',
    otherLang: { href: '/en/', hrefLang: 'en', label: 'EN', title: 'English version' },
    logoHome: 'Parenthèse, accueil',
    nav: { how: 'Comment ça marche', demo: 'Un exemple', privacy: 'Vie privée', login: 'Se connecter' },
    privacyHref: '/donnees-et-vie-privee/',
    cta: 'Créer mon arbre',
    heroCanvas: 'Arbre de famille animé',
    hero: {
      pill: 'Arbre généalogique gratuit, en ligne',
      title: ["L'histoire de votre famille, racontée par ceux qui ", "l'ont vécue"],
      lede: "Créez l'arbre généalogique de votre famille en ligne, avec des photos, des voix et des souvenirs. Un lien suffit pour que toute la famille le consulte.",
      ledeShared: "Vous venez de découvrir Parenthèse à travers le lien d'une famille. Créez la vôtre en quelques minutes.",
      secondary: 'Voir un arbre',
    },
    trust: ['Gratuit, et le restera', 'Lecture par lien, sans compte', 'Code ouvert', 'Vos données restent les vôtres'],
    how: {
      eyebrow: 'Comment ça marche',
      title: ['Créer un arbre généalogique, ', 'en trois gestes'],
      steps: [
        { title: 'Ajoutez un visage', text: 'Un prénom, une photo si vous en avez une. Le reste peut attendre.' },
        { title: 'Racontez', text: "Une anecdote, une photo de vacances, sa voix au téléphone. Chacun ajoute ce qu'il sait." },
        { title: 'Partagez le lien', text: "La famille ouvre l'arbre depuis un message. Pas de compte, pas d'appli à installer." },
      ],
      toast: "Marc a ouvert l'arbre",
    },
    demo: {
      eyebrow: 'Un exemple',
      title: ['Un arbre généalogique ', 'avec photos, à explorer'],
      lede: "Cliquez sur un visage pour ouvrir sa fiche. C'est un arbre de démonstration, sans compte à créer.",
      loading: 'Chargement de la démo',
      idle: 'Démo interactive',
      frameTitle: 'Démo Parenthèse',
      enter: 'Entrer dans la démo',
      poster: "Aperçu de l'arbre de démonstration, trois générations d'une famille avec leurs photos",
    },
    who: {
      eyebrow: 'Pour qui',
      title: ['Du petit-fils de 8 ans ', 'à la grand-mère de 80'],
      lede: 'Parenthèse se lit comme un album de famille. On reconnaît un visage, on clique, on écoute.',
      captions: ['Lya, 14 ans', 'Camille, 39 ans', 'Marc, 56 ans', 'Jeanne, 85 ans'],
    },
    promise: [
      { eyebrow: 'Gratuit', title: 'Et ça le restera', text: "Pas d'abonnement, pas de version payante qui bloque vos souvenirs." },
      { eyebrow: 'Code ouvert', title: 'Vérifiable par tous', text: 'Le code est public. Une famille peut même héberger son propre Parenthèse.' },
      { eyebrow: 'Vos données', title: 'Supprimables à tout moment', text: "L'arbre et le compte se suppriment depuis l'app. Rien n'est revendu." },
    ],
    guides: {
      eyebrow: 'Guides',
      title: ['Guides pour faire ', 'son arbre généalogique'],
      more: 'Lire le guide',
      items: [
        {
          href: '/comment-faire-un-arbre-genealogique/',
          title: 'Comment faire un arbre généalogique',
          text: "Partir de soi, interroger les aînés, trouver les actes gratuitement en mairie et aux archives, puis faire compléter la famille.",
        },
        {
          href: '/application-arbre-genealogique/',
          title: "Quelle application d'arbre généalogique choisir ?",
          text: 'Geneanet, MyHeritage, Filae, FamilySearch, Parenthèse. Rechercher des ancêtres et garder une mémoire vivante ne sont pas le même besoin.',
        },
        {
          href: '/arbre-genealogique-avec-photos/',
          title: 'Faire un arbre généalogique avec des photos',
          text: 'Rassembler, numériser avec un téléphone, nommer et dater, puis ajouter les vidéos et les voix.',
        },
        {
          href: '/cousinade/',
          title: 'Organiser une cousinade',
          text: 'Retrouver toutes les branches, fixer la date, collecter les souvenirs le jour même, et garder une trace que tout le monde retrouve.',
        },
        {
          href: '/raconter-histoire-de-famille/',
          title: "Raconter l'histoire de sa famille",
          text: "Par qui commencer, les questions qui font parler, enregistrer plutôt qu'écrire, et où garder ce qu'on a recueilli.",
        },
        {
          href: '/arbre-genealogique-a-remplir/',
          title: 'Arbre généalogique à remplir',
          text: "Cinq modèles vierges à imprimer en PDF, de trois à cinq générations, avec cases photo ou arbre dessiné. Et comment les remplir.",
        },
      ],
    },
    final: {
      title: ['Commencez par ', 'un seul visage'],
      lede: "Le vôtre, ou celui de quelqu'un que vous aimeriez garder.",
    },
    footer: {
      label: 'Pied de page',
      guides: 'Guides',
      login: 'Se connecter',
      privacy: 'Vie privée',
      source: 'Code source',
      madeBy: 'Fait par Ilies Allali',
    },
  },

  en: {
    home: '/en/',
    meta: {
      lang: 'en',
      url: `${SITE}/en/`,
      ogLocale: 'en_US',
      title: 'Parenthèse: your family tree, with photos, voices and stories',
      description: 'Build your family tree online, with photos, videos and voices. Share it with one link: relatives view it without an account and contribute with a password.',
      socialDescription: 'Your family tree online, with photos, voices and memories. Shareable with one link, no account needed.',
      imageAlt: 'Parenthèse, your family story, alive and shared',
      schemaLanguage: 'en',
      appDescription: 'Web app to build a family tree online, with photos, stories, videos and voices, shareable with one link and no account.',
    },
    appQuery: 'lang=en',
    otherLang: { href: '/', hrefLang: 'fr', label: 'FR', title: 'Version française' },
    logoHome: 'Parenthèse, home',
    nav: { how: 'How it works', demo: 'An example', privacy: 'Privacy', login: 'Sign in' },
    privacyHref: '/en/privacy/',
    cta: 'Start your tree',
    heroCanvas: 'Animated family tree',
    hero: {
      pill: 'Free family tree, online',
      title: ["Your family's story, told by the people who ", 'lived it'],
      lede: 'Build your family tree online, with photos, voices and memories. One link is all your family needs to explore it.',
      ledeShared: "You just discovered Parenthèse through another family's link. Start your own in a few minutes.",
      secondary: 'See a tree',
    },
    trust: ['Free, and it will stay free', 'View by link, no account', 'Source-available', 'Your data stays yours'],
    how: {
      eyebrow: 'How it works',
      title: ['Build a family tree ', 'in three steps'],
      steps: [
        { title: 'Add a face', text: 'A first name, and a photo if you have one. The rest can wait.' },
        { title: 'Tell the story', text: 'A story, a vacation photo, their voice on the phone. Everyone adds what they know.' },
        { title: 'Share the link', text: 'Your family opens the tree from a message. No account, no app to install.' },
      ],
      toast: 'Marc opened the tree',
    },
    demo: {
      eyebrow: 'An example',
      title: ['A family tree ', 'with photos, to explore'],
      lede: 'Click a face to open their profile. This is a demo tree, no account needed.',
      loading: 'Loading the demo',
      idle: 'Interactive demo',
      frameTitle: 'Parenthèse demo',
      enter: 'Enter the demo',
      poster: 'Preview of the demo tree, three generations of a family with their photos',
    },
    who: {
      eyebrow: "Who it's for",
      title: ['From a grandson of 8 ', 'to a grandmother of 80'],
      lede: 'Parenthèse reads like a family album. You recognize a face, you click, you listen.',
      captions: ['Lya, 14', 'Camille, 39', 'Marc, 56', 'Jeanne, 85'],
    },
    promise: [
      { eyebrow: 'Free', title: 'And it will stay that way', text: 'No subscription, no paid tier that locks your memories away.' },
      { eyebrow: 'Source-available', title: 'Anyone can check it', text: 'The code is public. A family can even host its own Parenthèse.' },
      { eyebrow: 'Your data', title: 'Delete it anytime', text: 'The tree and the account can be deleted from the app. Nothing is sold.' },
    ],
    guides: {
      eyebrow: 'Guides',
      title: ['Guides to make ', 'your family tree'],
      more: 'Read the guide',
      items: [
        {
          href: '/en/how-to-make-a-family-tree/',
          title: 'How to make a family tree',
          text: 'Start with yourself, talk to the elders, find records for free at town halls and archives, then let the family fill in the rest.',
        },
        {
          href: '/en/family-tree-app/',
          title: 'Which family tree app should you choose?',
          text: 'Geneanet, MyHeritage, Filae, FamilySearch, Parenthèse. Researching ancestors and keeping a living memory are not the same need.',
        },
        {
          href: '/en/family-tree-with-photos/',
          title: 'Making a family tree with photos',
          text: 'Gather, scan with a phone, name and date, then add the videos and the voices.',
        },
        {
          href: '/en/family-reunion/',
          title: 'Organizing a family reunion',
          text: 'Find every branch, set the date, collect memories on the day, and keep a record everyone can find.',
        },
        {
          href: '/en/tell-your-family-story/',
          title: "Telling your family's story",
          text: "Who to start with, the questions that get people talking, recording rather than writing, and where to keep what you've gathered.",
        },
        {
          href: '/en/printable-family-tree/',
          title: 'Printable family tree',
          text: 'Five blank templates to print as PDF, from three to five generations, with photo boxes or a drawn tree. And how to fill them in.',
        },
      ],
    },
    final: {
      title: ['Start with ', 'a single face'],
      lede: "Yours, or the face of someone you'd like to keep close.",
    },
    footer: {
      label: 'Footer',
      guides: 'Guides',
      login: 'Sign in',
      privacy: 'Privacy',
      source: 'Source code',
      madeBy: 'Made by Ilies Allali',
    },
  },
}

// Ajoute les paramètres de langue à une adresse de l'app (https://app.parenthese.io/?...)
export function withAppQuery(url, locale) {
  const query = COPY[locale].appQuery
  if (!query) return url
  return url + (url.includes('?') ? '&' : '?') + query
}
