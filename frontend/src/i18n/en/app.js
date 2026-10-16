// Traductions anglaises, clé = texte français exact passé à t().
export default {
  // App.jsx : récapitulatif des modifications
  'Nouvelle personne': 'New person',
  'Personne': 'Person',
  'Sticker': 'Sticker',
  'Dessin': 'Drawing',
  'Texte': 'Text',
  'Photo': 'Photo',
  'Annotation': 'Annotation',
  'Relation': 'Relationship',
  'Compte': 'Account',

  // App.jsx : ajout de personnes et contributions
  "Ajoutez d'abord un parent à {name} pour pouvoir lui rattacher un frère ou une sœur.": 'Add a parent to {name} first, so you can link a sibling to them.',
  "Ajoutez d'abord un parent à cette personne pour pouvoir lui rattacher un frère ou une sœur.": 'Add a parent to this person first, so you can link a sibling to them.',
  '{name} est dans vos modifications. Envoyez-les quand vous avez fini.': '{name} is in your changes. Send them when you are done.',
  "Erreur lors de l'ajout de la personne": 'Could not add this person',
  'Aucune modification à soumettre.': 'No changes to send.',
  'Contribution de {name} · {date}': 'Contribution from {name} · {date}',
  'Contribution de la famille · {date}': 'Contribution from the family · {date}',
  "Erreur lors de l'envoi des contributions": 'Could not send your contributions',
  "Merci, c'est envoyé ! Ça apparaîtra dans l'arbre une fois relu.": "Thanks, it's sent! It will show up in the tree once it's reviewed.",

  // App.jsx : mot de passe de partage
  'Session invalide.': 'Invalid session.',
  "C'est bien lui. Rien ne change pour la famille.": "That's the one. Nothing changes for the family.",
  "Ce n'est pas le mot de passe actuel de l'arbre.": "That's not the tree's current password.",
  'Arbre introuvable.': 'Tree not found.',
  'Minimum 8 caractères.': 'At least 8 characters.',
  "C'est déjà le mot de passe actuel.": 'That is already the current password.',
  'Mot de passe changé. Envoyez le nouveau à la famille.': 'Password changed. Send the new one to your family.',

  // App.jsx : liens familiaux
  'Lien déjà présent': 'This link already exists',
  'Lien familial ajouté (démo locale)': 'Family link added (local demo)',
  'Lien ajouté à la contribution': 'Link added to your contribution',
  'Lien familial ajouté': 'Family link added',
  'Relation introuvable pour suppression': 'Could not find this relationship to delete',
  'Lien familial supprimé (démo locale)': 'Family link deleted (local demo)',
  'Suppression de lien ajoutée à la contribution': 'Link deletion added to your contribution',
  'Lien familial supprimé': 'Family link deleted',

  // App.jsx : accès à l'arbre
  "Cet arbre n'existe pas.": 'This tree does not exist.',
  'Impossible de résoudre ce lien de partage.': 'We could not open this share link.',
  "Aucun arbre accessible n'a pu être chargé automatiquement.": 'No accessible tree could be loaded automatically.',
  'Session invalide ou expirée. Reconnectez-vous.': 'Your session is invalid or has expired. Please sign in again.',

  // App.jsx : arbre vide
  'Votre arbre est créé.': 'Your tree is created.',
  "Ajoutez un proche pour commencer, comme votre mère, votre père ou un frère. Il suffit d'un prénom.": 'Add someone close to get started, like your mother, your father or a brother. A first name is all it takes.',
  'Fermer': 'Close',
  'Ajouter une première personne': 'Add a first person',
  'Ajouter une personne': 'Add a person',
  "Commencer l'arbre": 'Start the tree',

  // ErrorBoundary, BootLoader
  'Une erreur inattendue est survenue': 'Something unexpected went wrong',
  "L'application a rencontré un problème. Vous pouvez essayer de recharger ou revenir à l'écran précédent.": 'The app ran into a problem. You can try reloading or going back to the previous screen.',
  'Réessayer': 'Try again',
  'Recharger la page': 'Reload the page',
  "Ouverture de l'arbre": 'Opening the tree',
  'Arbre prêt': 'Tree ready',

  // utils/mediaUpload.js, utils/graphAdapter.js
  'Saisissez le texte de la citation.': 'Enter the text of the quote.',
  'Sélectionnez un fichier.': 'Select a file.',
  'Fichier invalide.': 'Invalid file.',
  'Fichier trop volumineux (max 20 Mo).': 'File too large (max 20 MB).',
  'Image trop volumineuse (max 5 Mo).': 'Image too large (max 5 MB).',
  'Média {n}': 'Media {n}',

  // utils/errorMessages.js
  'Mot de passe invalide ou accès expiré.': 'Invalid password or expired access.',
  'Trop de tentatives. Réessayez dans une minute.': 'Too many attempts. Try again in a minute.',
  'Connexion backend impossible. Vérifiez API/DB puis réessayez.': 'Could not reach the server. Check the API and database, then try again.',
  'Mot de passe incorrect.': 'Incorrect password.',
  'Session expirée. Reconnectez-vous puis réessayez.': 'Your session has expired. Sign in again, then try again.',
  'Saisissez votre mot de passe actuel.': 'Enter your current password.',
  'Impossible de supprimer le compte pour le moment. Réessayez plus tard.': 'We could not delete your account right now. Try again later.',
  'Image trop volumineuse (maximum 5 Mo).': 'Image too large (5 MB maximum).',
  "Format d'avatar invalide. Utilisez une image.": 'Invalid avatar format. Use an image.',
  'Le fichier média envoyé est invalide.': 'The media file you sent is invalid.',
  'Le format de fichier ne correspond pas au type de média choisi.': 'The file format does not match the media type you chose.',
  'Ajoutez le texte de la citation.': 'Add the text of the quote.',
  "L'arbre n'a plus de place pour de nouveaux souvenirs. Son propriétaire peut en supprimer.": 'This tree has no room left for new memories. Its owner can delete some.',
  "Erreur base de données. Lancez `npm run prisma:deploy` puis redémarrez l'API.": 'Database error. Run `npm run prisma:deploy`, then restart the API.',
  'Base de données indisponible. Lancez `npm run db:bootstrap` dans le backend.': 'Database unavailable. Run `npm run db:bootstrap` in the backend.',
  'Slug invalide : 3-64 caractères, uniquement lettres minuscules, chiffres et tirets.': 'Invalid slug: 3 to 64 characters, lowercase letters, numbers and hyphens only.',
  "Nom d'arbre invalide : entre 2 et 120 caractères.": 'Invalid tree name: between 2 and 120 characters.',
  'Mots de passe invalides : entre 8 et 128 caractères.': 'Invalid passwords: between 8 and 128 characters.',
  'Erreur formulaire : {error}': 'Form error: {error}',
  'Données invalides. Vérifiez les champs.': 'Invalid data. Check the fields.',
  'Session invalide ou identifiants incorrects.': 'Invalid session or incorrect credentials.',
  'Accès refusé pour cet arbre.': 'Access denied for this tree.',
  'Ressource introuvable.': 'Not found.',
  'Conflit détecté (email ou slug déjà utilisé).': 'Conflict detected (email or slug already in use).',
  "Erreur backend. Vérifiez que l'API et la base sont lancées.": 'Server error. Check that the API and database are running.',
}
