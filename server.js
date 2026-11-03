const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const ADMIN_PASS = '140206';
// Mảng 50 đáp án trích xuất từ bảng tổng hợp[cite: 1]
const ANSWERS = [
    'B','C','A','B','C','B','D','A','C','B', // 1-10
    'D','C','A','B','C','B','D','A','D','C', // 11-20
    'C','B','B','A','D','C','C','B','A','B', // 21-30
    'A','B','C','C','B','D','A','A','A','B', // 31-40
    'A','C','A','A','C','B','C','B','B','A'  // 41-50
];

let gameState = {
    currentQuestion: -1,
    isActive: false,
    players: {}, 
    correctResponders: [],
    timeLeft: 15
};
let timer;

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        gameState.players[socket.id] = { name: data.name, team: data.team, score: 0, answered: false };
        io.emit('updateScores', getScores());
    });

    socket.on('submitAnswer', (answer) => {
        let player = gameState.players[socket.id];
        if (player && gameState.isActive && !player.answered) {
            player.answered = true;
            if (answer === ANSWERS[gameState.currentQuestion]) {
                gameState.correctResponders.push(socket.id);
            }
            socket.emit('answerReceived');
        }
    });

    socket.on('adminAuth', (pass, callback) => {
        callback(pass === ADMIN_PASS);
    });

    socket.on('nextQuestion', () => {
        if (gameState.currentQuestion >= 49) return;
        gameState.currentQuestion++;
        gameState.isActive = true;
        gameState.correctResponders = [];
        gameState.timeLeft = 15;
        
        for (let id in gameState.players) {
            gameState.players[id].answered = false;
        }

        io.emit('newQuestion', { questionNumber: gameState.currentQuestion + 1 });

        clearInterval(timer);
        timer = setInterval(() => {
            gameState.timeLeft--;
            io.emit('timer', gameState.timeLeft);
            if (gameState.timeLeft <= 0) {
                clearInterval(timer);
                endQuestion();
            }
        }, 1000);
    });

    socket.on('disconnect', () => {
        delete gameState.players[socket.id];
        io.emit('updateScores', getScores());
    });
});

function endQuestion() {
    gameState.isActive = false;
    // Tính điểm dựa trên tốc độ
    gameState.correctResponders.forEach((id, index) => {
        let player = gameState.players[id];
        if (player) {
            if (index === 0) player.score += 10;
            else if (index === 1) player.score += 8;
            else if (index === 2) player.score += 7;
            else player.score += 5;
        }
    });
    
    const isFinished = gameState.currentQuestion === 49;
    io.emit('questionEnd', { 
        correctAnswer: ANSWERS[gameState.currentQuestion], 
        scores: getScores(),
        isFinished: isFinished
    });
}

function getScores() {
    let team1 = 0, team2 = 0;
    for (let id in gameState.players) {
        let p = gameState.players[id];
        if (p.team === '1') team1 += p.score;
        if (p.team === '2') team2 += p.score;
    }
    return { team1, team2 };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));