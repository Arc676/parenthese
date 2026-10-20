import { useState } from 'react'
import {
  deleteAccount,
  exchangeOidcCode,
  fetchAccountProfile,
  fetchLastOpenedTree,
  loginUser,
  logoutUser,
  registerUser,
  updateLastOpenedTree,
} from '../api/authApi'
import { listTrees } from '../api/treeApi'
import * as errorMessages from '../utils/errorMessages'
import { t } from '../i18n/index.js'
import { clearAccountLocalData } from '../utils/localHygiene.js'

const USER_TOKEN_STORAGE_KEY = 'user_auth_token'
const USER_PROFILE_STORAGE_KEY = 'user_auth_profile'
const getAccountErrorMessage = errorMessages.getAccountErrorMessage
  || (() => t("Erreur backend. Vérifiez que l'API et la base sont lancées."))

function saveUserProfile(user) {
  if (!user) {
    localStorage.removeItem(USER_PROFILE_STORAGE_KEY)
    return
  }

  localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(user))
}

function loadUserProfile() {
  const raw = localStorage.getItem(USER_PROFILE_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function useAuth() {
  const [userAuth, setUserAuth] = useState({ token: '', user: loadUserProfile() })
  const [accountTrees, setAccountTrees] = useState([])
  const [lastOpenedTree, setLastOpenedTree] = useState(null)
  const [accountLoading, setAccountLoading] = useState(false)
  const [accountError, setAccountError] = useState('')

  const authenticated = Boolean(userAuth.token)

  // Prénom du compte : lu sur le serveur, gardé dans le profil local pour le bandeau de la porte
  const refreshAccountProfile = async (token) => {
    try {
      const response = await fetchAccountProfile(token)
      if (!response?.user) return
      const merged = { ...(loadUserProfile() || {}), ...response.user }
      saveUserProfile(merged)
      setUserAuth((current) => (current.token === token ? { ...current, user: merged } : current))
    } catch {
      // Profil non lu : le bandeau reste neutre, la session n'est pas touchée
    }
  }

  const loadAccountTrees = async (token) => {
    const [response] = await Promise.all([listTrees(token), refreshAccountProfile(token)])
    const trees = Array.isArray(response?.trees) ? response.trees : []
    const lastTree = response?.lastOpenedTree || null
    setAccountTrees(trees)
    setLastOpenedTree(lastTree)
    return { trees, lastOpenedTree: lastTree }
  }

  const handleLogin = (email, password) => signIn(() => loginUser(email, password))

  // Retour d'une connexion OIDC : le jeton de passage devient une session, comme une connexion par mot de passe
  const handleOidcExchange = (code) => signIn(() => exchangeOidcCode(code))

  const signIn = async (request) => {
    setAccountLoading(true)
    setAccountError('')

    try {
      const result = await request()
      const storedProfile = loadUserProfile()
      const mergedUser = {
        ...(storedProfile && storedProfile.email === result.user?.email ? storedProfile : {}),
        ...(result.user || {}),
      }
      localStorage.setItem(USER_TOKEN_STORAGE_KEY, result.token)
      saveUserProfile(mergedUser || null)
      setUserAuth({ token: result.token, user: mergedUser })
      await Promise.all([
        loadAccountTrees(result.token),
        fetchLastOpenedTree(result.token).then((lastTree) => {
          if (lastTree) setLastOpenedTree(lastTree)
        }).catch(() => {}),
      ])
      return true
    } catch (error) {
      setAccountError(getAccountErrorMessage(error))
      return false
    } finally {
      setAccountLoading(false)
    }
  }

  const handleRegister = async (firstName, email, password) => {
    setAccountLoading(true)
    setAccountError('')

    try {
      const result = await registerUser(firstName, email, password)
      const mergedUser = {
        ...(result.user || {}),
        firstName: firstName || result.user?.firstName || '',
      }
      localStorage.setItem(USER_TOKEN_STORAGE_KEY, result.token)
      saveUserProfile(mergedUser || null)
      setUserAuth({ token: result.token, user: mergedUser })
      await Promise.all([
        loadAccountTrees(result.token),
        fetchLastOpenedTree(result.token).then((lastTree) => {
          if (lastTree) setLastOpenedTree(lastTree)
        }).catch(() => {}),
      ])
      return true
    } catch (error) {
      setAccountError(getAccountErrorMessage(error))
      return false
    } finally {
      setAccountLoading(false)
    }
  }

  const handleLogout = async () => {
    const token = userAuth.token
    setAccountLoading(true)
    setAccountError('')

    try {
      if (token) {
        await logoutUser(token)
      }
    } catch {
      // ignore logout errors and clear local session anyway
    } finally {
      localStorage.removeItem(USER_TOKEN_STORAGE_KEY)
      // Brouillons, fiche « c'est moi » et profil : rien du compte ne reste pour la personne suivante
      clearAccountLocalData()
      setUserAuth({ token: '', user: null })
      setAccountTrees([])
      setLastOpenedTree(null)
      setAccountLoading(false)
    }
  }

  const restoreUserToken = () => localStorage.getItem(USER_TOKEN_STORAGE_KEY)

  const clearStoredUserToken = () => {
    localStorage.removeItem(USER_TOKEN_STORAGE_KEY)
    localStorage.removeItem(USER_PROFILE_STORAGE_KEY)
    setUserAuth({ token: '', user: null })
    setAccountTrees([])
    setLastOpenedTree(null)
  }

  // Renvoie null en cas de succès (session locale effacée), sinon un message d'erreur affichable.
  const handleDeleteAccount = async (confirmation) => {
    const token = userAuth.token
    if (!token) {
      return errorMessages.getAccountDeletionErrorMessage({ status: 401 })
    }

    try {
      await deleteAccount(token, confirmation)
    } catch (error) {
      return errorMessages.getAccountDeletionErrorMessage(error, confirmation)
    }

    clearStoredUserToken()
    clearAccountLocalData()
    return null
  }

  const persistLastOpenedTree = async (payload) => {
    if (!userAuth.token) {
      return null
    }

    try {
      const updated = await updateLastOpenedTree(userAuth.token, payload)
      if (updated) setLastOpenedTree(updated)
      return updated
    } catch {
      return null
    }
  }

  return {
    userAuth, setUserAuth,
    accountTrees,
    lastOpenedTree,
    accountLoading, setAccountLoading,
    accountError, setAccountError,
    authenticated,
    loadAccountTrees,
    handleLogin,
    handleRegister,
    handleOidcExchange,
    handleLogout,
    handleDeleteAccount,
    restoreUserToken,
    restoreUserProfile: loadUserProfile,
    clearStoredUserToken,
    persistLastOpenedTree,
  }
}
