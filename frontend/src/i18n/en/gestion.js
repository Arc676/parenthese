// Traductions anglaises, clé = texte français exact passé à t().
// Co-gestion d'un arbre (issue #145) : onglet Gestion, page du lien d'invitation, suppression du compte
export default {
  // Onglet Gestion (TreeManagersSection)
  'Gestion': 'Managers',
  'Co-gestionnaire': 'Co-manager',
  'Cette adresse gère déjà cet arbre.': 'This address already manages this tree.',
  'Cette adresse email ne semble pas valide.': 'This email address does not look valid.',
  'Trop d’invitations en attente. Annulez-en une avant d’en envoyer une autre.': 'Too many pending invitations. Cancel one before sending another.',
  'Impossible de charger les gestionnaires.': 'Could not load the managers.',
  'Impossible d’envoyer l’invitation.': 'Could not send the invitation.',
  'Impossible de créer le lien.': 'Could not create the link.',
  'Impossible d’annuler l’invitation.': 'Could not cancel the invitation.',
  'Impossible de retirer ce co-gestionnaire.': 'Could not remove this co-manager.',
  'Les co-gestionnaires modifient l’arbre directement et valident les propositions de la famille, comme vous. Seul le propriétaire invite, retire un co-gestionnaire ou supprime l’arbre.':
    'Co-managers edit the tree directly and review the family’s suggestions, like you. Only the owner invites or removes a co-manager, or deletes the tree.',
  'Retrait en cours': 'Removing',
  'Invité le {date}, en attente': 'Invited on {date}, pending',
  'Création du lien': 'Creating the link',
  'Copier le lien': 'Copy the link',
  'Annulation en cours': 'Cancelling',
  'Lien pour {email}': 'Link for {email}',
  'Lien d’invitation': 'Invitation link',
  'Envoyez-le par message ou par mail. Il sert une fois et vaut 14 jours. « Copier le lien » en crée un nouveau, l’ancien ne marche plus.':
    'Send it by text or email. It works once and lasts 14 days. “Copy the link” creates a new one, and the old one stops working.',
  '{name} ne gère plus cet arbre.': '{name} no longer manages this tree.',
  'Cette personne a pu voir le mot de passe de partage : avec lui, elle peut encore ouvrir l’arbre en lecture. Pour lui couper aussi la lecture, changez-le, puis donnez le nouveau à la famille.':
    'This person may have seen the sharing password, which still lets them open the tree to read it. To cut that too, change it, then give the new one to the family.',
  'Changer le mot de passe de partage': 'Change the sharing password',
  'Inviter un co-gestionnaire': 'Invite a co-manager',
  'Son adresse email': 'Their email address',
  'prenom@exemple.fr': 'name@example.com',
  'Invitation en cours': 'Inviting',
  'Inviter': 'Invite',
  'Parenthèse n’envoie pas de mail : vous recevez un lien à lui transmettre. S’il se connecte avec {name} et cette adresse, il est ajouté sans le lien.':
    'Parenthèse sends no email: you get a link to pass on. If they sign in with {name} and this address, they are added without the link.',
  'Parenthèse n’envoie pas de mail : vous recevez un lien à lui transmettre.': 'Parenthèse sends no email: you get a link to pass on.',

  // Avancé, pour un co-gestionnaire (AdminPanel)
  'Impossible de quitter la gestion de cet arbre.': 'Could not stop managing this tree.',
  'Quitter la gestion de cet arbre': 'Stop managing this tree',
  'Vous ne pourrez plus le modifier. Seul son propriétaire peut le supprimer.': 'You will no longer be able to edit it. Only its owner can delete it.',
  'Rester': 'Stay',
  'Quitter': 'Leave',

  // Page du lien d'invitation (InvitationScreen)
  'Ce lien a déjà servi. Si c’était le vôtre, l’arbre est dans vos arbres.': 'This link has already been used. If it was yours, the tree is in your trees.',
  'Ce lien a expiré. Demandez-en un nouveau à la personne qui vous a invité.': 'This link has expired. Ask the person who invited you for a new one.',
  'Ce lien d’invitation ne marche pas. Demandez-en un nouveau à la personne qui vous a invité.': 'This invitation link does not work. Ask the person who invited you for a new one.',
  'Invitation': 'Invitation',
  'Ouvrir Parenthèse': 'Open Parenthèse',
  'Gérer « {name} »': 'Manage “{name}”',
  '{name} vous invite à modifier cet arbre avec votre propre compte. L’invitation est pour {email}.': '{name} invites you to edit this tree with your own account. The invitation is for {email}.',
  'Vous êtes invité à modifier cet arbre avec votre propre compte. L’invitation est pour {email}.': 'You are invited to edit this tree with your own account. The invitation is for {email}.',
  'Vous êtes connecté avec {email}.': 'You are signed in as {email}.',
  'Ouverture de l’arbre': 'Opening the tree',
  'Accepter et ouvrir l’arbre': 'Accept and open the tree',
  'Changer de compte': 'Use another account',
  'J’ai déjà un compte Parenthèse': 'I already have a Parenthèse account',
  'Le lien sert une fois et vaut 14 jours.': 'The link works once and lasts 14 days.',
  'L’adresse à laquelle vous avez été invité.': 'The address you were invited at.',
  'Créer mon compte et ouvrir l’arbre': 'Create my account and open the tree',

  // Suppression du compte (AccountDashboard)
  '« {name} » sera supprimé pour tout le monde': '“{name}” will be deleted for everyone',
  '{names} le gèrent avec vous. Ils n’y auront plus accès, la famille non plus.': '{names} manage it with you. They will lose access, and so will the family.',
  '{name} le gère avec vous. Cette personne n’y aura plus accès, la famille non plus.': '{name} manages it with you. They will lose access, and so will the family.',

  // Fiche : droits retirés pendant une modification (PersonCard)
  "Vous ne pouvez plus modifier cet arbre. Rechargez la page pour voir vos droits actuels.": 'You can no longer edit this tree. Reload the page to see your current rights.',

  // Icône de l'arbre (AdminPanel) et bouton du bas (ContextualNavbar)
  "Icône de l'arbre": 'Tree icon',
  'Première lettre': 'First letter',
  "Elle remplace la première lettre dans vos menus et sur la page d'invitation.": 'It replaces the first letter in your menus and on the invitation page.',

  // Erreurs (errorMessages.js)
  "Cette invitation est pour une autre adresse. Utilisez l'adresse à laquelle vous avez été invité.": 'This invitation is for another address. Use the address you were invited at.',
  "Ce lien d'invitation ne marche plus. Demandez-en un nouveau à la personne qui vous a invité.": 'This invitation link no longer works. Ask the person who invited you for a new one.',
  'Vous êtes déjà propriétaire de cet arbre.': 'You already own this tree.',
}
