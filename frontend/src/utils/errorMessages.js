import { t } from '../i18n/index.js'

export function getShareErrorMessage(error) {
  if (error?.status === 401) {
    return t('Mot de passe invalide ou accès expiré.')
  }

  if (error?.status === 404) {
    return t('Arbre introuvable.')
  }

  if (error?.status === 429) {
    return t('Trop de tentatives. Réessayez dans une minute.')
  }

  return t('Connexion backend impossible. Vérifiez API/DB puis réessayez.')
}

export function getAccountDeletionErrorMessage(error, confirmation = {}) {
  // Compte sans mot de passe (connexion OIDC) : l'email retapé, et une connexion récente chez le fournisseur
  if (error?.payload?.error === 'recent_sign_in_required') {
    return t('Pour supprimer le compte, reconnectez-vous avec votre fournisseur de connexion, puis recommencez dans le quart d’heure.')
  }

  if (error?.status === 403 && confirmation.confirmEmail !== undefined) {
    return t("Cette adresse n'est pas celle du compte.")
  }

  if (error?.status === 403) {
    return t('Mot de passe incorrect.')
  }

  if (error?.status === 401) {
    return t('Session expirée. Reconnectez-vous puis réessayez.')
  }

  if (error?.status === 400) {
    return t('Saisissez votre mot de passe actuel.')
  }

  if (error?.status === 429) {
    return t('Trop de tentatives. Réessayez dans une minute.')
  }

  return t('Impossible de supprimer le compte pour le moment. Réessayez plus tard.')
}

export function getAccountErrorMessage(error) {
  const errorCode = error?.payload?.error || error?.message || ''

  if (errorCode === 'image_too_large') {
    return t('Image trop volumineuse (maximum 5 Mo).')
  }

  if (errorCode === 'invalid_avatar_mime_type') {
    return t("Format d'avatar invalide. Utilisez une image.")
  }

  if (errorCode === 'size_mismatch' || errorCode === 'invalid_base64_data' || errorCode === 'empty_media_file') {
    return t('Le fichier média envoyé est invalide.')
  }

  if (errorCode === 'invalid_media_mime_type') {
    return t('Le format de fichier ne correspond pas au type de média choisi.')
  }

  if (errorCode === 'contribution_session_already_reviewed') {
    return t('Cette proposition a déjà été relue, peut-être par une autre personne qui gère l’arbre.')
  }

  if (errorCode === 'photo_too_large') {
    return t('Cette photo est trop lourde. Essayez une photo plus petite.')
  }

  if (errorCode === 'too_many_pending_photos') {
    return t("Beaucoup de photos attendent déjà la relecture sur cet arbre. Réessayez quand la personne qui le gère les aura vues.")
  }

  if (errorCode === 'invalid_annotation_photo_mime_type') {
    return t('Ce fichier n’est pas une photo que Parenthèse sait afficher (JPEG, PNG, WebP ou GIF).')
  }

  if (errorCode === 'storage_quota_exceeded') {
    return t("L'arbre n'a plus de place pour de nouveaux souvenirs. Son propriétaire peut en supprimer.")
  }

  if (errorCode === 'password_login_disabled') {
    return t('Sur cette instance, la connexion passe par le bouton du fournisseur.')
  }

  if (errorCode === 'oidc_email_unverified') {
    return t("Votre fournisseur de connexion n'indique pas que votre adresse email est vérifiée. Vérifiez-la chez lui, puis réessayez.")
  }

  if (errorCode === 'oidc_identity_taken') {
    return t('Ce compte du fournisseur est déjà relié à un autre compte Parenthèse.')
  }

  if (errorCode === 'oidc_link_expired') {
    return t('Le lien pour relier le compte a expiré. Recommencez depuis votre compte.')
  }

  if (errorCode === 'oidc_email_taken') {
    return t("Un compte avec mot de passe existe déjà pour cette adresse. Connectez-vous avec votre email et votre mot de passe.")
  }

  if (errorCode === 'oidc_email_missing') {
    return t("Votre fournisseur de connexion n'a pas donné d'adresse email. La personne qui héberge l'instance doit autoriser le partage de l'email.")
  }

  if (errorCode === 'oidc_unavailable') {
    return t('Le fournisseur de connexion ne répond pas. Réessayez dans un moment.')
  }

  if (errorCode === 'oidc_failed' || errorCode === 'invalid_handoff') {
    return t("La connexion n'a pas abouti. Réessayez.")
  }

  if (errorCode === 'registration_closed') {
    return t("Cette instance n'accepte plus de nouveaux comptes. Demandez à la personne qui l'héberge.")
  }

  // Lien d'invitation à co-gérer un arbre (issue #145)
  if (errorCode === 'invitation_email_mismatch') {
    return t("Cette invitation est pour une autre adresse. Utilisez l'adresse à laquelle vous avez été invité.")
  }

  if (errorCode === 'invitation_invalid' || errorCode === 'invitation_used' || errorCode === 'invitation_expired') {
    return t("Ce lien d'invitation ne marche plus. Demandez-en un nouveau à la personne qui vous a invité.")
  }

  if (errorCode === 'already_owner') {
    return t('Vous êtes déjà propriétaire de cet arbre.')
  }

  if (errorCode === 'citation_text_required') {
    return t('Ajoutez le texte de la citation.')
  }

  if (errorCode === 'database_error' || (error?.status === 500 && error?.payload?.error === 'database_error')) {
    return t("Erreur base de données. Lancez `npm run prisma:deploy` puis redémarrez l'API.")
  }

  if (error?.status === 503 && error?.message === 'database_unavailable') {
    return t('Base de données indisponible. Lancez `npm run db:bootstrap` dans le backend.')
  }

  if (error?.status === 400) {
    if (error?.message === 'invalid_payload' || error?.payload?.error === 'invalid_payload') {
      const fieldErrors = error?.payload?.details?.fieldErrors || {}
      const formErrors = error?.payload?.details?.formErrors || []

      if (fieldErrors.slug?.length) {
        return t('Slug invalide : 3-64 caractères, uniquement lettres minuscules, chiffres et tirets.')
      }

      if (fieldErrors.name?.length) {
        return t("Nom d'arbre invalide : entre 2 et 120 caractères.")
      }

      if (fieldErrors.visitorPassword?.length || fieldErrors.contributorPassword?.length) {
        return t('Mots de passe invalides : entre 8 et 128 caractères.')
      }

      const firstField = Object.keys(fieldErrors)[0]
      if (firstField && Array.isArray(fieldErrors[firstField]) && fieldErrors[firstField].length > 0) {
        return `${firstField}: ${fieldErrors[firstField][0]}`
      }

      if (Array.isArray(formErrors) && formErrors.length > 0) {
        return t('Erreur formulaire : {error}', { error: formErrors[0] })
      }
    }

    return t('Données invalides. Vérifiez les champs.')
  }

  if (error?.status === 401) {
    return t('Session invalide ou identifiants incorrects.')
  }

  if (error?.status === 403) {
    return t('Accès refusé pour cet arbre.')
  }

  if (error?.status === 404) {
    return t('Ressource introuvable.')
  }

  if (error?.status === 409) {
    return t('Conflit détecté (email ou slug déjà utilisé).')
  }

  if (error?.status === 429) {
    return t('Trop de tentatives. Réessayez dans une minute.')
  }

  return t("Erreur backend. Vérifiez que l'API et la base sont lancées.")
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('invalid_file_reader_result'))
        return
      }

      const commaIndex = reader.result.indexOf(',')
      if (commaIndex < 0) {
        reject(new Error('invalid_data_url'))
        return
      }

      resolve(reader.result.slice(commaIndex + 1))
    }

    reader.onerror = () => {
      reject(reader.error || new Error('file_read_failed'))
    }

    reader.readAsDataURL(file)
  })
}
