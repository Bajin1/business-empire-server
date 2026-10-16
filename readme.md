# Business Empire — Serveur WebSocket

Serveur Node.js qui gère les salles et le relais de messages entre l'hôte et les clients du jeu **Business Empire**.

## 🚀 Déploiement sur Render

1. Poussez ce dossier sur GitHub
2. Sur Render : **New → Web Service**
3. Connectez votre repo
4. Render détecte `render.yaml` et configure tout automatiquement :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Health Check** : `/health`
5. Notez l'URL générée, par ex. :