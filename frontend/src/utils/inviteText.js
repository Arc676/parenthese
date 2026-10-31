import { t } from '../i18n/index.js'
import { HELP_URL } from './siteLinks.js'

// Du 1er décembre au 6 janvier, la famille se retrouve : le message d'invitation parle de Noël
export function isChristmasSeason(now = new Date()) {
  return now.getMonth() === 11 || (now.getMonth() === 0 && now.getDate() <= 6)
}

// Message d'invitation prêt à envoyer par mail, SMS ou WhatsApp. seasonal : l'instance l'autorise (SIGNUP_PROMPTS)
export function buildInviteText(url, password, { seasonal = false, now = new Date() } = {}) {
  return [
    t('Bonjour à tous,'),
    '',
    seasonal && isChristmasSeason(now)
      ? t("Pour Noël, j'ai mis l'arbre de notre famille en ligne. Regardez-le avant le réveillon, et apportez vos vieilles photos, on le complétera ensemble à table.")
      : t("Je rassemble l'histoire de notre famille dans un arbre en ligne, et j'aimerais que vous m'aidiez à le compléter."),
    '',
    t("L'arbre est ici {url}", { url }),
    t("Le mot de passe pour l'ouvrir est {password}", { password }),
    '',
    t("En bas de l'écran, vous pouvez ajouter une photo, un souvenir ou une personne qui manque."),
    t("Le mode d'emploi, si besoin {url}", { url: HELP_URL }),
  ].join('\n')
}
