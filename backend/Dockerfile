FROM node:18-alpine

WORKDIR /app

# Copia i file di dipendenze e installa i pacchetti
COPY package*.json ./
RUN npm install --production

# Copia il codice sorgente e le citazioni
COPY server.js ./
COPY padrepio.txt ./

EXPOSE 5000

CMD ["node", "server.js"]