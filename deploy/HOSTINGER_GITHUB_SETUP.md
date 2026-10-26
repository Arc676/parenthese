# Déploiement de parenthese.io

Ce document concerne l'instance hébergée par Ilies Allali. Pour installer Parenthèse chez vous, suivez plutôt la section « Auto-héberger » du [README](../README.fr.md) (Docker).

## Principe

Chaque push sur `main` lance d'abord la CI (`.github/workflows/ci.yml`). Si elle passe, `.github/workflows/deploy-hostinger.yml` démarre. Le workflow se connecte au serveur en SSH, aligne le dépôt sur `origin/main` sous verrou, puis lance `deploy/deploy.sh`, qui ne réinstalle et ne reconstruit que ce qui a changé depuis le dernier déploiement réussi.

## Secrets du dépôt

- `HOSTINGER_HOST` : adresse du serveur
- `HOSTINGER_PORT` : port SSH (facultatif, 22 par défaut)
- `HOSTINGER_USER` : utilisateur SSH
- `HOSTINGER_SSH_PRIVATE_KEY` : clé privée dont la clé publique est dans `authorized_keys` sur le serveur
- `SSH_KNOWN_HOSTS` : clé d'hôte du serveur, épinglée. La produire depuis une machine de confiance avec `ssh-keyscan -p PORT HÔTE`, comparer l'empreinte (`ssh-keygen -lf`) à celle affichée sur le serveur par `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, puis coller les lignes telles quelles. Sans ce secret, le workflow reprend la clé présentée au moment du run et affiche un avertissement.

## Ce qui vit sur le serveur, hors du dépôt

- `backend/.env` : configuration de production de l'API (voir `backend/.env.production.example`)
- `/etc/parenthese/build.env` : variables de build du front et de la landing (`VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`)
- `/etc/cron.d/parenthese-backup` : sauvegarde nocturne par `deploy/backup.sh`
- `/etc/genealogy/backup.env` (facultatif) : rétention et envoi S3 des sauvegardes
- `/usr/local/sbin/parenthese-ssh-deploy` : copie de `deploy/ssh-deploy.sh`, commande forcée de la clé de déploiement (voir plus bas)

## Prérequis du serveur

Node 20, `pm2` en global, PostgreSQL joignable par `DATABASE_URL`, nginx configuré avec `deploy/nginx.conf`, `pg_dump` et `flock`.

## Déployer à la main

`bash deploy/deploy.sh --sync` depuis le dépôt sur le serveur. `FORCE_FULL=1` pour tout reconstruire. Ne pas le lancer pendant un déploiement GitHub : le verrou le fera attendre.

## Clé de déploiement restreinte

La clé de GitHub ne doit pouvoir que déployer un commit de `main`, jamais lancer une autre commande sur le serveur. On la lie à `deploy/ssh-deploy.sh`, copié hors du dépôt parce que le déploiement réécrit le dépôt :

```
install -m 755 -o root -g root /var/www/parenthese/deploy/ssh-deploy.sh /usr/local/sbin/parenthese-ssh-deploy
```

Puis, dans `authorized_keys`, devant la ligne de la clé `github-actions-parenthese-public` :

```
command="/usr/local/sbin/parenthese-ssh-deploy",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA… github-actions-parenthese-public
```

Le workflow n'a pas à changer. Après une mise à jour de `deploy/ssh-deploy.sh`, refaire l'`install`.
