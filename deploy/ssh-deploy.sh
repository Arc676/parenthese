#!/usr/bin/env bash
# Commande forcée de la clé de déploiement GitHub, posée devant elle dans /root/.ssh/authorized_keys :
#   command="/usr/local/sbin/parenthese-ssh-deploy",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… github-actions-parenthese-public
# Avec elle, la clé ne peut plus que déployer un commit qui appartient déjà à main : une clé volée ne lance aucune
# autre commande. Le workflow « Deploy Hostinger » n'a pas à changer : il envoie
#   FORCE_FULL=<0|1> DEPLOY_SHA=<sha> bash -s
# suivi d'un script sur l'entrée standard. Seuls FORCE_FULL et DEPLOY_SHA sont lus, le script envoyé est ignoré,
# et la suite reprend la même logique (verrou, commit de main, pas de retour en arrière, deploy.sh).
# Installé hors du dépôt, parce que le déploiement réécrit le dépôt pendant qu'il tourne :
#   install -m 755 -o root -g root /var/www/parenthese/deploy/ssh-deploy.sh /usr/local/sbin/parenthese-ssh-deploy
set -euo pipefail

if ! [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^FORCE_FULL=([01])\ DEPLOY_SHA=([0-9a-f]{40})\ bash\ -s$ ]]; then
  echo "Commande refusée : cette clé ne sert qu'à déployer" >&2
  exit 1
fi
FORCE_FULL="${BASH_REMATCH[1]}"
DEPLOY_SHA="${BASH_REMATCH[2]}"
# Le script envoyé par le workflow n'est pas exécuté
cat > /dev/null

cd /var/www/parenthese
exec flock -w 900 /tmp/parenthese-deploy.lock env PARENTHESE_DEPLOY_LOCKED=1 FORCE_FULL="$FORCE_FULL" DEPLOY_SHA="$DEPLOY_SHA" bash -c '
  set -euo pipefail
  git fetch -q origin main
  # Le commit validé doit appartenir à main
  if ! git merge-base --is-ancestor "$DEPLOY_SHA" origin/main; then
    echo "Commit $DEPLOY_SHA absent de main : rien n est déployé" >&2
    exit 1
  fi
  # Un déploiement plus récent est déjà en ligne : pas de retour en arrière
  if [ "$(git rev-parse HEAD)" != "$DEPLOY_SHA" ] && git merge-base --is-ancestor "$DEPLOY_SHA" HEAD; then
    echo "Version plus récente déjà déployée, $DEPLOY_SHA ignoré"
    exit 0
  fi
  git reset -q --hard "$DEPLOY_SHA"
  bash deploy/deploy.sh
'
