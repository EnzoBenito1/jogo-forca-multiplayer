

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

class HangmanServer {
    constructor() {
        this.port = 8080;
        this.clients = new Map();
        this.gameState = {
            word: '',
            guessedWord: '',
            wrongGuesses: 0,
            maxWrongGuesses: 6,
            guessedLetters: [],
            players: {},
            currentRound: 1,
            gameActive: false,
            gameOver: false,
            isWon: false
        };
        
        this.words = [
            'UBUNTU', 'DEEPIN', 'MANJARO', 'ARCHLINUX',
            'STEAMOS', 'WINDOWS', 'FEDORA', 'SOLUS',
            'ANDROID', 'IOS', 'OPENSUSE', 'MACOS',
            'ENDEAVOROS', 'ELEMENTARYOS', 'MINT', 'KUBUNTU',
            'LUBUNTU', 'POPOS', 'ZORINOS', 'XUBUNTU',
            'GENTOO', 'BIGLINUX', 'DEBIAN', 'NIXOS',
            'KDENEON', 'CHROMEOS', 'NOBARA', 'REGATAOS'
        ];

        this.initializeServer();
        this.startNewGame();
    }

    initializeServer() {
        
        const server = http.createServer((req, res) => {
            if (req.url === '/' || req.url === '/index.html') {
                this.serveIndexFile(res);
            } else if (req.url === '/favicon.ico') {
                res.writeHead(404);
                res.end();
            } else {
                res.writeHead(404);
                res.end('Página não encontrada');
            }
        });

        
        this.wss = new WebSocket.Server({ 
            server,
            perMessageDeflate: false
        });

        this.wss.on('connection', (ws, req) => {
            console.log('Nova conexão WebSocket estabelecida');
            
            
            ws.isAlive = true;
            ws.on('pong', () => {
                ws.isAlive = true;
            });
            
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message.toString());
                    this.handleMessage(ws, data);
                } catch (error) {
                    console.error('Erro ao processar mensagem:', error);
                    this.sendError(ws, 'Mensagem inválida');
                }
            });

            ws.on('close', () => {
                this.handleDisconnection(ws);
            });

            ws.on('error', (error) => {
                console.error('Erro WebSocket:', error);
                this.handleDisconnection(ws);
            });
        });

        
        const interval = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    this.handleDisconnection(ws);
                    return ws.terminate();
                }
                
                ws.isAlive = false;
                ws.ping();
            });
        }, 30000);

        this.wss.on('close', () => {
            clearInterval(interval);
        });

        server.listen(this.port, () => {
            console.log(`🚀 Servidor rodando em http://localhost:${this.port}`);
            console.log(`📡 WebSocket disponível em ws://localhost:${this.port}`);
        });
    }

    serveIndexFile(res) {
        const indexPath = path.join(__dirname, 'index.html');
        
        
        if (fs.existsSync(indexPath)) {
            fs.readFile(indexPath, 'utf8', (err, data) => {
                if (err) {
                    res.writeHead(500);
                    res.end('Erro interno do servidor');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(data);
            });
        } else {
            
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Servidor Ativo</title>
                <meta charset="UTF-8">
            </head>
            <body>
                <h1>Servidor WebSocket está rodando!</h1>
                <p>Conecte-se usando: ws://localhost:8080</p>
                <p>Para jogar, você precisa do arquivo index.html na mesma pasta do servidor.</p>
            </body>
            </html>
            `);
        }
    }

    handleMessage(ws, data) {
        try {
            switch (data.type) {
                case 'join':
                    this.handlePlayerJoin(ws, data);
                    break;
                case 'guess':
                    this.handleGuess(ws, data);
                    break;
                case 'newGame':
                    this.handleNewGameRequest(ws);
                    break;
                case 'ping':
                    this.sendToClient(ws, { type: 'pong' });
                    break;
                default:
                    console.log('Tipo de mensagem desconhecido:', data.type);
                    this.sendError(ws, 'Tipo de mensagem não reconhecido');
            }
        } catch (error) {
            console.error('Erro ao processar mensagem:', error);
            this.sendError(ws, 'Erro interno do servidor');
        }
    }

    handlePlayerJoin(ws, data) {
        const playerName = data.playerName?.trim();
        
        if (!playerName) {
            this.sendError(ws, 'Nome é obrigatório');
            return;
        }

        if (playerName.length > 15) {
            this.sendError(ws, 'Nome muito longo! Máximo 15 caracteres.');
            return;
        }

        
        const existingPlayer = Object.values(this.gameState.players).find(p => 
            p.name.toLowerCase() === playerName.toLowerCase() && p.isOnline
        );

        if (existingPlayer) {
            this.sendError(ws, 'Nome já está em uso');
            return;
        }

        
        this.clients.set(ws, playerName);
        
        if (this.gameState.players[playerName]) {
            
            this.gameState.players[playerName].isOnline = true;
        } else {
            
            this.gameState.players[playerName] = {
                name: playerName,
                score: 0,
                isOnline: true,
                joinedAt: new Date().toISOString()
            };
        }

        
        this.sendToClient(ws, {
            type: 'gameState',
            gameState: this.getClientGameState()
        });

        
        this.broadcast({
            type: 'playerJoined',
            playerName: playerName,
            players: this.gameState.players
        });

        this.broadcast({
            type: 'message',
            message: `${playerName} entrou no jogo!`
        });

        console.log(`Jogador ${playerName} entrou no jogo (Total: ${Object.keys(this.gameState.players).length})`);
    }

    handleGuess(ws, data) {
        const playerName = this.clients.get(ws);
        const letter = data.letter?.toUpperCase();

        if (!playerName) {
            this.sendError(ws, 'Jogador não identificado');
            return;
        }

        if (!letter || letter.length !== 1 || !/[A-Z]/.test(letter)) {
            this.sendError(ws, 'Letra inválida');
            return;
        }

        if (!this.gameState.gameActive || this.gameState.gameOver) {
            this.sendError(ws, 'Jogo não está ativo');
            return;
        }

        if (this.gameState.guessedLetters.includes(letter)) {
            this.sendError(ws, 'Letra já foi tentada');
            return;
        }

        
        this.gameState.guessedLetters.push(letter);
        const isCorrect = this.gameState.word.includes(letter);

        if (isCorrect) {
            
            this.updateGuessedWord(letter);
            
            
            this.gameState.players[playerName].score += 10;

            this.broadcast({
                type: 'message',
                message: `${playerName} acertou a letra "${letter}"! 🎉`
            });
        } else {
            this.gameState.wrongGuesses++;
            
            this.broadcast({
                type: 'message',
                message: `${playerName} errou... A letra "${letter}" não está na palavra. 😞`
            });
        }

        
        this.checkGameEnd();

        
        this.broadcastGameState();
    }

    updateGuessedWord(letter) {
        let newGuessedWord = '';
        for (let i = 0; i < this.gameState.word.length; i++) {
            if (this.gameState.word[i] === letter) {
                newGuessedWord += letter;
            } else {
                newGuessedWord += this.gameState.guessedWord[i] || '_';
            }
        }
        this.gameState.guessedWord = newGuessedWord;
    }

    handleNewGameRequest(ws) {
        const playerName = this.clients.get(ws);
        
        if (!playerName) {
            this.sendError(ws, 'Jogador não identificado');
            return;
        }

        
        if (Object.keys(this.gameState.players).length > 0) {
            this.startNewGame();
            this.broadcast({
                type: 'message',
                message: `${playerName} iniciou uma nova palavra!`
            });
        }
    }

    checkGameEnd() {
        const wordComplete = !this.gameState.guessedWord.includes('_');
        
        if (wordComplete) {
            this.gameState.gameOver = true;
            this.gameState.isWon = true;
            this.gameState.gameActive = false;

            
            Object.values(this.gameState.players).forEach(player => {
                if (player.isOnline) {
                    player.score += 25;
                }
            });

            this.broadcast({
                type: 'message',
                message: `🎊 Parabéns! A palavra era "${this.gameState.word}"!`
            });

            
            setTimeout(() => {
                this.startNewGame();
            }, 3000);

        } else if (this.gameState.wrongGuesses >= this.gameState.maxWrongGuesses) {
            this.gameState.gameOver = true;
            this.gameState.isWon = false;
            this.gameState.gameActive = false;

            this.broadcast({
                type: 'message',
                message: `💀 Game Over! A palavra era "${this.gameState.word}".`
            });

            
            setTimeout(() => {
                this.startNewGame();
            }, 3000);
        }
    }

    startNewGame() {
        const randomWord = this.words[Math.floor(Math.random() * this.words.length)];
        
        this.gameState.word = randomWord;
        this.gameState.guessedWord = '_'.repeat(randomWord.length);
        this.gameState.wrongGuesses = 0;
        this.gameState.guessedLetters = [];
        this.gameState.gameActive = true;
        this.gameState.gameOver = false;
        this.gameState.isWon = false;

        const onlinePlayersCount = Object.values(this.gameState.players).filter(p => p.isOnline).length;
        
        if (onlinePlayersCount > 0) {
            this.gameState.currentRound++;
        }

        this.broadcast({
            type: 'message',
            message: `Nova palavra iniciada! (${randomWord.length} letras) - Rodada ${this.gameState.currentRound}`
        });

        this.broadcastGameState();
        console.log(`Nova palavra: ${randomWord} (Rodada ${this.gameState.currentRound})`);
    }

    handleDisconnection(ws) {
        const playerName = this.clients.get(ws);
        
        if (playerName) {
            console.log(`Jogador ${playerName} desconectou`);
            
            
            if (this.gameState.players[playerName]) {
                this.gameState.players[playerName].isOnline = false;
                this.gameState.players[playerName].lastSeen = new Date().toISOString();
            }

            this.clients.delete(ws);

            this.broadcast({
                type: 'message',
                message: `${playerName} saiu do jogo.`
            });

            this.broadcast({
                type: 'playerLeft',
                playerName: playerName,
                players: this.gameState.players
            });
        }
    }

    sendToClient(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    sendError(ws, message) {
        this.sendToClient(ws, {
            type: 'error',
            message: message
        });
    }

    broadcast(message) {
        const messageStr = JSON.stringify({
            ...message,
            timestamp: new Date().toISOString()
        });

        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    }

    broadcastGameState() {
        this.broadcast({
            type: 'gameState',
            gameState: this.getClientGameState()
        });
    }

    getClientGameState() {
        return {
            guessedWord: this.gameState.guessedWord,
            wrongGuesses: this.gameState.wrongGuesses,
            maxWrongGuesses: this.gameState.maxWrongGuesses,
            guessedLetters: this.gameState.guessedLetters,
            players: this.gameState.players,
            currentRound: this.gameState.currentRound,
            gameActive: this.gameState.gameActive,
            gameOver: this.gameState.gameOver,
            isWon: this.gameState.isWon,
            playersCount: Object.values(this.gameState.players).filter(p => p.isOnline).length
        };
    }

    
    cleanupOfflinePlayers() {
        const now = Date.now();
        let cleaned = 0;
        
        Object.keys(this.gameState.players).forEach(playerName => {
            const player = this.gameState.players[playerName];
            if (!player.isOnline && player.lastSeen) {
                const lastSeenTime = new Date(player.lastSeen).getTime();
                if (now - lastSeenTime > 300000) { 
                    delete this.gameState.players[playerName];
                    cleaned++;
                }
            }
        });

        if (cleaned > 0) {
            console.log(`Removidos ${cleaned} jogadores inativos`);
            this.broadcastGameState();
        }
    }

    getStats() {
        const totalPlayers = Object.keys(this.gameState.players).length;
        const onlinePlayers = Object.values(this.gameState.players).filter(p => p.isOnline).length;
        
        return {
            totalPlayers,
            onlinePlayers,
            currentRound: this.gameState.currentRound,
            gameActive: this.gameState.gameActive,
            currentWord: this.gameState.word,
            uptime: process.uptime()
        };
    }
}


const server = new HangmanServer();


setInterval(() => {
    server.cleanupOfflinePlayers();
}, 60000); 


setInterval(() => {
    const stats = server.getStats();
    console.log(`📊 Stats: ${stats.onlinePlayers}/${stats.totalPlayers} jogadores, Rodada ${stats.currentRound}, Uptime: ${Math.floor(stats.uptime/60)}min`);
}, 300000);


const gracefulShutdown = () => {
    console.log('\n🛑 Encerrando servidor...');
    
    server.broadcast({
        type: 'message',
        message: 'Servidor está sendo reiniciado. Reconecte em alguns segundos.'
    });

    setTimeout(() => {
        server.wss.close(() => {
            console.log('Servidor WebSocket fechado');
            process.exit(0);
        });
    }, 1000);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

module.exports = HangmanServer;