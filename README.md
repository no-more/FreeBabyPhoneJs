# FreeBabyPhoneJs

Babyphone audio **peer-to-peer** (WebRTC) entre deux navigateurs, **sans serveur**, **sans compte**, **sans installation**. Appairage par **QR code**.

- **Émetteur** = téléphone laissé près du bébé (capte le micro).
- **Récepteur** = téléphone des parents (joue l'audio).
- Fonctionne **en local** (même Wi-Fi). Pas de TURN, pas de signaling, pas d'analytics.

Ouvrez le site sur les deux téléphones, installez-le comme app (*Add to home screen*), et suivez les étapes à l'écran.

## Réglages Android recommandés

La qualité du babyphone dépend **beaucoup plus des réglages Android** que du code. Chrome est très agressivement mis en veille en arrière-plan par défaut — sans ces réglages, l'audio peut se couper au bout de quelques minutes même écran allumé.

À faire **sur les deux téléphones** (Émetteur et Récepteur).

### 1. Installer l'app comme PWA (obligatoire)

Dans Chrome : menu ⋮ → **Ajouter à l'écran d'accueil** → *Installer*.

L'app installée est beaucoup mieux traitée par Android que l'onglet navigateur (moins de throttling, durée de vie en arrière-plan plus longue).

**Lancez-la ensuite depuis l'icône de l'écran d'accueil**, pas depuis Chrome.

### 2. Désactiver l'optimisation de batterie pour l'app

Réglages → **Applications** → *Babyphone* (ou *Chrome* si vous n'avez pas installé la PWA) → **Batterie** → **Sans restriction** (ou *Non optimisée*).

Sans ça, Android Doze peut tuer l'onglet quand l'écran est éteint.

### 3. Laisser le téléphone chargé

L'Émetteur doit rester **branché au secteur**. Wake Lock empêche la mise en veille de l'écran mais consomme beaucoup.

### 4. Garder le Wi-Fi actif en veille

Réglages → **Wi-Fi** → ⚙️ (paramètres avancés) → **Garder le Wi-Fi actif en veille** → **Toujours**.

(Le chemin varie selon la marque ; chercher "Wi-Fi en veille" ou "Wi-Fi during sleep".)

### 5. Désactiver l'économiseur de batterie

Réglages → **Batterie** → **Économiseur de batterie** → **Désactivé** pendant l'utilisation.

L'économiseur met en pause les applis en arrière-plan, peu importe le réglage par app.

### 6. Autoriser le micro en permanence (Émetteur)

Réglages → **Applications** → *Babyphone* → **Autorisations** → **Microphone** → **Autoriser uniquement lors de l'utilisation** (ou *Toujours autoriser* si proposé).

### 7. Volume média à fond (Récepteur)

Le son passe par le **canal média**, pas sonnerie. Montez le volume **média** avant de verrouiller l'écran. Désactivez le mode *Ne pas déranger*, ou autorisez-y les médias.

### 8. Écran

- **Ne verrouillez pas manuellement** l'écran avec le bouton Power — ça désactive le Wake Lock.
- Laissez l'écran s'éteindre naturellement (Wake Lock le garde allumé tant que l'onglet est actif).
- Augmentez le **Délai d'extinction de l'écran** au maximum (Réglages → Affichage) par sécurité.

### 9. Réglages spécifiques par fabricant

Les surcouches Android sont particulièrement agressives. Cherchez ces options :

**Samsung (One UI)**
- Réglages → **Entretien de l'appareil** → **Batterie** → **Limites d'utilisation en arrière-plan** → retirer *Babyphone* des "Applications en veille" et "Applications en veille profonde".
- Désactivez **Mettre en veille les applications inutilisées**.
- Réglages → Batterie → **Optimisation adaptative** → Désactivée pour *Babyphone*.

**Xiaomi / Redmi / POCO (MIUI / HyperOS)**
- Réglages → **Applications** → *Babyphone* → **Économie de batterie** → **Aucune restriction**.
- Même écran → **Démarrage automatique** → **Activé**.
- Dans le menu des applications récentes : appuyer longuement sur la carte → **cadenas** 🔒 pour empêcher la fermeture.

**Huawei / Honor (EMUI / MagicOS)**
- Réglages → **Batterie** → **Démarrage d'applications** → *Babyphone* → **Gérer manuellement** → activer **Démarrage automatique**, **Démarrage secondaire**, **Exécution en arrière-plan**.

**OnePlus / Oppo (OxygenOS / ColorOS)**
- Réglages → **Batterie** → **Optimisation de la batterie** → *Babyphone* → **Ne pas optimiser**.
- Réglages → Batterie → **Optimisation avancée** / **Deep Optimization** → **Désactivée** pour *Babyphone*.

**Google Pixel (Android stock)**
- Réglages → **Applications** → *Babyphone* → **Batterie** → **Sans restriction**.
- Réglages → Batterie → **Batterie adaptative** → désactiver, ou laisser activé si vous avez déjà réglé le point précédent.

### 10. Notifications (optionnel mais utile)

Autorisez les notifications pour *Babyphone* : Android peut alors maintenir l'app vivante plus longtemps quand elle est considérée comme "en cours d'exécution".

## Check-list rapide avant la nuit

- [ ] PWA installée sur les 2 téléphones (icône sur l'écran d'accueil).
- [ ] Les 2 téléphones sur le **même Wi-Fi**.
- [ ] Émetteur **branché au chargeur**.
- [ ] Optimisation de batterie **désactivée** pour l'app (sur les 2).
- [ ] Économiseur de batterie **désactivé** (sur les 2).
- [ ] Volume **média** à fond sur le Récepteur.
- [ ] Appairage fait (QR code scanné) — au prochain lancement, la reconnexion est automatique.
- [ ] **Ne pas verrouiller manuellement l'écran** de l'Émetteur.

## Limitations connues

- Pas de TURN → fonctionne uniquement en **Wi-Fi local** (pas entre deux réseaux).
- Pas de détection de pleurs, pas de talk-back, pas de vidéo.
- Si le téléphone change de réseau (Wi-Fi/4G bascule, redémarrage box), il faut re-scanner un QR code.
- iOS : fonctionne sur Safari récent (iOS 16.4+ minimum pour la compression des SDP).

## Développement

Trois fichiers statiques : `index.html`, `script.js`, `style.css`. Plus : `manifest.webmanifest`, `sw.js`, `icon.svg`. Déploiement via GitHub Pages (`.github/workflows/deploy.yml`).

Aucune étape de build, aucune dépendance npm. Tester en local :

```bash
npx serve .
```

Puis ouvrir `https://<ip-locale>:3000` sur les deux téléphones (HTTPS requis pour le micro — utilisez un reverse proxy ou un tunnel HTTPS type `ngrok` si besoin).
