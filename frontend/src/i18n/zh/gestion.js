// Traductions chinoises, clé = texte français exact passé à t().
// Co-gestion d'un arbre (issue #145) : onglet Gestion, page du lien d'invitation, suppression du compte
export default {
  // Onglet Gestion (TreeManagersSection)
  'Gestion': '管理',
  'Co-gestionnaire': '共同管理者',
  'Cette adresse gère déjà cet arbre.': '这个邮箱地址已经在管理这棵家谱树。',
  'Cette adresse email ne semble pas valide.': '这个邮箱地址看起来无效。',
  'Trop d’invitations en attente. Annulez-en une avant d’en envoyer une autre.': '待处理邀请过多。先取消其中一个，再发送新的。',
  'Impossible de charger les gestionnaires.': '无法加载管理者。',
  'Impossible d’envoyer l’invitation.': '无法发送邀请。',
  'Impossible de créer le lien.': '无法创建链接。',
  'Impossible d’annuler l’invitation.': '无法取消邀请。',
  'Impossible de retirer ce co-gestionnaire.': '无法移除这个共同管理者。',
  'Les co-gestionnaires modifient l’arbre directement et valident les propositions de la famille, comme vous. Seul le propriétaire invite, retire un co-gestionnaire ou supprime l’arbre.': '共同管理者会像你一样直接修改树，并审核家人的建议。只有所有者才能邀请、移除共同管理者或删除家谱树。',
  'Retrait en cours': '正在移除',
  'Invité le {date}, en attente': '于{date}邀请，等待中',
  'Création du lien': '正在创建链接',
  'Copier le lien': '复制链接',
  'Annulation en cours': '正在取消',
  'Lien pour {email}': '{email}的链接',
  'Lien d’invitation': '邀请链接',
  'Envoyez-le par message ou par mail. Il sert une fois et vaut 14 jours. « Copier le lien » en crée un nouveau, l’ancien ne marche plus.': '通过短信或邮件把它发送给对方。它只能被使用一次，14 天内有效。“复制链接”会生成一个新链接，旧链接将失效。',
  '{name} ne gère plus cet arbre.': '{name}不再管理这棵家谱树。',
  'Cette personne a pu voir le mot de passe de partage : avec lui, elle peut encore ouvrir l’arbre en lecture. Pour lui couper aussi la lecture, changez-le, puis donnez le nouveau à la famille.': '这个人曾经能查看共享密码：用它仍然可以查看家谱树。若想让他也失去阅读权利，请更改密码，然后把新密码发给家人。',
  'Changer le mot de passe de partage': '更改共享密码',
  'Inviter un co-gestionnaire': '邀请共同管理者',
  'Son adresse email': '他的邮箱',
  'prenom@exemple.fr': 'xiaolong@example.cn',
  'Invitation en cours': '正在邀请',
  'Inviter': '邀请',
  'Parenthèse n’envoie pas de mail : vous recevez un lien à lui transmettre. S’il se connecte avec {name} et cette adresse, il est ajouté sans le lien.': 'Parenthèse不会发邮件：你会拿到一个链接交给对方。如果他使用{name}和这个邮箱地址登录，就会直接添加，不需要链接。',
  'Parenthèse n’envoie pas de mail : vous recevez un lien à lui transmettre.': 'Parenthèse不会发邮件：你会拿到一个链接交给对方。',

  // Avancé, pour un co-gestionnaire (AdminPanel)
  'Impossible de quitter la gestion de cet arbre.': '无法退出对这棵树的管理。',
  'Quitter la gestion de cet arbre': '退出对这棵树的管理',
  'Vous ne pourrez plus le modifier. Seul son propriétaire peut le supprimer.': '你以后将不能再修改它。只有它的所有者才能删除它。',
  'Rester': '保留',
  'Quitter': '退出',

  // Page du lien d'invitation (InvitationScreen)
  'Ce lien a déjà servi. Si c’était le vôtre, l’arbre est dans vos arbres.': '这个链接已经用过了。如果这是你的链接，那这棵家谱树就在你的家谱树中。',
  'Ce lien a expiré. Demandez-en un nouveau à la personne qui vous a invité.': '这个链接已过期。请向邀请你的人申请新的链接。',
  'Ce lien d’invitation ne marche pas. Demandez-en un nouveau à la personne qui vous a invité.': '这个邀请链接无法使用。请向邀请你的人申请新的链接。',
  'Invitation': '邀请',
  'Ouvrir Parenthèse': '打开Parenthèse',
  'Gérer « {name} »': '管理《{name}》',
  '{name} vous invite à modifier cet arbre avec votre propre compte. L’invitation est pour {email}.': '{name}邀请你用自己的账号修改这棵树。邀请对象是{email}。',
  'Vous êtes invité à modifier cet arbre avec votre propre compte. L’invitation est pour {email}.': '你被邀请用自己的账号修改这棵树。邀请对象是{email}。',
  'Vous êtes connecté avec {email}.': '你当前登录的是{email}。',
  'Ouverture de l’arbre': '正在打开家谱树',
  'Accepter et ouvrir l’arbre': '接受并打开家谱树',
  'Changer de compte': '切换账号',
  'J’ai déjà un compte Parenthèse': '我已经有Parenthèse账号',
  'Le lien sert une fois et vaut 14 jours.': '这个链接只能用一次，14天有效。',
  'L’adresse à laquelle vous avez été invité.': '你被邀请使用的地址。',
  'Créer mon compte et ouvrir l’arbre': '创建我的账号并打开家谱树',

  // Suppression du compte (AccountDashboard)
  '« {name} » sera supprimé pour tout le monde': '《{name}》将为所有人被删除',
  '{names} le gèrent avec vous. Ils n’y auront plus accès, la famille non plus.': '{names}和你一起管理它。之后他们将失去访问权利，家人也一样。',
  '{name} le gère avec vous. Cette personne n’y aura plus accès, la famille non plus.': '{name}和你一起管理它。这个人之后将失去访问权利，家人也一样。',

  // Fiche : droits retirés pendant une modification (PersonCard)
  "Vous ne pouvez plus modifier cet arbre. Rechargez la page pour voir vos droits actuels.": '你不能再修改这棵树了。刷新页面以查看你当前的权利。',

  // Icône de l'arbre (AdminPanel) et bouton du bas (ContextualNavbar)
  "Icône de l'arbre": '家谱树图标',
  'Première lettre': '首字母',
  "Elle remplace la première lettre dans vos menus et sur la page d'invitation.": '它会替代你菜单和邀请页中的首字母。',

  // Erreurs (errorMessages.js)
  "Cette invitation est pour une autre adresse. Utilisez l'adresse à laquelle vous avez été invité.": '这个邀请对应另一地址。请使用你被邀请时使用的地址。',
  "Ce lien d'invitation ne marche plus. Demandez-en un nouveau à la personne qui vous a invité.": '这个邀请链接已失效。请向邀请你的人申请新的链接。',
  'Vous êtes déjà propriétaire de cet arbre.': '你已经是这棵家谱树的所有者。',
}
